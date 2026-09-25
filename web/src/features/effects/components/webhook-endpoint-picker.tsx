import { AlertTriangleIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { usePermissions } from '#/features/auth/hooks/use-me'
import { CopyButton } from '#/features/runs/components/copy-button'
import { Alert, AlertDescription } from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import { Field, FieldLabel } from '#/shared/components/ui/field'
import { Input } from '#/shared/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '#/shared/components/ui/select'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { Spinner } from '#/shared/components/ui/spinner'
import {
  useCreateWebhookEndpoint,
  useWebhookEndpoints
} from '../hooks/use-webhook-endpoints'
import { urlHost } from '../utils/labels'

/**
 * Picks an existing webhook endpoint, or creates one inline (its signing
 * secret is shown here once, right after creation).
 */
export function WebhookEndpointPicker({
  value,
  onChange,
  disabled
}: {
  value: string
  onChange: (endpointId: string) => void
  disabled?: boolean
}) {
  const endpointsQuery = useWebhookEndpoints()
  const createEndpoint = useCreateWebhookEndpoint()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState<string | null>(null)
  // Creating an endpoint (and seeing its signing secret) is a broader,
  // org-wide capability than editing this template — the API guards it
  // separately (`webhook:manage`, distinct from `template:update`), so it
  // needs its own permission check rather than riding on `disabled`
  // (which only reflects the template editor's read-only state).
  const permissions = usePermissions()
  const canCreateEndpoint = permissions?.webhook.manage ?? false

  const endpoints = endpointsQuery.data ?? []

  if (secret) {
    return (
      <div className="space-y-2 rounded-xl border p-3">
        <Alert>
          <AlertTriangleIcon aria-hidden="true" />
          <AlertDescription>
            Copia el secreto de firma ahora: no volverás a verlo.
          </AlertDescription>
        </Alert>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">
            {secret}
          </code>
          <CopyButton
            value={secret}
            label="Copiar secreto"
            successMessage="Secreto copiado"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setSecret(null)}
        >
          Listo
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {endpointsQuery.isPending ? (
        <Skeleton className="h-9 w-full" />
      ) : (
        <Select
          value={value || undefined}
          onValueChange={next => {
            if (next !== null) onChange(next)
          }}
          disabled={disabled}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Elige un endpoint" />
          </SelectTrigger>
          <SelectContent>
            {endpoints.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                Aún no hay endpoints en la organización.
              </p>
            ) : (
              endpoints.map(endpoint => (
                <SelectItem key={endpoint.id} value={endpoint.id}>
                  {endpoint.name}
                  <span className="text-muted-foreground">
                    · {urlHost(endpoint.url)}
                  </span>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      )}

      {creating && canCreateEndpoint ? (
        <div className="space-y-2 rounded-xl border p-3">
          <Field className="gap-1.5">
            <FieldLabel htmlFor="webhook-endpoint-name">Nombre</FieldLabel>
            <Input
              id="webhook-endpoint-name"
              placeholder="P. ej. Backend de soporte"
              value={name}
              onChange={event => setName(event.target.value)}
              disabled={createEndpoint.isPending}
            />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="webhook-endpoint-url">URL</FieldLabel>
            <Input
              id="webhook-endpoint-url"
              placeholder="https://tu-servidor.com/webhooks/liro"
              value={url}
              onChange={event => setUrl(event.target.value)}
              disabled={createEndpoint.isPending}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={createEndpoint.isPending}
              onClick={() => {
                setCreating(false)
                setName('')
                setUrl('')
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                !name.trim() ||
                !/^https?:\/\//.test(url) ||
                createEndpoint.isPending
              }
              onClick={() => {
                createEndpoint.mutate(
                  { name: name.trim(), url: url.trim() },
                  {
                    onSuccess: created => {
                      onChange(created.endpoint.id)
                      setSecret(created.secret)
                      setCreating(false)
                      setName('')
                      setUrl('')
                    }
                  }
                )
              }}
            >
              {createEndpoint.isPending ? (
                <Spinner />
              ) : (
                <PlusIcon aria-hidden="true" />
              )}
              Crear endpoint
            </Button>
          </div>
        </div>
      ) : canCreateEndpoint ? (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0"
          disabled={disabled}
          onClick={() => setCreating(true)}
        >
          <PlusIcon aria-hidden="true" />
          Crear un endpoint nuevo
        </Button>
      ) : null}
    </div>
  )
}
