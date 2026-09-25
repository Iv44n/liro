import { Link } from '@tanstack/react-router'
import { Loader2Icon, TrashIcon } from 'lucide-react'
import { useState } from 'react'
import type { WebhookEndpointView } from '#/sdk/modules/webhooks/types'
import { Alert, AlertDescription } from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '#/shared/components/ui/dialog'
import { useDeleteWebhook } from '../hooks/use-webhooks'
import { endpointInUseTemplates } from '../utils/errors'

/**
 * Confirms deleting an endpoint. 409 `ENDPOINT_IN_USE` lists the templates
 * whose effects still point at it, so the dialog stays open with that list
 * instead of closing on error.
 */
export function DeleteWebhookDialog({
  endpoint,
  open,
  onOpenChange,
  onDeleted
}: {
  endpoint: WebhookEndpointView | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called after the endpoint is actually deleted (in addition to closing). */
  onDeleted?: () => void
}) {
  const deleteWebhook = useDeleteWebhook()
  const [inUseTemplates, setInUseTemplates] = useState<
    { id: string; name: string }[] | null
  >(null)

  function handleOpenChange(next: boolean) {
    if (!next) setInUseTemplates(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Eliminar endpoint</DialogTitle>
          <DialogDescription>
            {endpoint ? (
              <>
                «{endpoint.name}» dejará de recibir eventos. Esta acción no se
                puede deshacer.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        {inUseTemplates ? (
          <Alert variant="destructive">
            <AlertDescription>
              <p>
                Está en uso por{' '}
                {inUseTemplates.length === 1
                  ? 'esta decisión'
                  : 'estas decisiones'}
                ; quita sus efectos primero:
              </p>
              <ul className="mt-1.5 list-disc space-y-0.5 ps-4">
                {inUseTemplates.map(template => (
                  <li key={template.id}>
                    <Link
                      to="/decisions/$templateId"
                      params={{ templateId: template.id }}
                      className="underline underline-offset-2"
                    >
                      {template.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            disabled={deleteWebhook.isPending}
            onClick={() => handleOpenChange(false)}
          >
            Cancelar
          </Button>
          {!inUseTemplates ? (
            <Button
              type="button"
              variant="destructive"
              disabled={deleteWebhook.isPending || !endpoint}
              onClick={() => {
                if (!endpoint) return
                deleteWebhook.mutate(endpoint.id, {
                  onSuccess: () => {
                    handleOpenChange(false)
                    onDeleted?.()
                  },
                  onError: error => {
                    const templates = endpointInUseTemplates(error)
                    if (templates) setInUseTemplates(templates)
                  }
                })
              }}
            >
              {deleteWebhook.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <TrashIcon />
              )}
              Eliminar
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
