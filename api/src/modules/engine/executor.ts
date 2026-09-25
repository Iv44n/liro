import { and, eq, inArray, sql } from 'drizzle-orm'
import { enqueueEffects } from '#modules/effects/dispatcher'
import { buildEffectPayload } from '#modules/effects/payload'
import { reviewTasks } from '#modules/reviews/reviews.schemas'
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  type Queryable,
  releaseIdempotencyKey
} from '#modules/runs/idempotency'
import {
  decisionRuns,
  type RunMode,
  type RunSource,
  usageDaily
} from '#modules/runs/runs.schemas'
import { NEEDS_REVIEW } from '#modules/templates/definition'
import { policyInputOf, storedInputOf } from '#modules/templates/input-schema'
import {
  decisionTemplateVersions,
  type StoreInputMode
} from '#modules/templates/templates.schemas'
import { log } from '#shared/config/logger'
import { Id } from '#shared/core/base'
import { db } from '#shared/db/config'
import { ApiError } from '#shared/http/errors'
import { resolveAnswers } from './answers'
import type { CompiledVersion } from './compiled-cache'
import {
  type EvaluationPriority,
  type EvaluationResult,
  type Evaluator,
  EvaluatorError,
  getEvaluator,
  type ModelRef,
  type RateLimitScope
} from './evaluator'
import { evaluatePolicy, evaluatePreconditions, questionsToAsk } from './policy'
import { buildQuestions } from './questions'
import { buildState } from './state'
import {
  checkTokenBudget,
  estimateRequestTokens,
  type TokenBudgetStatus
} from './tokens'
import {
  ENGINE_VERSION,
  type JsonObject,
  type PolicyResult,
  type ResolvedAnswers
} from './types'

/**
 * Runs one decision end to end: validate the input, claim the idempotency
 * key, decide (preconditions → one evaluation → policy), and persist the run
 * with its review task, idempotency completion and usage rollup in ONE
 * transaction — so a `needs_review` run never exists without its review and
 * a completed key always points at a stored run.
 */

export type RunRow = typeof decisionRuns.$inferSelect
export type ReviewRow = typeof reviewTasks.$inferSelect

type Database = typeof db
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export interface ExecuteRunOptions {
  organizationId: string
  template: { id: string; slug: string; storeInput: StoreInputMode }
  /** `major`/`minor` are `null` for a draft (playground runs). */
  version: {
    id: string
    major: number | null
    minor: number | null
    definitionHash: string
    modelRef: ModelRef
  }
  compiled: CompiledVersion
  /** Validated here via `compiled.validateInput`. */
  input: unknown
  metadata?: JsonObject
  mode: RunMode
  source: RunSource
  priority: EvaluationPriority
  apiKeyId: string | null
  userId: string | null
  idempotency?: { key: string; requestHash: string }
  /** `false` for the playground: a `needs_review` run creates no review task. */
  createReview: boolean
  /** Store the definition on the run (the playground's draft may change later). */
  snapshotDefinition: boolean
  /** Default: `getEvaluator()`. */
  evaluator?: Evaluator
}

export interface RunTrace {
  /** What was sent to the evaluator; `null` when it wasn't called. */
  state: JsonObject | null
  /** Question ids asked (empty when a precondition decided). */
  questions: string[]
  /** `null` when no evaluation was needed. */
  tokens: {
    estimate: number
    limit: number
    status: TokenBudgetStatus
  } | null
}

export interface ExecuteRunResult {
  run: RunRow
  review: ReviewRow | null
  /** A completed `Idempotency-Key`'s stored run: nothing was executed. */
  replayed: boolean
  trace: RunTrace
}

interface Decided {
  policy: PolicyResult
  answers: ResolvedAnswers
}

/** Mutable state of one execution, read by the failure path. */
interface Attempt {
  input: JsonObject
  now: Date
  /**
   * Taken with `now`, when the request started: lists order and paginate by
   * these UUIDv7 ids, so they must follow `createdAt`, not completion time.
   */
  runId: string
  /** Used only when the run creates a review task. */
  reviewId: string
  /** The idempotency claim this attempt owns, if any. */
  claimedAt: Date | null
  startedAt: number
  evaluator: Evaluator
  trace: RunTrace
  /** Set as soon as the evaluator answered (a bad answer still fails the run). */
  evaluation: EvaluationResult | null
}

