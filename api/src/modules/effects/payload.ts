import type { ReviewRow, RunRow } from '#modules/engine/executor'
import type { ReviewStatus } from '#modules/reviews/reviews.schemas'
import {
  type PublicRunView,
  publicRunView,
  type RunContext
} from '#modules/runs/runs.views'
import type { JsonObject } from '#modules/templates/paths'
import type { EffectEvent } from './effects.schemas'

/**
 * The event envelope sent (or shown) to an effect: what a run looked like
 * when the event fired, per `runs.views` — the exact shape `/v1` callers see
 * — plus the review, when there is one, and the run's stored input, only
 * when the binding asked for it (`includeInput`).
 */

export interface EffectReviewPayload {
  id: string
  status: ReviewStatus
  resolvedDecision: string | null
  /** The user id who resolved it; `null` while pending. */
  resolvedBy: string | null
  comment: string | null
}

export interface EffectPayloadData {
  run: PublicRunView
  review?: EffectReviewPayload
  /** Only present when the binding has `includeInput: true`. */
  input?: JsonObject | null
}

export interface EffectPayload {
  type: EffectEvent
  /** ISO 8601, when the event fired (the run's own clock — see `ExecuteRunOptions`/`resolveReview`). */
  timestamp: string
  data: EffectPayloadData
}

export interface BuildEffectPayloadOptions {
  event: EffectEvent
  /** The event's own time — the run's `now`, not `Date.now()`, so tests can control it. */
  now: Date
  run: RunRow
  context: RunContext
  /** Omit (or pass `null`) for a run with no review task. */
  review?: ReviewRow | null
  includeInput: boolean
}

function reviewPayload(review: ReviewRow): EffectReviewPayload {
  return {
    id: review.id,
    status: review.status,
    resolvedDecision: review.resolvedDecision,
    resolvedBy: review.resolvedBy,
    comment: review.comment
  }
}

export function buildEffectPayload(
  options: BuildEffectPayloadOptions
): EffectPayload {
  const { event, now, run, context, review, includeInput } = options
  const data: EffectPayloadData = {
    run: publicRunView(
      run,
      context,
      review
        ? {
            id: review.id,
            status: review.status,
            reason: review.reason,
            resolvedDecision: review.resolvedDecision,
            resolvedAt: review.resolvedAt
          }
        : null
    )
  }
  if (review) data.review = reviewPayload(review)
  if (includeInput) data.input = run.input

  return { type: event, timestamp: now.toISOString(), data }
}
