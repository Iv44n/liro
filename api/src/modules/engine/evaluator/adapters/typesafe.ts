import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  type Questions,
  type ScoreCriteria,
  TypeSafeClient,
  TypeSafeError
} from '@typesafe-ai/sdk'
import z from 'zod'
import {
  type CanonicalAnswer,
  type CanonicalQuestion,
  type EvaluationRequest,
  type EvaluationResult,
  type Evaluator,
  EvaluatorError,
  type EvaluatorErrorCode,
  type ModelRef
} from '../port'

export const TYPESAFE_API_URL = 'https://api.typesafe.ai'
export const TYPESAFE_LATEST_MODEL_ID = 'jev-latest'

/**
 * Per-attempt timeout handed to the SDK. Deliberately generous: the deadline
 * decorator bounds the whole evaluation and aborts through `request.signal`,
 * so this only guards a caller that passes no signal at all.
 */
const ATTEMPT_TIMEOUT_MS = 60_000

export interface TypeSafeEvaluatorOptions {
  apiKey: string
  /**
   * Defaults to `https://api.typesafe.ai`. Always passed explicitly so the
   * SDK's `TYPESAFE_BASE_URL` fallback can't redirect traffic (and the key).
   */
  baseURL?: string
  /** Injectable for tests (recorded responses). */
  fetch?: typeof globalThis.fetch
  /**
   * Version used when the request's `ModelRef` pins none (`JEV_MODEL_VERSION`,
   * e.g. `1.13.0`). Without either, requests go to the moving `jev-latest`.
   */
  modelVersion?: string
  timeoutMs?: number
}

/** `{ version: '1.13.0' }` → `jev-1.13.0`; no version anywhere → `jev-latest`. */
export function typeSafeModelId(model: ModelRef, fallbackVersion?: string) {
  const version = model.version || fallbackVersion
  if (!version) return TYPESAFE_LATEST_MODEL_ID
  return version.startsWith('jev-') ? version : `jev-${version}`
}

/**
 * Jev through TypeSafe's official API (`@typesafe-ai/sdk`, `POST /v1/systemone`).
 *
 * What this adapter absorbs: the yes/no type is `noul` on the wire (answered as
 * `{ noul: P(yes) }`), models are versioned (`jev-1.13.0`, or the `jev-latest`
 * alias), and answers carry a native `confidence` (plus `legend` on scores),
 * which is discarded — Liro computes confidence itself, identically for every
 * provider. The SDK's own retries are off (the retry decorator owns them) and
 * its log level is pinned below `debug`, which would log the state.
 */
export function createTypeSafeEvaluator(
  options: TypeSafeEvaluatorOptions
): Evaluator {
  const client = new TypeSafeClient({
    apiKey: options.apiKey,
    baseURL: options.baseURL ?? TYPESAFE_API_URL,
    ...(options.fetch ? { fetch: options.fetch } : {}),
    timeout: options.timeoutMs ?? ATTEMPT_TIMEOUT_MS,
    retry: { maxRetries: 0 },
    // Explicit, so TYPESAFE_LOG_LEVEL=debug can't turn on body logging.
    logLevel: 'warn'
  })

  return {
    provider: 'typesafe',
    capabilities: {
      probabilities: 'always',
      versionedModels: true,
      maxContextTokens: 64_000,
      questionTypes: ['choice', 'score', 'boolean']
    },

    async evaluate(request: EvaluationRequest): Promise<EvaluationResult> {
      const startedAt = performance.now()
      const model = typeSafeModelId(request.model, options.modelVersion)

      try {
        // Already past the deadline (or cancelled): don't start a request.
        request.signal?.throwIfAborted()

        const { data, requestId } = await client
          .systemOne(
            {
              state: request.state,
              model,
              questions: toWireQuestions(request.questions)
            },
            request.signal ? { signal: request.signal } : {}
          )
          .withResponse()

        const body = parseResponse(data, request.questions, requestId)

        return {
          answers: body.answers,
          usage: {
            inputTokens: body.usage?.input_tokens ?? null,
            outputTokens: body.usage?.output_tokens ?? null
          },
          provider: 'typesafe',
          model: { requested: model, resolved: body.model ?? null },
          providerRequestId: requestId ?? null,
          latencyMs: performance.now() - startedAt
        }
      } catch (error) {
        throw toEvaluatorError(error, request.signal)
      }
    }
  }
}

// ── canonical → wire ────────────────────────────────────────────────────

