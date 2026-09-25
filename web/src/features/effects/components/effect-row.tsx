import {
  CircleHelpIcon,
  MailIcon,
  MessageSquareTextIcon,
  PencilIcon,
  ShieldAlertIcon,
  Trash2Icon,
  WebhookIcon
} from 'lucide-react'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { Switch } from '#/shared/components/ui/switch'
import type {
  EffectBindingView,
  EffectType,
  WebhookEndpointView
} from '../types'
import {
  configSummary,
  EFFECT_TYPE_LABELS,
  type EndpointsStatus,
  majorScopeLabel
} from '../utils/labels'

const TYPE_ICONS: Record<EffectType, typeof WebhookIcon> = {
  webhook: WebhookIcon,
  email: MailIcon,
  slack: MessageSquareTextIcon
}

/** One effect binding: target, scope, enable switch, edit and delete. */
export function EffectRow({
  binding,
  endpointsById,
  endpointsStatus,
  readOnly,
  togglePending,
  onToggle,
  onEdit,
  onDelete
}: {
  binding: EffectBindingView
  endpointsById: ReadonlyMap<string, WebhookEndpointView>
  /** See `EndpointsStatus`: gates whether a missing endpoint id means "orphaned". */
  endpointsStatus: EndpointsStatus
  readOnly: boolean
  togglePending: boolean
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const Icon = TYPE_ICONS[binding.type]
  const orphanEndpoint =
    binding.type === 'webhook' &&
    endpointsStatus === 'ready' &&
    !endpointsById.has((binding.config as { endpointId: string }).endpointId)
  const endpointStatusUnknown =
    binding.type === 'webhook' &&
    endpointsStatus === 'error' &&
    !endpointsById.has((binding.config as { endpointId: string }).endpointId)

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
      <Icon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {configSummary(binding, endpointsById, endpointsStatus)}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {EFFECT_TYPE_LABELS[binding.type]} · {majorScopeLabel(binding.major)}
          {binding.includeInput ? ' · incluye la entrada' : ''}
        </p>
      </div>

      {orphanEndpoint ? (
        <Badge
          variant="destructive"
          title="El endpoint de este efecto ya no existe"
        >
          <ShieldAlertIcon aria-hidden="true" />
          Endpoint eliminado
        </Badge>
      ) : null}

      {endpointStatusUnknown ? (
        <Badge
          variant="secondary"
          title="No se pudieron cargar los endpoints; no sabemos si este sigue existiendo"
        >
          <CircleHelpIcon aria-hidden="true" />
          Sin verificar
        </Badge>
      ) : null}

      <Switch
        checked={binding.enabled}
        onCheckedChange={onToggle}
        disabled={readOnly || togglePending}
        aria-label={binding.enabled ? 'Desactivar efecto' : 'Activar efecto'}
      />

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onEdit}
          disabled={readOnly}
          aria-label="Editar efecto"
        >
          <PencilIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onDelete}
          disabled={readOnly}
          aria-label="Eliminar efecto"
        >
          <Trash2Icon aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
