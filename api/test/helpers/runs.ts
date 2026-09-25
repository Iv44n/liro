import type { ProviderId } from '#modules/engine/evaluator/port'
import type { ReviewReason } from '#modules/engine/types'
import {
  type ReviewStatus,
  reviewTasks
} from '#modules/reviews/reviews.schemas'
import {
  decisionRuns,
  type RunMode,
  type RunSource,
  type RunStatus
} from '#modules/runs/runs.schemas'
import { NEEDS_REVIEW } from '#modules/templates/definition'
import type { JsonObject } from '#modules/templates/paths'
import { Id } from '#shared/core/base'
import { db } from '#shared/db/config'
import type { TestOrg } from './factories'

/**
 * Inserts `decision_runs`/`review_tasks` rows straight into the database,
 * bypassing the executor — for stats and usage tests, which aggregate over
 * runs rather than exercise a decision end to end. Every field the engine
 * would normally compute is a plain option with a sensible default, so a
 * test only has to name what it cares about (usually `createdAt`, `decision`
 * and `confidence`).
 */

export type RunRow = typeof decisionRuns.$inferSelect
export type ReviewRow = typeof reviewTasks.$inferSelect

export interface InsertRunOptions {
  templateId: string
  versionId: string
  /** The run's time — what every range/bucket filter reads. */
  createdAt: Date
  /** Default: `createdAt`. */
  completedAt?: Date | null
  mode?: RunMode
  source?: RunSource
  status?: RunStatus
  /** A label, or `needs_review`; `null` for a `failed`/`queued`/`running` row. */
  decision?: string | null
  /**
   * Default: `decision` once it is a real label (an auto-decided run's
   * `finalDecision` always equals its `decision`) — `null` for
   * `needs_review` (still pending) or when `decision` itself is `null`.
   */
  finalDecision?: string | null
  suggestion?: string | null
  confidence?: number | null
  rule?: string | null
  reviewReason?: ReviewReason | null
  flags?: string[]
  errorCode?: string | null
  errorMessage?: string | null
  provider?: ProviderId | null
  modelRequested?: string | null
  modelResolved?: string | null
  inputTokens?: number | null
  outputTokens?: number | null
  latencyMs?: number | null
  evaluatorLatencyMs?: number | null
  apiKeyId?: string | null
  userId?: string | null
  metadata?: JsonObject | null
}

/** `succeeded` unless `status` says otherwise. */
export async function insertRun(
  org: TestOrg,
  options: InsertRunOptions
): Promise<RunRow> {
  const status = options.status ?? 'succeeded'
  const decision = options.decision ?? null
  const finalDecision =
    options.finalDecision !== undefined
      ? options.finalDecision
      : decision !== null && decision !== NEEDS_REVIEW
        ? decision
        : null

  const [row] = await db
    .insert(decisionRuns)
    .values({
      id: Id.generate(),
      organizationId: org.id,
      templateId: options.templateId,
      versionId: options.versionId,
      definitionHash: 'test-definition-hash',
      engineVersion: '1',
      mode: options.mode ?? 'live',
      source: options.source ?? 'api',
      apiKeyId: options.apiKeyId ?? null,
      userId: options.userId ?? null,
      metadata: options.metadata ?? null,
      status,
      input: null,
      policyInput: {},
      answers: null,
      signals: {},
      decision,
      suggestion: options.suggestion ?? decision,
      confidence: options.confidence ?? null,
      rule: options.rule ?? null,
      reviewReason: options.reviewReason ?? null,
      flags: options.flags ?? [],
      finalDecision,
      errorCode:
        status === 'failed' ? (options.errorCode ?? 'BAD_RESPONSE') : null,
      errorMessage:
        status === 'failed' ? (options.errorMessage ?? 'Test failure') : null,
      provider: options.provider ?? (status === 'succeeded' ? 'fake' : null),
      modelRequested: options.modelRequested ?? null,
      modelResolved: options.modelResolved ?? null,
      providerRequestId: `test_${Id.generate()}`,
      inputTokens: options.inputTokens ?? null,
      outputTokens: options.outputTokens ?? null,
      latencyMs: options.latencyMs ?? 100,
      evaluatorLatencyMs: options.evaluatorLatencyMs ?? null,
      createdAt: options.createdAt,
      completedAt:
        options.completedAt === undefined
          ? options.createdAt
          : options.completedAt
    })
    .returning()
  if (!row) throw new Error('insertRun: no row returned')
  return row
}

export interface InsertReviewOptions {
  status?: ReviewStatus
  reason?: ReviewReason
  suggestedDecision?: string | null
  allowedDecisions?: string[]
  resolvedDecision?: string | null
  resolvedAt?: Date | null
  /** Default: the run's `createdAt` (a review is created in the run's own transaction). */
  createdAt?: Date
}

/** A `review_tasks` row for a run already inserted with `insertRun`. */
export async function insertReview(
  org: TestOrg,
  run: RunRow,
  options: InsertReviewOptions = {}
): Promise<ReviewRow> {
  const [row] = await db
    .insert(reviewTasks)
    .values({
      id: Id.generate(),
      organizationId: org.id,
      runId: run.id,
      templateId: run.templateId,
      status: options.status ?? 'pending',
      reason: options.reason ?? 'low_confidence',
      suggestedDecision: options.suggestedDecision ?? run.suggestion ?? null,
      allowedDecisions: options.allowedDecisions ?? [],
      resolvedDecision: options.resolvedDecision ?? null,
      resolvedAt: options.resolvedAt ?? null,
      createdAt: options.createdAt ?? run.createdAt
    })
    .returning()
  if (!row) throw new Error('insertReview: no row returned')
  return row
}
