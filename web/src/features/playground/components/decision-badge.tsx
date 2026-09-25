import {
  CircleCheckIcon,
  CircleSlashIcon,
  UserRoundSearchIcon
} from 'lucide-react'
import { cn } from '#/shared/utils/shadcn.utils'
import { isNeedsReview } from '../utils/format'

/**
 * A run's decision: a label (primary), `needs_review` (amber, "Revisión
 * humana") or none. `size="lg"` is the playground's headline.
 */
export function DecisionBadge({
  decision,
  size = 'default',
  className
}: {
  decision: string | null
  size?: 'default' | 'lg'
  className?: string
}) {
  const review = isNeedsReview(decision)
  const Icon =
    decision === null
      ? CircleSlashIcon
      : review
        ? UserRoundSearchIcon
        : CircleCheckIcon

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border font-medium',
        size === 'lg'
          ? 'px-3.5 py-1.5 text-base [&>svg]:size-5'
          : 'px-2 py-0.5 text-xs [&>svg]:size-3.5',
        decision === null
          ? 'border-border bg-muted text-muted-foreground'
          : review
            ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
            : 'border-primary/30 bg-primary/10 text-foreground [&>svg]:text-primary',
        className
      )}
    >
      <Icon aria-hidden className="shrink-0" />
      <span className="truncate font-mono">
        {decision === null ? 'sin decisión' : decision}
      </span>
      {review ? (
        <span className="shrink-0 font-sans text-[0.8em] font-normal opacity-80">
          · revisión humana
        </span>
      ) : null}
    </span>
  )
}
