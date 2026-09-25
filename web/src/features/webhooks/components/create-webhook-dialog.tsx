import { useForm } from '@tanstack/react-form'
import {
  AlertTriangleIcon,
  Loader2Icon,
  PlusIcon,
  WebhookIcon
} from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '#/features/runs/components/copy-button'
import type { CreatedWebhookEndpoint } from '#/sdk/modules/webhooks/types'
import { FormInput } from '#/shared/components/base/form-input'
import { Alert, AlertDescription } from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '#/shared/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '#/shared/components/ui/field'
import { Textarea } from '#/shared/components/ui/textarea'
import { useCreateWebhook } from '../hooks/use-webhooks'
import {
  createWebhookDefaults,
  createWebhookSchema,
  toCreateWebhookRequest
} from '../schemas/create-webhook'
import { VerifyWebhookSnippet } from './verify-webhook-snippet'

/** The form step: name, URL and description. */
function CreateWebhookForm({
  onCreated
}: {
  onCreated: (created: CreatedWebhookEndpoint) => void
}) {
  const createWebhook = useCreateWebhook()

  const form = useForm({
    defaultValues: createWebhookDefaults,
    validators: { onSubmit: createWebhookSchema },
    onSubmit: ({ value }) => {
      createWebhook.mutate(toCreateWebhookRequest(value), {
        onSuccess: onCreated
      })
    }
  })

  return (
    <form
      onSubmit={event => {
        event.preventDefault()
        event.stopPropagation()
        form.handleSubmit()
      }}
      className="space-y-4"
    >
      <form.Field name="name">
        {field => (
          <FormInput
            name={field.name}
            label="Nombre"
            value={field.state.value}
            onValueChange={field.handleChange}
            onBlur={field.handleBlur}
            errorMessage={field.state.meta.errors[0]?.message}
            placeholder="CRM de ventas"
            required
          />
        )}
      </form.Field>

      <form.Field name="url">
        {field => (
          <FormInput
            name={field.name}
            label="URL"
            value={field.state.value}
            onValueChange={field.handleChange}
            onBlur={field.handleBlur}
            errorMessage={field.state.meta.errors[0]?.message}
            placeholder="https://tu-sistema.com/webhooks/liro"
            required
          />
        )}
      </form.Field>

      <form.Field name="description">
        {field => {
          const errorMessage = field.state.meta.errors[0]?.message
          return (
            <Field data-invalid={Boolean(errorMessage)} className="space-y-2">
              <FieldLabel htmlFor={field.name}>
                Descripción (opcional)
              </FieldLabel>
              <Textarea
                id={field.name}
                name={field.name}
                value={field.state.value}
                onChange={event => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                placeholder="Para qué se usa este endpoint"
                rows={2}
              />
              {errorMessage ? (
                <FieldError errors={[{ message: errorMessage }]} />
              ) : null}
            </Field>
          )
        }}
      </form.Field>

      <DialogFooter>
        <form.Subscribe selector={state => state.isSubmitting}>
          {isSubmitting => {
            const isLoading = isSubmitting || createWebhook.isPending
            return (
              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? (
                  <Loader2Icon aria-hidden="true" className="animate-spin" />
                ) : (
                  <WebhookIcon aria-hidden="true" />
                )}
                {isLoading ? 'Creando…' : 'Crear endpoint'}
              </Button>
            )
          }}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}

/** The reveal step: the signing secret, once, plus how to verify it. */
function RevealWebhookSecret({
  created,
  onDone
}: {
  created: CreatedWebhookEndpoint
  onDone: () => void
}) {
  return (
    <div className="space-y-4">
      <Alert>
        <AlertTriangleIcon aria-hidden="true" />
        <AlertDescription>
          Cópialo ahora: por seguridad, no podrás volver a verlo (pero podrás
          rotarlo más adelante).
        </AlertDescription>
      </Alert>

      <div className="flex items-center gap-2 rounded-xl border bg-muted/40 p-3">
        <code className="min-w-0 flex-1 truncate font-mono text-sm">
          {created.secret}
        </code>
        <CopyButton
          value={created.secret}
          label="Copiar secreto"
          variant="secondary"
          successMessage="Secreto copiado"
        />
      </div>

      <VerifyWebhookSnippet />

      <DialogFooter>
        <Button type="button" className="w-full" onClick={onDone}>
          Listo, ya lo copié
        </Button>
      </DialogFooter>
    </div>
  )
}

/** "Nuevo endpoint": a form, then the created endpoint's secret shown exactly once. */
export function CreateWebhookDialog() {
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState<CreatedWebhookEndpoint | null>(null)

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setCreated(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      // Closing by clicking outside or pressing Escape while the secret is
      // shown would lose it silently; "Listo" is the only way out then.
      disablePointerDismissal={Boolean(created)}
    >
      <DialogTrigger render={<Button />}>
        <PlusIcon aria-hidden="true" />
        Nuevo endpoint
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton={!created}>
        <DialogHeader>
          <DialogTitle>
            {created ? 'Endpoint creado' : 'Nuevo endpoint'}
          </DialogTitle>
          <DialogDescription>
            {created
              ? `«${created.endpoint.name}» ya puede recibir eventos.`
              : 'Un destino al que enviar eventos de tus decisiones (por ejemplo, cuando se toma o revisa una).'}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <RevealWebhookSecret
            created={created}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <CreateWebhookForm onCreated={setCreated} />
        )}
      </DialogContent>
    </Dialog>
  )
}