export async function executeRun(
  options: ExecuteRunOptions
): Promise<ExecuteRunResult> {
  const startedAt = performance.now()
  const now = new Date()
  const runId = Id.generate()
  const reviewId = Id.generate()
  const { organizationId, idempotency } = options
  const input = options.compiled.validateInput(options.input)

  let claimedAt: Date | null = null
  if (idempotency) {
    const claim = await claimIdempotencyKey(db, {
      organizationId,
      key: idempotency.key,
      requestHash: idempotency.requestHash,
      now
    })
    if (claim.kind === 'replay') return replay(organizationId, claim.runId)
    claimedAt = claim.claimedAt
  }

  const attempt: Attempt = {
    input,
    now,
    runId,
    reviewId,
    claimedAt,
    startedAt,
    evaluator: options.evaluator ?? getEvaluator(),
    trace: { state: null, questions: [], tokens: null },
    evaluation: null
  }

  try {
    const decided = await decideRun(options, attempt)
    const { run, review } = await persistRun(options, attempt, decided)
    return { run, review, replayed: false, trace: attempt.trace }
  } catch (error) {
    if (idempotency) {
      await releaseIdempotencyKey(db, {
        organizationId,
        key: idempotency.key,
        ...(claimedAt ? { claimedAt } : {})
      }).catch(releaseError =>
        log.logger.error('[executor] could not release idempotency key', {
          organizationId,
          error: String(releaseError)
        })
      )
    }
    if (error instanceof EvaluatorError) {
      throw await failRun(options, attempt, error)
    }
    throw error
  }
}

/** A replayed key returns the stored run as it is now (a review may have resolved it). */
async function replay(
  organizationId: string,
  runId: string
): Promise<ExecuteRunResult> {
  const run = await db.query.decisionRuns.findFirst({
    where: { id: runId, organizationId }
  })
  if (!run) throw new Error(`Idempotency key points to a missing run ${runId}`)
  const review = await db.query.reviewTasks.findFirst({
    where: { runId, organizationId }
  })
  return {
    run,
    review: review ?? null,
    replayed: true,
    trace: { state: null, questions: [], tokens: null }
  }
}

const unanswered = (options: ExecuteRunOptions): ResolvedAnswers =>
  resolveAnswers(options.compiled.definition.questions, [], {})

/** Preconditions → (maybe) one evaluation → policy. */
async function decideRun(
  options: ExecuteRunOptions,
  attempt: Attempt
): Promise<Decided> {
  const { definition } = options.compiled
  const { input, now, evaluator, trace } = attempt

  const precondition = evaluatePreconditions(definition, { input, now })
  if (precondition)
    return { policy: precondition, answers: unanswered(options) }

  const asked = questionsToAsk(definition, { input, now })
  trace.questions = asked
  if (asked.length === 0) {
    const answers = unanswered(options)
    return {
      policy: evaluatePolicy(definition, { input, answers, now }),
      answers
    }
  }

  const state = buildState(definition, input)
  const questions = buildQuestions(definition, asked)
  const limit = evaluator.capabilities.maxContextTokens
  const estimate = estimateRequestTokens(state, questions).total
  const status = checkTokenBudget(estimate, limit)
  trace.state = state
  trace.tokens = { estimate, limit, status }
  if (status === 'reject') {
    throw new ApiError(
      422,
      'INPUT_TOO_LARGE',
      'The input is too large for the model: send less text or fewer fields',
      { details: { estimatedTokens: estimate, maxContextTokens: limit } }
    )
  }

  const evaluation = await evaluator.evaluate({
    state,
    questions,
    model: options.version.modelRef,
    organizationId: options.organizationId,
    priority: options.priority
  })
  attempt.evaluation = evaluation

  const answers = resolveAnswers(
    definition.questions,
    asked,
    evaluation.answers
  )
  return {
    policy: evaluatePolicy(definition, { input, answers, now }),
    answers
  }
}

const roundOrNull = (value: number | null | undefined): number | null =>
  value === null || value === undefined ? null : Math.round(value)

