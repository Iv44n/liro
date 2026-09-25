import { log } from '#shared/config/logger'
import {
  type EvaluationPriority,
  type EvaluationRequest,
  type Evaluator,
  EvaluatorError
} from './port'

/**
 * Cross-cutting behavior shared by every provider. Each decorator wraps an
 * `Evaluator` and returns one, so the composition in `index.ts` reads
 * outside-in: telemetry → deadline → retry → gate → [fallback →] adapter.
 */

type Clock = () => number

const decorate = (
  inner: Evaluator,
  evaluate: Evaluator['evaluate']
): Evaluator => ({
  provider: inner.provider,
  capabilities: inner.capabilities,
  evaluate
})

// ── deadline ────────────────────────────────────────────────────────────

/**
 * Bounds the whole evaluation (every retry included) so a synchronous run
 * never hangs past `timeoutMs`. Aborts the in-flight attempt and reports
 * `TIMEOUT`.
 */
export function withDeadline(
  inner: Evaluator,
  options: { timeoutMs: number; now?: Clock }
): Evaluator {
  const now = options.now ?? Date.now

  return decorate(inner, async request => {
    const timeout = AbortSignal.timeout(options.timeoutMs)
    const signal = request.signal
      ? AbortSignal.any([request.signal, timeout])
      : timeout
    const deadline = Math.min(
      request.deadline ?? Number.POSITIVE_INFINITY,
      now() + options.timeoutMs
    )

    try {
      return await inner.evaluate({ ...request, signal, deadline })
    } catch (error) {
      if (!timeout.aborted) throw error
      throw new EvaluatorError(
        'TIMEOUT',
        `Evaluation exceeded ${options.timeoutMs}ms`,
        { provider: inner.provider, cause: error }
      )
    }
  })
}

// ── retry ───────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** Retries (not attempts) per priority: synchronous callers get few, background work more. */
  maxRetries: Record<EvaluationPriority, number>
  baseDelayMs?: number
  maxDelayMs?: number
  now?: Clock
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  random?: () => number
}

const abortableSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true }
    )
  })

/**
 * Retries retryable `EvaluatorError`s with exponential backoff and jitter,
 * honoring the provider's `retryAfterMs` — but never sleeping past the
 * request's deadline (it rethrows instead, so the caller can answer with
 * `Retry-After`). Platform/organization quota rejections are never retried:
 * retrying would only consume more of the quota that just ran out.
 */
export function withRetry(inner: Evaluator, options: RetryOptions): Evaluator {
  const baseDelayMs = options.baseDelayMs ?? 500
  const maxDelayMs = options.maxDelayMs ?? 5_000
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? abortableSleep
  const random = options.random ?? Math.random

  return decorate(inner, async request => {
    const maxRetries = options.maxRetries[request.priority]

    for (let attempt = 0; ; attempt++) {
      try {
        return await inner.evaluate(request)
      } catch (error) {
        if (
          !(error instanceof EvaluatorError) ||
          !error.retryable ||
          (error.scope !== undefined && error.scope !== 'provider') ||
          attempt >= maxRetries ||
          request.signal?.aborted
        ) {
          throw error
        }

        const backoff =
          Math.min(baseDelayMs * 2 ** attempt, maxDelayMs) *
          (1 - random() * 0.25)
        const delay = error.retryAfterMs ?? backoff
        if (
          request.deadline !== undefined &&
          now() + delay >= request.deadline
        ) {
          throw error
        }

        await sleep(delay, request.signal)
      }
    }
  })
}

// ── gate (quota) ────────────────────────────────────────────────────────

export interface GateOptions {
  /** Shared across all organizations: the provider's (or our plan's) limit. */
  platform: { requestsPerMinute: number }
  organization: { requestsPerMinute: number; maxConcurrent: number }
  /**
   * Share of the platform bucket only `live` traffic may use: playground and
   * evaluation requests are rejected once the bucket falls below it.
   */
  liveReserve?: number
  now?: Clock
}

class TokenBucket {
  private tokens: number
  private updatedAt: number

  constructor(
    private readonly capacity: number,
    private readonly now: Clock
  ) {
    this.tokens = capacity
    this.updatedAt = now()
  }

  private refill(): void {
    const current = this.now()
    const perMs = this.capacity / 60_000
    // A clock that moves backwards (NTP correction, `setSystemTime` in tests)
    // must not drain the bucket: treat it as no time elapsed.
    const elapsed = Math.max(0, current - this.updatedAt)
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * perMs)
    this.updatedAt = current
  }

  /** Takes one token if at least `floor + 1` are available. */
  take(floor = 0): boolean {
    this.refill()
    if (this.tokens < floor + 1) return false
    this.tokens -= 1
    return true
  }

  /** Milliseconds until one token is available again. */
  msUntilNext(floor = 0): number {
    this.refill()
    const missing = floor + 1 - this.tokens
    return missing <= 0 ? 0 : Math.ceil(missing / (this.capacity / 60_000))
  }
}

/**
 * In-memory quota in front of the provider: one platform-wide token bucket
 * (everyone shares one provider key) plus a bucket and a concurrency cap per
 * organization, so one tenant can't starve the rest. Rejects immediately
 * instead of queueing — synchronous callers get a `Retry-After` hint.
 *
 * In-memory is enough while the API runs as a single instance; the
 * `Evaluator` interface lets this move to Postgres/Redis later unchanged.
 */
