import { InfoIcon, PlusIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import {
  useDefinition,
  useEditorContext
} from '#/features/template-editor/store/editor-context'
import { decisionLabels } from '#/features/templates/types/definition'
import { Alert, AlertDescription } from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { useEffectBindings } from '../hooks/use-effect-bindings'
import { useUpdateEffectBinding } from '../hooks/use-effect-mutations'
import { useWebhookEndpoints } from '../hooks/use-webhook-endpoints'
import type { EffectBindingView, WebhookEndpointView } from '../types'
import { errorText } from '../utils/errors'
import {
  type EffectGroup,
  type EndpointsStatus,
  effectTriggerOptions,
  groupBindingsByTrigger,
  triggerDescription,
  triggerLabel
} from '../utils/labels'
import { EffectDeleteDialog } from './effect-delete-dialog'
import { EffectFormDialog } from './effect-form-dialog'
import { EffectRow } from './effect-row'
import { EffectWarningsBanner } from './effect-warnings'

function EffectsSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <span className="sr-only">Cargando los efectos…</span>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

function EffectGroupSection({
  group,
  endpointsById,
  endpointsStatus,
  readOnly,
  togglePendingId,
  onToggle,
  onAdd,
  onEdit,
  onDelete
}: {
  group: EffectGroup
  endpointsById: ReadonlyMap<string, WebhookEndpointView>
  endpointsStatus: EndpointsStatus
  readOnly: boolean
  togglePendingId: string | undefined
  onToggle: (binding: EffectBindingView, enabled: boolean) => void
  onAdd: () => void
  onEdit: (binding: EffectBindingView) => void
  onDelete: (binding: EffectBindingView) => void
}) {
  const description = triggerDescription(group.on)

  return (
    <div className="space-y-2 rounded-2xl border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{triggerLabel(group.on)}</h3>
            {group.orphan ? (
              <Badge variant="destructive">Etiqueta eliminada</Badge>
            ) : null}
          </div>
          {description ? (
            <p className="text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {!group.orphan ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAdd}
            disabled={readOnly}
          >
            <PlusIcon aria-hidden="true" />
            Añadir efecto
          </Button>
        ) : null}
      </div>

      {group.bindings.length === 0 ? (
        <p className="rounded-xl border border-dashed p-3 text-xs text-muted-foreground">
          Sin efectos para este disparador.
        </p>
      ) : (
        <div className="space-y-2">
          {group.bindings.map(binding => (
            <EffectRow
              key={binding.id}
              binding={binding}
              endpointsById={endpointsById}
              endpointsStatus={endpointsStatus}
              readOnly={readOnly}
              togglePending={togglePendingId === binding.id}
              onToggle={enabled => onToggle(binding, enabled)}
              onEdit={() => onEdit(binding)}
              onDelete={() => onDelete(binding)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * "Efectos" tab of the template editor: a template's effect bindings
 * ("cuando la decisión es X → hacer Y"), grouped by trigger. Unlike the
 * other tabs, these persist immediately (their own API resource, not part
 * of the draft), so there's no "Guardar" step here.
 */
export function EffectsTab() {
  const { templateId, readOnly } = useEditorContext()
  const definition = useDefinition()
  const bindingsQuery = useEffectBindings(templateId)
  const endpointsQuery = useWebhookEndpoints()
  const updateBinding = useUpdateEffectBinding(templateId)

  const [formState, setFormState] = useState<{
    binding: EffectBindingView | null
    initialOn: string
  } | null>(null)
  const [deleting, setDeleting] = useState<EffectBindingView | null>(null)

  const labels = decisionLabels(definition)
  const triggers = useMemo(() => effectTriggerOptions(labels), [labels])
  const endpointsById = useMemo(
    () =>
      new Map(
        (endpointsQuery.data ?? []).map(endpoint => [endpoint.id, endpoint])
      ),
    [endpointsQuery.data]
  )
  // Gates whether a webhook binding's endpoint id missing from `endpointsById`
  // means "orphaned" (endpoint deleted) — see `EndpointsStatus`. Bindings and
  // endpoints load independently, so a webhook effect must not flash as
  // broken just because endpoints haven't resolved yet (or failed to).
  const endpointsStatus: EndpointsStatus = endpointsQuery.isPending
    ? 'pending'
    : endpointsQuery.error
      ? 'error'
      : 'ready'

  return (
    <div className="space-y-4">
      <Alert>
        <InfoIcon aria-hidden="true" />
        <AlertDescription>
          Las claves de prueba (<code>lr_test_</code>) y el playground nunca
          disparan efectos: solo las ejecuciones reales.
        </AlertDescription>
      </Alert>

      {bindingsQuery.isPending ? (
        <EffectsSkeleton />
      ) : bindingsQuery.error ? (
        <Alert variant="destructive">
          <AlertDescription className="space-y-2">
            <p>
              No se pudieron cargar los efectos:{' '}
              {errorText(bindingsQuery.error)}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void bindingsQuery.refetch()}
            >
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <EffectWarningsBanner warnings={bindingsQuery.data.warnings} />

          {endpointsStatus === 'error' ? (
            <Alert variant="destructive">
              <AlertDescription className="space-y-2">
                <p>
                  No se pudieron cargar los endpoints de webhook:{' '}
                  {errorText(endpointsQuery.error)}. Los efectos de tipo webhook
                  pueden mostrarse como "Sin verificar" hasta que se vuelvan a
                  cargar.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void endpointsQuery.refetch()}
                >
                  Reintentar
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="space-y-3">
            {groupBindingsByTrigger(bindingsQuery.data.data, labels).map(
              group => (
                <EffectGroupSection
                  key={group.on}
                  group={group}
                  endpointsById={endpointsById}
                  endpointsStatus={endpointsStatus}
                  readOnly={readOnly}
                  togglePendingId={
                    updateBinding.isPending
                      ? updateBinding.variables?.bindingId
                      : undefined
                  }
                  onToggle={(binding, enabled) =>
                    updateBinding.mutate({
                      bindingId: binding.id,
                      body: { enabled }
                    })
                  }
                  onAdd={() =>
                    setFormState({ binding: null, initialOn: group.on })
                  }
                  onEdit={binding =>
                    setFormState({ binding, initialOn: group.on })
                  }
                  onDelete={setDeleting}
                />
              )
            )}
          </div>
        </>
      )}

      {formState ? (
        <EffectFormDialog
          templateId={templateId}
          open
          onOpenChange={open => {
            if (!open) setFormState(null)
          }}
          binding={formState.binding}
          initialOn={formState.initialOn}
          triggers={triggers}
        />
      ) : null}

      <EffectDeleteDialog
        templateId={templateId}
        binding={deleting}
        open={deleting !== null}
        onOpenChange={open => {
          if (!open) setDeleting(null)
        }}
      />
    </div>
  )
}
