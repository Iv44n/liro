import { ArrowRightIcon, UserRoundCheckIcon } from 'lucide-react'
import { cn } from '#/shared/utils/shadcn.utils'
import {
  type DecisionOutcome,
  isNeedsReview,
  NEEDS_REVIEW_LABEL
} from '../utils/labels'

const needsReviewClass =
  'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'

/**
 * A decision label (monospace, as declared) or `needs_review`, which is
 * styled apart and named in Spanish.
 */
export function DecisionBadge({
  decision,
  size = 'default',
  className
}: {
  decision: string | null | undefined
  size?: 'default' | 'lg'
  className?: string
}) {
  const sizeClass =
    size === 'lg' ? 'h-8 gap-1.5 px-3 text-sm' : 'h-6 gap-1 px-2 text-xs'

  if (!decision) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border border-dashed text-muted-foreground',
          sizeClass,
          className
        )}
      >
        Sin decisión
      </span>
    )
  }

  if (isNeedsReview(decision)) {
    return (
      <span
        title={decision}
        className={cn(
          'inline-flex max-w-full items-center rounded-full border font-medium',
          needsReviewClass,
          sizeClass,
          className
        )}
      >
        <UserRoundCheckIcon
          aria-hidden="true"
          className={size === 'lg' ? 'size-4' : 'size-3'}
        />
        <span className="truncate">{NEEDS_REVIEW_LABEL}</span>
      </span>
    )
  }

  return (
    <span
      title={decision}
      className={cn(
        'inline-flex max-w-full items-center rounded-full border border-primary/25 bg-primary/10 font-mono font-medium text-foreground',
        sizeClass,
        className
      )}
    >
      <span className="truncate">{decision}</span>
    </span>
  )
}

/**
 * The engine's decision and, when a reviewer changed it, the final one
 * (`Revisión humana → spam`).
 */
export function DecisionOutcomeBadges({
  outcome,
  className
}: {
  outcome: DecisionOutcome
  className?: string
}) {
  if (!outcome.finalDecision) {
    return <DecisionBadge decision={outcome.decision} className={className} />
  }

  return (
    <span
      className={cn('inline-flex max-w-full items-center gap-1', className)}
    >
      <DecisionBadge decision={outcome.decision} />
      <ArrowRightIcon
        aria-hidden="true"
        className="size-3 shrink-0 text-muted-foreground"
      />
      <span className="sr-only">, decisión final:</span>
      <DecisionBadge decision={outcome.finalDecision} />
    </span>
  )
}
