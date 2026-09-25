import { useForm } from '@tanstack/react-form'
import {
  MailIcon,
  MessageSquareTextIcon,
  PencilIcon,
  WebhookIcon
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useVersions } from '#/features/template-editor/hooks/use-template-queries'
import { Button } from '#/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '#/shared/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '#/shared/components/ui/field'
import { Input } from '#/shared/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '#/shared/components/ui/select'
import { Spinner } from '#/shared/components/ui/spinner'
import { Switch } from '#/shared/components/ui/switch'
import { cn } from '#/shared/utils/shadcn.utils'
import {
  useCreateEffectBinding,
  useUpdateEffectBinding
} from '../hooks/use-effect-mutations'
import {
  defaultEffectFormValues,
  type EffectFormValues,
  effectFormSchema,
  effectFormValuesFromBinding,
  SLACK_WEBHOOK_URL_PREFIX,
  toCreateEffectBindingRequest,
  toUpdateEffectBindingRequest
} from '../schemas/effect-binding'
import type { EffectBindingView, EffectType } from '../types'
import {
  EFFECT_TYPE_DESCRIPTIONS,
  EFFECT_TYPE_LABELS,
  triggerLabel
} from '../utils/labels'
import { EmailRecipientsPicker } from './email-recipients-picker'
import { WebhookEndpointPicker } from './webhook-endpoint-picker'

const TYPE_OPTIONS: { value: EffectType; icon: typeof WebhookIcon }[] = [
  { value: 'webhook', icon: WebhookIcon },
  { value: 'email', icon: MailIcon },
  { value: 'slack', icon: MessageSquareTextIcon }
]

/** A small "pill" choice, matching the rest of the dashboard's forms. */
function PillOption({
  selected,
  disabled,
  onClick,
  children
}: {
  selected: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex flex-1 flex-col items-start gap-0.5 rounded-lg border p-2.5 text-start text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50',
        selected
          ? 'border-primary bg-primary/5 ring-1 ring-primary'
          : 'border-border hover:bg-muted/50'
      )}
    >
      {children}
    </button>
  )
}

/**
 * Creates or edits one effect binding. `type` can't change once created (the
 * API refuses it), so editing shows it read-only.
 */
