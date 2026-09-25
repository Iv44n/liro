import {
  CheckCircle2Icon,
  CircleDashedIcon,
  FlaskConicalIcon,
  Loader2Icon,
  XCircleIcon
} from 'lucide-react'
import { REVIEW_STATUS_LABELS } from '#/features/reviews/utils/labels'
import type { ReviewStatus } from '#/sdk/modules/reviews/types'
import type { RunMode, RunStatus } from '#/sdk/modules/runs/types'
import { Badge } from '#/shared/components/ui/badge'
import { cn } from '#/shared/utils/shadcn.utils'
import { RUN_MODE_LABELS, RUN_STATUS_LABELS } from '../utils/labels'

const statusMeta: Record<
  RunStatus,
  { className: string; icon: typeof CheckCircle2Icon; spin?: boolean }
> = {
  queued: {
    className: 'bg-muted text-muted-foreground',
    icon: CircleDashedIcon
  },
  running: {
    className: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
    icon: Loader2Icon,
    spin: true
  },
  succeeded: {
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    icon: CheckCircle2Icon
  },
  failed: {
    className: 'bg-destructive/10 text-destructive',
    icon: XCircleIcon
  }
}

export function RunStatusBadge({
  status,
  className
}: {
  status: RunStatus
  className?: string
}) {
  const meta = statusMeta[status]
  const Icon = meta.icon
  return (
    <Badge className={cn(meta.className, className)}>
      <Icon aria-hidden="true" className={cn(meta.spin && 'animate-spin')} />
      {RUN_STATUS_LABELS[status]}
    </Badge>
  )
}

/**
 * Test runs are marked (live ones are the norm and need no badge unless
 * `showLive`).
 */
export function RunModeBadge({
  mode,
  showLive = false,
  className
}: {
  mode: RunMode
  showLive?: boolean
  className?: string
}) {
  if (mode === 'live' && !showLive) return null

  return (
    <Badge
      variant="outline"
      className={cn(
        mode === 'test' &&
          'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
        className
      )}
    >
      {mode === 'test' ? <FlaskConicalIcon aria-hidden="true" /> : null}
      {RUN_MODE_LABELS[mode]}
    </Badge>
  )
}

const reviewStatusClass: Record<ReviewStatus, string> = {
  pending: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  resolved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  dismissed: 'bg-muted text-muted-foreground',
  expired: 'bg-muted text-muted-foreground'
}

export function ReviewStatusBadge({
  status,
  className
}: {
  status: ReviewStatus
  className?: string
}) {
  return (
    <Badge className={cn(reviewStatusClass[status], className)}>
      {REVIEW_STATUS_LABELS[status]}
    </Badge>
  )
}