/** Columns every run has, succeeded or failed. */
function baseRun(
  options: ExecuteRunOptions,
  attempt: Attempt
): typeof decisionRuns.$inferInsert {
  const { definition } = options.compiled
  const { evaluation } = attempt
  return {
    id: attempt.runId,
    organizationId: options.organizationId,
    templateId: options.template.id,
    versionId: options.version.id,
    definitionHash: options.version.definitionHash,
    engineVersion: ENGINE_VERSION,
    mode: options.mode,
    source: options.source,
    apiKeyId: options.apiKeyId,
    userId: options.userId,
    metadata: options.metadata ?? null,
    status: 'succeeded',
    input: storedInputOf(
      definition,
      attempt.input,
      options.template.storeInput
    ),
    policyInput: policyInputOf(definition, attempt.input),
    definition: options.snapshotDefinition ? definition : null,
    provider: evaluation?.provider ?? null,
    modelRequested: evaluation?.model.requested ?? null,
    modelResolved: evaluation?.model.resolved ?? null,
    providerRequestId: evaluation?.providerRequestId ?? null,
    inputTokens: roundOrNull(evaluation?.usage.inputTokens),
    outputTokens: roundOrNull(evaluation?.usage.outputTokens),
    latencyMs: Math.round(performance.now() - attempt.startedAt),
    evaluatorLatencyMs: roundOrNull(evaluation?.latencyMs),
    createdAt: attempt.now,
    completedAt: new Date()
  }
}

async function persistRun(
  options: ExecuteRunOptions,
  attempt: Attempt,
  { policy, answers }: Decided
): Promise<{ run: RunRow; review: ReviewRow | null }> {
  const { organizationId, idempotency } = options
  const needsReview = policy.decision === NEEDS_REVIEW
  const values: typeof decisionRuns.$inferInsert = {
    ...baseRun(options, attempt),
    answers,
    signals: policy.signals,
    decision: policy.decision,
    suggestion: policy.suggestion,
    confidence: policy.confidence,
    rule: policy.rule,
    reviewReason: policy.reviewReason,
    flags: policy.flags,
    finalDecision: needsReview ? null : policy.decision
  }

  return db.transaction(async tx => {
    const [run] = await tx.insert(decisionRuns).values(values).returning()
    if (!run) throw new Error('Inserting the run returned no row')

    let review: ReviewRow | null = null
    if (needsReview && options.createReview) {
      const [created] = await tx
        .insert(reviewTasks)
        .values({
          id: attempt.reviewId,
          organizationId,
          runId: run.id,
          templateId: options.template.id,
          status: 'pending',
          reason: policy.reviewReason ?? 'rule',
          suggestedDecision: policy.suggestion,
          allowedDecisions: options.compiled.labels,
          createdAt: attempt.now
        })
        .returning()
      review = created ?? null
    }

    if (idempotency) {
      await completeIdempotencyKey(tx, {
        organizationId,
        key: idempotency.key,
        runId: run.id,
        ...(attempt.claimedAt ? { claimedAt: attempt.claimedAt } : {})
      })
    }

    await recordUsage(tx, usageOf(options, attempt, { succeeded: true }))
    await enqueueRunEffects(tx, options, attempt, { run, review, needsReview })

    return { run, review }
  })
}

/**
 * Fires `decision.made` (a decided run) or `decision.review_requested`
 * (`needs_review`) in the run's own transaction — the transactional outbox:
 * if the transaction rolls back, no execution was ever queued; once it
 * commits, the effects are queued for good. `enqueueEffects` itself skips
 * test-mode runs (every playground run included, since it always runs in
 * test mode), so nothing extra is needed here for that.
 */
async function enqueueRunEffects(
  tx: Transaction,
  options: ExecuteRunOptions,
  attempt: Attempt,
  {
    run,
    review,
    needsReview
  }: { run: RunRow; review: ReviewRow | null; needsReview: boolean }
): Promise<void> {
  const context = {
    templateSlug: options.template.slug,
    // `publicRunView` (what `buildEffectPayload` embeds) never reads this
    // field — only `runDetailView` does — so the slug is a safe placeholder.
    templateName: options.template.slug,
    major: options.version.major,
    minor: options.version.minor
  }
  const event = needsReview ? 'decision.review_requested' : 'decision.made'

  await enqueueEffects(tx, {
    organizationId: options.organizationId,
    runId: run.id,
    templateId: options.template.id,
    major: options.version.major,
    mode: options.mode,
    event,
    label: needsReview ? null : run.decision,
    now: attempt.now,
    payloadFor: binding =>
      buildEffectPayload({
        event,
        now: attempt.now,
        run,
        context,
        review,
        includeInput: binding.includeInput
      })
  })
}

