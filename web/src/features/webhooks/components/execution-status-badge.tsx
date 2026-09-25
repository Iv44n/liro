import {
  CheckCircle2Icon,
  CircleDashedIcon,
  Loader2Icon,
  OctagonXIcon,
  XCircleIcon
} from 'lucide-react'
import type { ExecutionStatus } from '#/sdk/modules/executions/types'
import { Badge } from '#/shared/components/ui/badge'
import { cn } from '#/shared/utils/shadcn.utils'
import { EXECUTION_STATUS_LABELS } from '../utils/labels'

const statusMeta: Record<
  ExecutionStatus,
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
  dead: {
    className: 'bg-destructive/10 text-destructive',
    icon: OctagonXIcon
  },
  canceled: {
    className: 'bg-muted text-muted-foreground',
    icon: XCircleIcon
  }
}

/** The status of one effect execution (a webhook delivery, email or Slack send). */
export function ExecutionStatusBadge({
  status,
  className
}: {
  status: ExecutionStatus
  className?: string
}) {
  const meta = statusMeta[status]
  const Icon = meta.icon
  return (
    <Badge className={cn(meta.className, className)}>
      <Icon aria-hidden="true" className={cn(meta.spin && 'animate-spin')} />
      {EXECUTION_STATUS_LABELS[status]}
    </Badge>
  )
}
