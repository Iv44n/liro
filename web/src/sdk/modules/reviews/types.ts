import type { JsonObject } from '#/features/templates/types/definition'
import type { PublicAnswers, RunMode } from '#/sdk/modules/runs/types'

/**
 * Shapes of the review inbox (mirrors `api/src/modules/reviews/
 * reviews.views.ts` and `reviews.service.ts`). Dates are ISO strings.
 */

export const REVIEW_STATUSES = [
  'pending',
  'resolved',
  'dismissed',
  'expired'
] as const
export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/** `GET /api/reviews?status=`: `all` lists every status; `pending` is the default. */
export type ReviewListStatus = ReviewStatus | 'all'

export const REVIEW_REASONS = [
  /** The decided label's `minConfidence` wasn't met (or there was no confidence). */
  'low_confidence',
  /** The decided label has `alwaysReview`. */
  'always_review',
  /** A precondition or rule decided `needs_review`. */
  'rule',
  /** No rule matched and the fallback is `needs_review`. */
  'fallback'
] as const
export type ReviewReason = (typeof REVIEW_REASONS)[number]

export const REVIEWS_PAGE_LIMIT = { default: 50, max: 100 } as const
export const REVIEW_COMMENT_MAX_LENGTH = 2_000

/** The run under review, as the inbox shows it. */
export interface ReviewRunView {
  id: string
  mode: RunMode
  /** `M.m` of the version that ran. */
  version: string | null
  /** Always `needs_review` for a run with a review task. */
  decision: string | null
  confidence: number | null
  flags: string[]
  rule: string | null
  /** Every answer with its probabilities (4 decimals). */
  answers: PublicAnswers | null
  signals: Record<string, number | null> | null
  /** As stored per the template's `storeInput` (never `pii` fields); `null` when not kept. */
  input: JsonObject | null
  createdAt: string
}

/** One button of the review: an allowed decision and what it means. */
export interface ReviewDecisionView {
  label: string
  description: string | null
}

export interface ReviewView {
  id: string
  status: ReviewStatus
  reason: ReviewReason
  /** What the engine would have decided; `null` when it had no candidate. */
  suggestedDecision: string | null
  /** What `resolve` accepts: the version's labels (`needs_review` excluded). */
  allowedDecisions: string[]
  /** `null` unless `status` is `resolved`. */
  resolvedDecision: string | null
  /** Who closed the review (resolved or dismissed). */
  resolvedBy: { id: string; name: string } | null
  resolvedAt: string | null
  comment: string | null
  createdAt: string
  template: { id: string; slug: string; name: string }
  run: ReviewRunView
  /** `allowedDecisions` with their descriptions, in the same order. */
  decisions: ReviewDecisionView[]
}

export interface ReviewPage {
  data: ReviewView[]
  /** Pass as `cursor` for the next page; `null` on the last one. */
  nextCursor: string | null
}

/** `pending` is oldest first (a work queue); every other status newest first. */
export interface ListReviewsParams {
  status?: ReviewListStatus
  templateId?: string
  cursor?: string
  /** 1..100 (default 50). */
  limit?: number
}

export interface ReviewStats {
  pending: number
}

export interface ResolveReviewRequest {
  /** One of the review's `allowedDecisions` (else 422 `INVALID_DECISION`). */
  decision: string
  /** ≤ 2000 chars; blank is stored as `null`. */
  comment?: string | null
}

export interface DismissReviewRequest {
  comment?: string | null
}
