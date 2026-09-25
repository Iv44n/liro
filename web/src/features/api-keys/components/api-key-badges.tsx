import {
  AlertTriangleIcon,
  BanIcon,
  type CheckCircle2Icon,
  FlaskConicalIcon
} from 'lucide-react'
import type { ApiKeyMode } from '#/sdk/modules/api-keys/types'
import { Badge } from '#/shared/components/ui/badge'
import { cn } from '#/shared/utils/shadcn.utils'
import { API_KEY_MODE_LABELS, type ApiKeyState } from '../utils/api-key'

/** `live` runs for real; `test` (`lr_test_…`) never has effects. */
export function ApiKeyModeBadge({
  mode,
  className
}: {
  mode: ApiKeyMode
  className?: string
}) {
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
      {API_KEY_MODE_LABELS[mode]}
    </Badge>
  )
}

const stateMeta: Record<
  ApiKeyState,
  { label: string; className: string; icon: typeof CheckCircle2Icon } | null
> = {
  active: null,
  expiring: {
    label: 'Expira pronto',
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
    icon: AlertTriangleIcon
  },
  expired: {
    label: 'Expirada',
    className: 'bg-muted text-muted-foreground',
    icon: BanIcon
  },
  disabled: {
    label: 'Deshabilitada',
    className: 'bg-muted text-muted-foreground',
    icon: BanIcon
  }
}

/** Nothing for a normal active key; a badge when it needs attention. */
export function ApiKeyStateBadge({
  state,
  className
}: {
  state: ApiKeyState
  className?: string
}) {
  const meta = stateMeta[state]
  if (!meta) return null
  const Icon = meta.icon
  return (
    <Badge className={cn(meta.className, className)}>
      <Icon aria-hidden="true" />
      {meta.label}
    </Badge>
  )
}
