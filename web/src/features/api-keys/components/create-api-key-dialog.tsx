import { useForm } from '@tanstack/react-form'
import {
  AlertTriangleIcon,
  KeyRoundIcon,
  Loader2Icon,
  PlusIcon
} from 'lucide-react'
import { useState } from 'react'
import { CopyButton } from '#/features/runs/components/copy-button'
import type { CreatedApiKey } from '#/sdk/modules/api-keys/types'
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
import { Field, FieldLabel } from '#/shared/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '#/shared/components/ui/select'
import { cn } from '#/shared/utils/shadcn.utils'
import { useCreateApiKey } from '../hooks/use-api-keys'
import {
  API_KEY_EXPIRATION_LABELS,
  API_KEY_EXPIRATIONS,
  type ApiKeyExpiration,
  createApiKeyDefaults,
  createApiKeySchema,
  toCreateApiKeyRequest
} from '../schemas/create-api-key'

const modeOptions: { value: 'live' | 'test'; label: string; hint: string }[] = [
  {
    value: 'live',
    label: 'Producción',
    hint: 'lr_live_… · afecta datos reales'
  },
  { value: 'test', label: 'Prueba', hint: 'lr_test_… · sin efectos' }
]

/** The form step: name, mode and expiration. */
function CreateApiKeyForm({
  onCreated
}: {
  onCreated: (key: CreatedApiKey) => void
}) {
  const createApiKey = useCreateApiKey()

  const form = useForm({
    defaultValues: createApiKeyDefaults,
    validators: { onSubmit: createApiKeySchema },
    onSubmit: ({ value }) => {
      createApiKey.mutate(toCreateApiKeyRequest(value), {
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
            placeholder="Backend de producción"
            required
          />
        )}
      </form.Field>

      <form.Field name="mode">
        {field => (
          <Field className="gap-2">
            <FieldLabel className="text-sm font-medium">Modo</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              {modeOptions.map(option => {
                const isSelected = field.state.value === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => field.handleChange(option.value)}
                    className={cn(
                      'flex flex-col items-start gap-0.5 rounded-lg border p-3 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary',
                      isSelected
                        ? 'border-primary bg-primary/5 ring-1 ring-primary'
                        : 'border-border hover:bg-muted/50'
                    )}
                  >
                    <span className="text-sm font-medium">{option.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {option.hint}
                    </span>
                  </button>
                )
              })}
            </div>
          </Field>
        )}
      </form.Field>

      <form.Field name="expiration">
        {field => (
          <Field className="gap-1.5">
            <FieldLabel htmlFor="api-key-expiration">Expiración</FieldLabel>
            <Select
              items={API_KEY_EXPIRATIONS.map(value => ({
                value,
                label: API_KEY_EXPIRATION_LABELS[value]
              }))}
              value={field.state.value}
              onValueChange={value =>
                field.handleChange(value as ApiKeyExpiration)
              }
            >
              <SelectTrigger id="api-key-expiration" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {API_KEY_EXPIRATIONS.map(value => (
                  <SelectItem key={value} value={value}>
                    {API_KEY_EXPIRATION_LABELS[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </form.Field>

      <DialogFooter>
        <form.Subscribe selector={state => state.isSubmitting}>
          {isSubmitting => {
            const isLoading = isSubmitting || createApiKey.isPending
            return (
              <Button type="submit" disabled={isLoading} className="w-full">
                {isLoading ? (
                  <Loader2Icon aria-hidden="true" className="animate-spin" />
                ) : (
                  <KeyRoundIcon aria-hidden="true" />
                )}
                {isLoading ? 'Creando…' : 'Crear API key'}
              </Button>
            )
          }}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}

/** The reveal step: the full key, once, with a copy button. */
function RevealApiKey({
  apiKey,
  onDone
}: {
  apiKey: CreatedApiKey
  onDone: () => void
}) {
  return (
    <div className="space-y-4">
      <Alert>
        <AlertTriangleIcon aria-hidden="true" />
        <AlertDescription>
          Cópiala ahora: por seguridad, no podrás volver a verla.
        </AlertDescription>
      </Alert>

      <div className="flex items-center gap-2 rounded-xl border bg-muted/40 p-3">
        <code className="min-w-0 flex-1 truncate font-mono text-sm">
          {apiKey.key}
        </code>
        <CopyButton
          value={apiKey.key}
          label="Copiar API key"
          variant="secondary"
          successMessage="API key copiada"
        />
      </div>

      <DialogFooter>
        <Button type="button" className="w-full" onClick={onDone}>
          Listo, ya la copié
        </Button>
      </DialogFooter>
    </div>
  )
}

/** "Nueva API key": a form, then the created key shown exactly once. */
export function CreateApiKeyDialog() {
  const [open, setOpen] = useState(false)
  const [created, setCreated] = useState<CreatedApiKey | null>(null)

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setCreated(null)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      // Closing by clicking outside or pressing Escape while the key is
      // shown would lose it silently; "Listo" is the only way out then.
      disablePointerDismissal={Boolean(created)}
    >
      <DialogTrigger render={<Button />}>
        <PlusIcon aria-hidden="true" />
        Nueva API key
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" showCloseButton={!created}>
        <DialogHeader>
          <DialogTitle>
            {created ? 'API key creada' : 'Nueva API key'}
          </DialogTitle>
          <DialogDescription>
            {created
              ? `«${created.name ?? 'Sin nombre'}» ya puede llamar a la API.`
              : 'Úsala en tu backend para llamar a las decisiones de Liro.'}
          </DialogDescription>
        </DialogHeader>
        {created ? (
          <RevealApiKey apiKey={created} onDone={() => onOpenChange(false)} />
        ) : (
          <CreateApiKeyForm onCreated={setCreated} />
        )}
      </DialogContent>
    </Dialog>
  )
}