function toWireQuestions(
  questions: Record<string, CanonicalQuestion>
): Questions {
  const wire: Questions = {}

  for (const [key, question] of Object.entries(questions)) {
    switch (question.type) {
      case 'boolean':
        wire[key] = {
          type: 'noul',
          instructions: question.instructions,
          ...(question.criteria ? { criteria: question.criteria } : {})
        }
        break
      case 'choice':
        wire[key] = {
          type: 'choice',
          instructions: question.instructions,
          criteria: question.criteria
        }
        break
      case 'score':
        wire[key] = {
          type: 'score',
          instructions: question.instructions,
          // Fewer than two levels is rejected by the SDK (→ INVALID_REQUEST).
          criteria: question.criteria as unknown as ScoreCriteria
        }
        break
    }
  }

  return wire
}

// ── wire → canonical ────────────────────────────────────────────────────

// The SDK types the body but never validates it; this does. Unknown keys
// (`confidence`, `legend`) are stripped.
const probabilitiesSchema = z.record(z.string(), z.number())

const answerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('choice'),
    choice: z.string(),
    probabilities: probabilitiesSchema
  }),
  z.object({
    type: z.literal('score'),
    score: z.number(),
    probabilities: probabilitiesSchema
  }),
  z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) })
])

const responseSchema = z.object({
  model: z.string().optional(),
  answers: z.record(z.string(), answerSchema),
  usage: z
    .object({
      input_tokens: z.number().nullish(),
      output_tokens: z.number().nullish()
    })
    .nullish()
})

const WIRE_TYPE = { choice: 'choice', score: 'score', boolean: 'noul' } as const

/** Levels are indices; allow float noise at the ends of the range. */
const SCORE_EPSILON = 1e-6

function parseResponse(
  data: unknown,
  questions: Record<string, CanonicalQuestion>,
  requestId: string | undefined
) {
  const badResponse = (message: string, cause?: unknown) =>
    new EvaluatorError('BAD_RESPONSE', message, {
      provider: 'typesafe',
      ...(requestId ? { providerRequestId: requestId } : {}),
      cause
    })

  const parsed = responseSchema.safeParse(data)
  if (!parsed.success) {
    throw badResponse(
      `Unexpected TypeSafe response: ${z.prettifyError(parsed.error)}`,
      parsed.error
    )
  }

  const answers: Record<string, CanonicalAnswer> = {}

  for (const [key, question] of Object.entries(questions)) {
    // Own keys only: a question named e.g. `constructor` must not read the prototype.
    const answer = Object.hasOwn(parsed.data.answers, key)
      ? parsed.data.answers[key]
      : undefined
    if (!answer) throw badResponse(`No answer for question "${key}"`)
    if (answer.type !== WIRE_TYPE[question.type]) {
      throw badResponse(
        `Question "${key}" is ${question.type} but was answered as ${answer.type}`
      )
    }

    if (answer.type === 'choice' && question.type === 'choice') {
      if (!Object.hasOwn(question.criteria, answer.choice)) {
        throw badResponse(
          `Question "${key}" answered "${answer.choice}", which is not one of its options`
        )
      }
      answers[key] = {
        type: 'choice',
        choice: answer.choice,
        probabilities: answer.probabilities
      }
    } else if (answer.type === 'score' && question.type === 'score') {
      const maxLevel = question.criteria.length - 1
      if (
        answer.score < -SCORE_EPSILON ||
        answer.score > maxLevel + SCORE_EPSILON
      ) {
        throw badResponse(
          `Question "${key}" scored ${answer.score}, outside 0..${maxLevel}`
        )
      }
      answers[key] = {
        type: 'score',
        score: answer.score,
        probabilities: answer.probabilities
      }
    } else if (answer.type === 'noul') {
      answers[key] = { type: 'boolean', probability: answer.noul }
    }
  }

  return { ...parsed.data, answers }
}

// ── errors ──────────────────────────────────────────────────────────────

// Only size-related wording: a 422 like "criteria exceed 255 options" is an
// invalid request, not an oversized input.
const TOO_LARGE = /context|too (large|long)|\btokens?\b/i

/**
 * An explicit "this model doesn't exist" — never any message that merely
 * mentions the model: the executor marks a published version pinned to a
 * missing model `model_unavailable` for good.
 */