interface Usage {
  organizationId: string
  templateId: string
  source: RunSource
  mode: RunMode
  now: Date
  evaluation: EvaluationResult | null
  /** Only succeeded runs count as `runs` (what billing counts). */
  succeeded: boolean
}

const usageOf = (
  options: ExecuteRunOptions,
  attempt: Attempt,
  { succeeded }: { succeeded: boolean }
): Usage => ({
  organizationId: options.organizationId,
  templateId: options.template.id,
  source: options.source,
  mode: options.mode,
  now: attempt.now,
  evaluation: attempt.evaluation,
  succeeded
})

/**
 * Adds a run to the day's `usage_daily` row (UTC day of the run's time):
 * `runs` counts succeeded runs; `evaluations` and the tokens count every
 * evaluator call that answered — a run that then failed (e.g. a
 * `BAD_RESPONSE` answer) included, so provider spend survives run purges.
 * Precondition or question-less runs are filed under provider `none`.
 */
async function recordUsage(executor: Queryable, usage: Usage): Promise<void> {
  const { evaluation } = usage
  await executor
    .insert(usageDaily)
    .values({
      organizationId: usage.organizationId,
      day: usage.now.toISOString().slice(0, 10),
      templateId: usage.templateId,
      source: usage.source,
      mode: usage.mode,
      provider: evaluation?.provider ?? 'none',
      runs: usage.succeeded ? 1 : 0,
      evaluations: evaluation ? 1 : 0,
      inputTokens: roundOrNull(evaluation?.usage.inputTokens) ?? 0,
      outputTokens: roundOrNull(evaluation?.usage.outputTokens) ?? 0
    })
    .onConflictDoUpdate({
      target: [
        usageDaily.organizationId,
        usageDaily.day,
        usageDaily.templateId,
        usageDaily.source,
        usageDaily.mode,
        usageDaily.provider
      ],
      set: {
        runs: sql`${usageDaily.runs} + excluded.runs`,
        evaluations: sql`${usageDaily.evaluations} + excluded.evaluations`,
        inputTokens: sql`${usageDaily.inputTokens} + excluded.input_tokens`,
        outputTokens: sql`${usageDaily.outputTokens} + excluded.output_tokens`
      }
    })
}

// ── Failures ────────────────────────────────────────────────────────────

/** Quota rejections are Liro's own gate saying "not now": nothing ran, nothing is stored. */
const isQuotaRejection = (error: EvaluatorError) =>
  error.code === 'RATE_LIMITED' &&
  (error.scope === 'organization' || error.scope === 'platform')

/**
 * Logs the evaluator failure (never the input or state), stores a `failed`
 * run unless it was a quota rejection — with its usage when the evaluator
 * had answered, in the same transaction — marks a pinned model's version
 * `model_unavailable`, and returns the HTTP error for the caller.
 */
async function failRun(
  options: ExecuteRunOptions,
  attempt: Attempt,
  error: EvaluatorError
): Promise<ApiError> {
  const quota = isQuotaRejection(error)
  const provider = attempt.evaluation?.provider ?? error.provider
  const context = {
    organizationId: options.organizationId,
    templateId: options.template.id,
    versionId: options.version.id,
    source: options.source,
    priority: options.priority,
    code: error.code,
    scope: error.scope,
    provider: provider ?? attempt.evaluator.provider,
    providerRequestId:
      error.providerRequestId ?? attempt.evaluation?.providerRequestId,
    retryAfterMs: error.retryAfterMs,
    message: error.message.slice(0, 500)
  }
  if (quota) log.logger.warn('[executor] evaluation quota exceeded', context)
  else log.logger.error('[executor] evaluation failed', context)

  let runId: string | null = null
  if (!quota) {
    try {
      runId = await db.transaction(async tx => {
        const [run] = await tx
          .insert(decisionRuns)
          .values({
            ...baseRun(options, attempt),
            status: 'failed',
            errorCode: error.code,
            errorMessage: error.message.slice(0, 2_000),
            provider: provider ?? attempt.evaluator.provider,
            providerRequestId:
              attempt.evaluation?.providerRequestId ??
              error.providerRequestId ??
              null
          })
          .returning({ id: decisionRuns.id })
        if (attempt.evaluation) {
          await recordUsage(tx, usageOf(options, attempt, { succeeded: false }))
        }
        return run?.id ?? null
      })
    } catch (storeError) {
      log.logger.error('[executor] could not store the failed run', {
        organizationId: options.organizationId,
        error: String(storeError)
      })
    }
  }

  if (
    error.code === 'MODEL_NOT_FOUND' &&
    options.version.modelRef.version !== undefined &&
    options.version.major !== null
  ) {
    await markModelUnavailable(options.organizationId, options.version.id)
  }

  return evaluatorApiError(error, runId)
}

