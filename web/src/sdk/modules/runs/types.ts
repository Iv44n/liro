import type { JsonObject } from '#/features/templates/types/definition'
import type { ReviewReason, ReviewStatus } from '#/sdk/modules/reviews/types'

/**
 * Shapes of runs (mirrors `api/src/modules/runs/runs.views.ts`).
 * `PublicRunView` is the `/v1` contract; the dashboard's `RunDetailView`
 * adds the operational fields; `RunSummaryView` is a runs-explorer row.
 * Numbers are rounded to 4 decimals; dates are ISO strings.
 */

export const RUN_MODES = ['live', 'test'] as const
export type RunMode = (typeof RUN_MODES)[number]

export const RUN_SOURCES = [
  'api',
  'playground',
  'review',
  'evaluation'
] as const
export type RunSource = (typeof RUN_SOURCES)[number]

export const RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed'
] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** A resolved answer as exposed by the API; `null` when the question wasn't asked. */
export type PublicAnswer =
  | {
      type: 'choice'
      choice: string
      /** Option name → probability; `null` when the provider sent none. */
      probabilities: Record<string, number> | null
      confidence: number | null
    }
  | {
      type: 'score'
      /** Expected level in [0, levels − 1]. */
      score: number
      /** Label of the most probable level. */
      level: string
      /** Level label → probability; `null` when the provider sent none. */
      probabilities: Record<string, number> | null
      confidence: number | null
    }
  | {
      type: 'boolean'
      /** P(true). */
      probability: number
      /** `|2p − 1|`. */
      confidence: number
    }

export type PublicAnswers = Record<string, PublicAnswer | null>

export interface PublicReviewView {
  id: string
  status: ReviewStatus
  reason: ReviewReason
  resolvedDecision: string | null
  resolvedAt: string | null
}

export interface PublicRunView {
  id: string
  /** The template's slug. */
  template: string
  /** `M.m`; `null` for playground runs. */
  version: string | null
  mode: RunMode
  source: RunSource
  status: RunStatus
  /** A declared label or `needs_review`. */
  decision: string | null
  /** `decision`, or the reviewer's decision once resolved; `null` while in review. */
  finalDecision: string | null
  confidence: number | null
  /** What the reviewer is offered by default. */
  suggestion: string | null
  flags: string[]
  /** Id of the precondition/rule that decided; `null` for the fallback. */
  rule: string | null
  reviewReason: ReviewReason | null
  review: PublicReviewView | null
  answers: PublicAnswers | null
  signals: Record<string, number | null> | null
  metadata: JsonObject | null
  model: string | null
  latencyMs: number | null
  createdAt: string
  completedAt: string | null
  error: { code: string; message: string } | null
}

export interface RunDetailView extends PublicRunView {
  templateId: string
  templateName: string
  versionId: string
  /** As stored per the template's `storeInput`; `null` when not kept or purged. */
  input: JsonObject | null
  /** The input paths the policy reads — always kept. */
  policyInput: JsonObject
  provider: string | null
  modelRequested: string | null
  modelResolved: string | null
  providerRequestId: string | null
  inputTokens: number | null
  outputTokens: number | null
  evaluatorLatencyMs: number | null
  apiKeyId: string | null
  userId: string | null
  definitionHash: string
  engineVersion: string
  /** The evaluator's own error code (`AUTH`, `BAD_RESPONSE`, …) and message, for diagnosis. */
  evaluatorError: { code: string; message: string } | null
}

export interface RunSummaryView {
  id: string
  templateId: string
  templateSlug: string
  templateName: string
  version: string | null
  mode: RunMode
  source: RunSource
  status: RunStatus
  decision: string | null
  finalDecision: string | null
  confidence: number | null
  flags: string[]
  /** `null` when the run has no review task. */
  reviewStatus: ReviewStatus | null
  latencyMs: number | null
  createdAt: string
}

export interface RunPage {
  data: RunSummaryView[]
  /** Pass as `cursor` for the next page; `null` on the last one. */
  nextCursor: string | null
}

export const RUNS_PAGE_LIMIT = { default: 50, max: 100 } as const

/** `GET /api/runs` filters. Newest first. */
export interface ListRunsParams {
  templateId?: string
  decision?: string
  mode?: RunMode
  source?: RunSource
  status?: RunStatus
  reviewStatus?: ReviewStatus
  /** Inclusive; ISO date (`2026-01-01`) or date-time with offset. */
  from?: string
  /** Inclusive; ISO date or date-time with offset. */
  to?: string
  /** The previous page's `nextCursor`. */
  cursor?: string
  /** 1..100 (default 50). */
  limit?: number
}
