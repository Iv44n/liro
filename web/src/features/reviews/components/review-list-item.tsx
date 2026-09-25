import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from 'lucide-react'
import { DecisionBadge } from '#/features/runs/components/decision-badge'
import { RunModeBadge } from '#/features/runs/components/run-badges'
import {
  formatPercent,
  formatPreciseDateTime,
  formatRelativeTime
} from '#/features/runs/utils/format'
import { inputPreview } from '#/features/runs/utils/input'
import type { ReviewView } from '#/sdk/modules/reviews/types'
import { ReviewReasonBadge } from './review-reason-badge'

/** What the list says about the review's outcome (or the suggestion). */
function Outcome({ review }: { review: ReviewView }) {
  if (review.status === 'resolved') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <span>Decidida:</span>
        <DecisionBadge decision={review.resolvedDecision} />
        {review.resolvedBy ? <span>por {review.resolvedBy.name}</span> : null}
      </span>
    )
  }

  if (review.status === 'dismissed' || review.status === 'expired') {
    return (
      <span>
        {review.status === 'dismissed' ? 'Descartada' : 'Expirada'}
        {review.resolvedBy ? ` por ${review.resolvedBy.name}` : ''}
      </span>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span>Sugerencia:</span>
      {review.suggestedDecision ? (
        <DecisionBadge decision={review.suggestedDecision} />
      ) : (
        <span className="italic">ninguna</span>
      )}
      {review.run.confidence !== null ? (
        <span>· confianza {formatPercent(review.run.confidence)}</span>
      ) : null}
    </span>
  )
}

/** One row of the inbox; the whole row opens the review. */
export function ReviewListItem({
  review,
  now
}: {
  review: ReviewView
  now: number
}) {
  const closedAt = review.status === 'pending' ? null : review.resolvedAt
  const time = closedAt ?? review.createdAt
  const preview = inputPreview(review.run.input)

  return (
    <li>
      <Link
        to="/reviews/$reviewId"
        params={{ reviewId: review.id }}
        className="flex items-start gap-3 px-4 py-3 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="truncate text-sm font-medium">
              {review.template.name}
            </span>
            {review.run.version ? (
              <span className="font-mono text-xs text-muted-foreground">
                @{review.run.version}
              </span>
            ) : null}
            <ReviewReasonBadge reason={review.reason} />
            <RunModeBadge mode={review.run.mode} />
          </div>
          {preview ? (
            <p className="line-clamp-1 text-sm text-muted-foreground">
              {preview}
            </p>
          ) : null}
          <div className="text-xs text-muted-foreground">
            <Outcome review={review} />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 pt-0.5 text-xs text-muted-foreground">
          <time dateTime={time} title={formatPreciseDateTime(time)}>
            {formatRelativeTime(time, now)}
          </time>
          <ChevronRightIcon aria-hidden="true" className="size-4" />
        </div>
      </Link>
    </li>
  )
}