/** A published version whose pinned model is gone can't run any more (drafts are left alone). */
async function markModelUnavailable(
  organizationId: string,
  versionId: string
): Promise<void> {
  try {
    await db
      .update(decisionTemplateVersions)
      .set({ status: 'model_unavailable' })
      .where(
        and(
          eq(decisionTemplateVersions.id, versionId),
          eq(decisionTemplateVersions.organizationId, organizationId),
          inArray(decisionTemplateVersions.status, ['published', 'deprecated'])
        )
      )
    log.logger.error('[executor] version marked model_unavailable', {
      organizationId,
      versionId
    })
  } catch (updateError) {
    log.logger.error('[executor] could not mark the version unavailable', {
      organizationId,
      versionId,
      error: String(updateError)
    })
  }
}

/** How an evaluator failure is shown to callers: never the provider's own message. */
export interface PublicEvaluatorError {
  status: number
  code: string
  message: string
}

const UNAVAILABLE: PublicEvaluatorError = {
  status: 503,
  code: 'JEV_UNAVAILABLE',
  message: 'The evaluation service is temporarily unavailable; retry later'
}

/**
 * The public status, code and fixed message for an evaluator error code —
 * used for the HTTP error (`evaluatorApiError`) and for a stored failed run
 * on `/v1` (`PublicRunView.error`). A stored `RATE_LIMITED` is always a
 * provider one (quota rejections store no run); unknown codes, like `AUTH`
 * and `BAD_RESPONSE`, are `EVALUATOR_ERROR`.
 */
export function publicEvaluatorError(
  code: string,
  scope?: RateLimitScope
): PublicEvaluatorError {
  switch (code) {
    case 'RATE_LIMITED':
      return scope === 'organization'
        ? {
            status: 429,
            code: 'RATE_LIMITED',
            message:
              "This organization's evaluation quota is exhausted; retry later"
          }
        : UNAVAILABLE
    case 'OVERLOADED':
    case 'UNAVAILABLE':
      return UNAVAILABLE
    case 'TIMEOUT':
      return {
        status: 504,
        code: 'JEV_TIMEOUT',
        message: 'The evaluation did not finish in time; retry later'
      }
    case 'INPUT_TOO_LARGE':
      return {
        status: 422,
        code: 'INPUT_TOO_LARGE',
        message:
          'The input is too large for the model: send less text or fewer fields'
      }
    case 'INVALID_REQUEST':
      return {
        status: 422,
        code: 'TEMPLATE_INVALID',
        message: "The evaluator rejected this template's questions"
      }
    case 'MODEL_NOT_FOUND':
      return {
        status: 500,
        code: 'MODEL_UNAVAILABLE',
        message: 'The model this version pins is no longer available'
      }
    default:
      return {
        status: 500,
        code: 'EVALUATOR_ERROR',
        message: 'The evaluation failed; the error was logged'
      }
  }
}

/**
 * The HTTP error for an `EvaluatorError` (the executor's half of the
 * two-layer error mapping; adapters map provider errors to these codes).
 * `Retry-After` is set, in whole seconds, whenever the evaluator knows it;
 * `details.runId` names the stored failed run, if any.
 */
export function evaluatorApiError(
  error: EvaluatorError,
  runId: string | null = null
): ApiError {
  const { status, code, message } = publicEvaluatorError(
    error.code,
    error.scope
  )
  return new ApiError(status, code, message, {
    ...(runId ? { details: { runId } } : {}),
    ...(error.retryAfterMs === undefined
      ? {}
      : {
          headers: {
            'Retry-After': String(Math.ceil(error.retryAfterMs / 1000))
          }
        })
  })
}
