import type { ReviewReason } from '#/sdk/modules/reviews/types'
import { Badge } from '#/shared/components/ui/badge'
import { cn } from '#/shared/utils/shadcn.utils'
import { REVIEW_REASON_LABELS } from '../utils/labels'

/** Why the run went to review ("Confianza baja", "Regla"…), explained on hover. */
export function ReviewReasonBadge({
  reason,
  className
}: {
  reason: ReviewReason
  className?: string
}) {
  const meta = REVIEW_REASON_LABELS[reason]
  return (
    <Badge
      variant="outline"
      title={meta.description}
      className={cn('text-muted-foreground', className)}
    >
      {meta.label}
    </Badge>
  )
}