const UNKNOWN_MODEL =
  /\b(unknown|invalid|unsupported|unrecognized|no such)\s+model\b|\bmodel\b.{0,80}\b(not found|does not exist|doesn't exist|is unknown|is not supported)\b/i

const MAX_MESSAGE_LENGTH = 300

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

/**
 * The error's human-readable part, taken only from the fields that carry one
 * (`detail`, `message`, `error`, or validation `loc`/`msg` pairs). Unlike the
 * SDK's own message it never falls back to the raw body, which may echo the
 * request (e.g. a validation error's `input`, i.e. the state) — and this
 * message is logged and stored with the failed run.
 */
function detailOf(body: unknown): string | undefined {
  if (typeof body === 'string') return body.trim() || undefined
  if (!isRecord(body)) return undefined

  const { error, message, detail } = body
  if (typeof error === 'string') return error
  if (isRecord(error) && typeof error.message === 'string') return error.message
  if (typeof message === 'string') return message
  if (typeof detail === 'string') return detail
  if (isRecord(detail) && typeof detail.message === 'string') {
    return detail.message
  }
  if (Array.isArray(detail)) {
    const parts = detail.flatMap(item => {
      if (!isRecord(item) || typeof item.msg !== 'string') return []
      const loc = Array.isArray(item.loc)
        ? item.loc.filter(part => part !== 'body').join('.')
        : ''
      return [loc ? `${loc}: ${item.msg}` : item.msg]
    })
    return parts.length > 0 ? parts.join('; ') : undefined
  }
  return undefined
}

function messageOf(error: APIError): string {
  const detail = detailOf(error.body)
  if (!detail) return `${error.status} error from TypeSafe (no details)`
  const message = `${error.status} ${detail}`
  return message.length > MAX_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_MESSAGE_LENGTH)}…`
    : message
}

function codeOf(status: number, message: string): EvaluatorErrorCode {
  if (status === 429) return 'RATE_LIMITED'
  if (status === 529) return 'OVERLOADED'
  if (status >= 500) return 'UNAVAILABLE'
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 408) return 'TIMEOUT'
  if (
    status === 413 ||
    ((status === 422 || status === 400) && TOO_LARGE.test(message))
  ) {
    return 'INPUT_TOO_LARGE'
  }
  if ((status === 400 || status === 404) && UNKNOWN_MODEL.test(message)) {
    return 'MODEL_NOT_FOUND'
  }
  return 'INVALID_REQUEST'
}

/** `retry-after-ms`, then `Retry-After` (seconds or an HTTP date). */
function retryAfterOf(headers: Headers): number | undefined {
  const ms = Number(headers.get('retry-after-ms') ?? Number.NaN)
  if (Number.isFinite(ms) && ms >= 0) return ms

  const raw = headers.get('retry-after')
  if (raw === null) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined
  const date = Date.parse(raw)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

export function toEvaluatorError(
  error: unknown,
  signal?: AbortSignal
): EvaluatorError {
  if (error instanceof EvaluatorError) return error

  // The server answered: its status says what went wrong, even if the
  // signal fired while the error was being read.
  if (error instanceof APIError) {
    const message = messageOf(error)
    const code = codeOf(error.status, message)
    const retryAfterMs = retryAfterOf(error.headers)
    return new EvaluatorError(code, message, {
      provider: 'typesafe',
      ...(code === 'RATE_LIMITED' ? { scope: 'provider' as const } : {}),
      ...(error.requestId ? { providerRequestId: error.requestId } : {}),
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      cause: error
    })
  }

  if (
    signal?.aborted ||
    error instanceof APIUserAbortError ||
    error instanceof APITimeoutError
  ) {
    return new EvaluatorError(
      'TIMEOUT',
      error instanceof APITimeoutError
        ? error.message
        : 'Evaluation was aborted',
      { provider: 'typesafe', cause: error }
    )
  }

  if (error instanceof APIConnectionError) {
    return new EvaluatorError('UNAVAILABLE', error.message, {
      provider: 'typesafe',
      cause: error
    })
  }

  // The SDK validates questions before any I/O (e.g. a score with fewer
  // than two levels): the request itself is wrong.
  if (error instanceof TypeSafeError) {
    return new EvaluatorError('INVALID_REQUEST', error.message, {
      provider: 'typesafe',
      cause: error
    })
  }

  return new EvaluatorError(
    'UNAVAILABLE',
    error instanceof Error ? error.message : 'Unknown evaluator error',
    { provider: 'typesafe', cause: error }
  )
}