export function withGate(inner: Evaluator, options: GateOptions): Evaluator {
  const now = options.now ?? Date.now
  const platform = new TokenBucket(options.platform.requestsPerMinute, now)
  const reserve = Math.floor(
    options.platform.requestsPerMinute * (options.liveReserve ?? 0.2)
  )
  const organizations = new Map<
    string,
    { bucket: TokenBucket; inFlight: number }
  >()

  const organizationState = (organizationId: string) => {
    let state = organizations.get(organizationId)
    if (!state) {
      state = {
        bucket: new TokenBucket(options.organization.requestsPerMinute, now),
        inFlight: 0
      }
      organizations.set(organizationId, state)
    }
    return state
  }

  const rejectFor = (
    scope: 'platform' | 'organization',
    retryAfterMs: number
  ) =>
    new EvaluatorError(
      'RATE_LIMITED',
      scope === 'platform'
        ? 'Platform evaluation capacity exhausted'
        : 'Organization evaluation quota exceeded',
      { scope, retryAfterMs, provider: inner.provider }
    )

  return decorate(inner, async (request: EvaluationRequest) => {
    const org = organizationState(request.organizationId)

    if (org.inFlight >= options.organization.maxConcurrent) {
      throw rejectFor('organization', 1_000)
    }
    if (!org.bucket.take()) {
      throw rejectFor('organization', org.bucket.msUntilNext())
    }

    const floor = request.priority === 'live' ? 0 : reserve
    if (!platform.take(floor)) {
      throw rejectFor('platform', platform.msUntilNext(floor))
    }

    org.inFlight++
    try {
      return await inner.evaluate(request)
    } finally {
      org.inFlight--
    }
  })
}

// ── fallback ────────────────────────────────────────────────────────────

/**
 * Whether a primary failure means "this provider can't serve right now" (so
 * another one might), as opposed to "this request is wrong" or "we are out
 * of quota" — those would fail on any provider, or must not spill over.
 */
const isProviderOutage = (error: unknown): error is EvaluatorError =>
  error instanceof EvaluatorError &&
  (error.code === 'UNAVAILABLE' ||
    error.code === 'OVERLOADED' ||
    (error.code === 'RATE_LIMITED' && error.scope === 'provider'))

/**
 * Sends a request to `secondary` once when `primary` is unavailable,
 * overloaded or rate limited by the provider itself (e.g. TypeSafe's API with
 * the gateway behind it). Invalid requests, oversized inputs, auth errors,
 * timeouts and Liro's own quota rejections are rethrown untouched.
 *
 * The result — and so its `provider` and `model` — comes from whoever
 * answered. If the secondary fails too, the primary's error is rethrown: it
 * is the outage that matters (the secondary may reject for its own reasons,
 * such as a smaller context window), and it keeps the retry decision intact.
 *
 * Capabilities are the primary's, narrowed to what both can honor: the
 * smaller context window, and `optional` probabilities if either may omit them.
 * `versionedModels` stays the primary's, because a request that pins a model
 * version is never handed to a secondary that can't pin one: its thresholds
 * were tuned against that exact model, so it fails like any outage instead of
 * being decided by whatever model the secondary serves. Unpinned requests may
 * fall back; `model.requested`/`resolved` record per run who answered.
 */
export function withFallback(
  primary: Evaluator,
  secondary: Evaluator,
  options: { now?: Clock } = {}
): Evaluator {
  const now = options.now ?? Date.now

  return {
    provider: primary.provider,
    capabilities: {
      ...primary.capabilities,
      maxContextTokens: Math.min(
        primary.capabilities.maxContextTokens,
        secondary.capabilities.maxContextTokens
      ),
      probabilities:
        primary.capabilities.probabilities === 'optional' ||
        secondary.capabilities.probabilities === 'optional'
          ? 'optional'
          : 'always'
    },

    async evaluate(request) {
      try {
        return await primary.evaluate(request)
      } catch (error) {
        if (
          !isProviderOutage(error) ||
          (request.model.version && !secondary.capabilities.versionedModels) ||
          request.signal?.aborted ||
          (request.deadline !== undefined && now() >= request.deadline)
        ) {
          throw error
        }

        log.logger.warn('[evaluator] falling back', {
          from: primary.provider,
          to: secondary.provider,
          code: error.code,
          organizationId: request.organizationId
        })

        try {
          return await secondary.evaluate(request)
        } catch (secondaryError) {
          log.logger.warn('[evaluator] fallback failed', {
            provider: secondary.provider,
            code:
              secondaryError instanceof EvaluatorError
                ? secondaryError.code
                : 'UNKNOWN',
            organizationId: request.organizationId
          })
          throw error
        }
      }
    }
  }
}

// ── telemetry ───────────────────────────────────────────────────────────

/** Structured logs per evaluation — never the state or questions (they may hold PII). */
export function withTelemetry(inner: Evaluator): Evaluator {
  return decorate(inner, async request => {
    const startedAt = performance.now()
    try {
      const result = await inner.evaluate(request)
      log.logger.debug('[evaluator] ok', {
        provider: result.provider,
        organizationId: request.organizationId,
        priority: request.priority,
        questions: Object.keys(request.questions).length,
        latencyMs: Math.round(result.latencyMs),
        inputTokens: result.usage.inputTokens
      })
      return result
    } catch (error) {
      log.logger.warn('[evaluator] failed', {
        provider: inner.provider,
        organizationId: request.organizationId,
        priority: request.priority,
        code: error instanceof EvaluatorError ? error.code : 'UNKNOWN',
        scope: error instanceof EvaluatorError ? error.scope : undefined,
        latencyMs: Math.round(performance.now() - startedAt)
      })
      throw error
    }
  })
}