export function EffectFormDialog({
  templateId,
  open,
  onOpenChange,
  binding,
  initialOn,
  triggers
}: {
  templateId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `null` creates a new binding. */
  binding: EffectBindingView | null
  /** Pre-fills `on` when creating from a group's "+ Añadir efecto". */
  initialOn: string
  /** Every trigger the "on" picker offers: `*`, `needs_review`, then each current label. */
  triggers: readonly string[]
}) {
  const isEdit = binding !== null
  const createBinding = useCreateEffectBinding(templateId)
  const updateBinding = useUpdateEffectBinding(templateId)
  const versionsQuery = useVersions(templateId)
  const [replacingSlackConfig, setReplacingSlackConfig] = useState(false)

  const majors = useMemo(() => {
    const set = new Set(
      (versionsQuery.data ?? []).map(version => version.major)
    )
    return [...set].sort((a, b) => b - a)
  }, [versionsQuery.data])

  const requireSlackUrl = !isEdit || replacingSlackConfig
  const busy = createBinding.isPending || updateBinding.isPending

  const form = useForm({
    defaultValues: binding
      ? effectFormValuesFromBinding(binding)
      : defaultEffectFormValues(initialOn),
    validators: { onSubmit: effectFormSchema(requireSlackUrl) },
    onSubmit: async ({ value }: { value: EffectFormValues }) => {
      try {
        if (binding) {
          await updateBinding.mutateAsync({
            bindingId: binding.id,
            body: toUpdateEffectBindingRequest(
              value,
              binding,
              replacingSlackConfig
            )
          })
        } else {
          await createBinding.mutateAsync(toCreateEffectBindingRequest(value))
        }
        onOpenChange(false)
      } catch {
        // Toasted by the mutation hook; keep the dialog open so it can be fixed.
      }
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) {
          setReplacingSlackConfig(false)
          form.reset()
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar efecto' : 'Nuevo efecto'}</DialogTitle>
          <DialogDescription>
            Cuando la decisión cumple el disparador, dispara esta acción. Las
            claves de prueba (<code>lr_test_</code>) y el playground nunca
            disparan efectos.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={event => {
            event.preventDefault()
            event.stopPropagation()
            form.handleSubmit()
          }}
          className="max-h-[65vh] space-y-4 overflow-y-auto pe-1"
        >
          <form.Field name="on">
            {field => (
              <Field className="gap-1.5">
                <FieldLabel htmlFor="effect-on">Disparador</FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={next => {
                    if (next !== null) field.handleChange(next)
                  }}
                >
                  <SelectTrigger id="effect-on" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {triggers.map(on => (
                      <SelectItem key={on} value={on}>
                        {triggerLabel(on)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="scope">
            {field => (
              <Field className="gap-1.5">
                <FieldLabel>Versiones a las que aplica</FieldLabel>
                <div className="flex gap-2">
                  <PillOption
                    selected={field.state.value === 'all'}
                    onClick={() => field.handleChange('all')}
                  >
                    Todas las versiones mayores
                  </PillOption>
                  <PillOption
                    selected={field.state.value === 'major'}
                    disabled={majors.length === 0}
                    onClick={() => field.handleChange('major')}
                  >
                    Solo una versión mayor
                  </PillOption>
                </div>
                {majors.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Aún no hay versiones publicadas.
                  </p>
                ) : null}
              </Field>
            )}
          </form.Field>

          <form.Subscribe selector={state => state.values.scope}>
            {scope =>
              scope === 'major' ? (
                <form.Field name="major">
                  {field => (
                    <Field className="gap-1.5">
                      <FieldLabel htmlFor="effect-major">
                        Versión mayor
                      </FieldLabel>
                      <Select
                        value={
                          field.state.value
                            ? String(field.state.value)
                            : undefined
                        }
                        onValueChange={value =>
                          field.handleChange(Number(value))
                        }
                      >
                        <SelectTrigger id="effect-major" className="w-full">
                          <SelectValue placeholder="Elige una versión" />
                        </SelectTrigger>
                        <SelectContent>
                          {majors.map(major => (
                            <SelectItem key={major} value={String(major)}>
                              v{major}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}
                </form.Field>
              ) : null
            }
          </form.Subscribe>

          <form.Field name="type">
            {field => (
              <Field className="gap-1.5">
                <FieldLabel>Tipo</FieldLabel>
                {isEdit ? (
                  <p className="text-sm text-muted-foreground">
                    {EFFECT_TYPE_LABELS[field.state.value]} — el tipo no se
                    puede cambiar; elimina este efecto y crea uno nuevo si
                    necesitas otro.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {TYPE_OPTIONS.map(option => (
                      <PillOption
                        key={option.value}
                        selected={field.state.value === option.value}
                        onClick={() => field.handleChange(option.value)}
                      >
                        <option.icon aria-hidden="true" className="size-4" />
                        <span className="font-medium">
                          {EFFECT_TYPE_LABELS[option.value]}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {EFFECT_TYPE_DESCRIPTIONS[option.value]}
                        </span>
                      </PillOption>
                    ))}
                  </div>
                )}
              </Field>
            )}
          </form.Field>

          <form.Subscribe selector={state => state.values.type}>
            {type =>
              type === 'webhook' ? (
                <form.Field name="endpointId">
                  {field => (
                    <Field className="gap-1.5">
                      <FieldLabel>Endpoint</FieldLabel>
                      <WebhookEndpointPicker
                        value={field.state.value}
                        onChange={field.handleChange}
                      />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}
                </form.Field>
              ) : type === 'email' ? (
                <form.Field name="emails">
                  {field => (
                    <Field className="gap-1.5">
                      <FieldLabel>Destinatarios</FieldLabel>
                      <EmailRecipientsPicker
                        value={field.state.value}
                        onChange={field.handleChange}
                      />
                      <FieldError errors={field.state.meta.errors} />
                    </Field>
                  )}
                </form.Field>
              ) : isEdit && binding && !replacingSlackConfig ? (
                <Field className="gap-1.5">
                  <FieldLabel>Slack</FieldLabel>
                  <div className="flex items-center justify-between gap-2 rounded-xl border p-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm">
                        {
                          (binding.config as { webhookUrlHint: string })
                            .webhookUrlHint
                        }
                      </p>
                      {(binding.config as { channel?: string }).channel ? (
                        <p className="text-xs text-muted-foreground">
                          #{(binding.config as { channel?: string }).channel}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setReplacingSlackConfig(true)}
                    >
                      <PencilIcon aria-hidden="true" />
                      Reemplazar
                    </Button>
                  </div>
                </Field>
              ) : (
                <>
                  <form.Field name="slackUrl">
                    {field => (
                      <Field className="gap-1.5">
                        <FieldLabel htmlFor="effect-slack-url">
                          URL del webhook entrante
                        </FieldLabel>
                        <Input
                          id="effect-slack-url"
                          value={field.state.value}
                          onChange={event =>
                            field.handleChange(event.target.value)
                          }
                          placeholder={`${SLACK_WEBHOOK_URL_PREFIX}services/…`}
                        />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="slackChannel">
                    {field => (
                      <Field className="gap-1.5">
                        <FieldLabel htmlFor="effect-slack-channel">
                          Canal (opcional, solo para mostrarlo aquí)
                        </FieldLabel>
                        <Input
                          id="effect-slack-channel"
                          value={field.state.value}
                          onChange={event =>
                            field.handleChange(event.target.value)
                          }
                          placeholder="alertas"
                        />
                      </Field>
                    )}
                  </form.Field>
                </>
              )
            }
          </form.Subscribe>

          <form.Field name="includeInput">
            {field => (
              <div className="space-y-1 rounded-xl border p-3">
                <FieldLabel className="flex items-center gap-2 text-sm font-normal">
                  <Switch
                    checked={field.state.value}
                    onCheckedChange={field.handleChange}
                  />
                  Incluir la entrada de la ejecución
                </FieldLabel>
                <p className="text-xs text-muted-foreground">
                  Se adjunta la entrada guardada de la ejecución al evento.
                  Actívalo solo si el destino necesita verla: puede contener
                  datos personales.
                </p>
              </div>
            )}
          </form.Field>

          <form.Field name="enabled">
            {field => (
              <FieldLabel className="flex items-center gap-2 text-sm font-normal">
                <Switch
                  checked={field.state.value}
                  onCheckedChange={field.handleChange}
                />
                Activo
              </FieldLabel>
            )}
          </form.Field>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="rounded-md"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            className="rounded-md"
            disabled={busy}
            onClick={() => form.handleSubmit()}
          >
            {busy ? <Spinner /> : null}
            {isEdit ? 'Guardar' : 'Crear efecto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
