import { WebhookIcon } from 'lucide-react'
import { useState } from 'react'
import { usePermissions } from '#/features/auth/hooks/use-me'
import { PageHeader } from '#/features/runs/components/page-header'
import { ErrorState } from '#/features/runs/components/query-states'
import type { WebhookEndpointView } from '#/sdk/modules/webhooks/types'
import { Alert, AlertDescription } from '#/shared/components/ui/alert'
import { Card } from '#/shared/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '#/shared/components/ui/empty'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { CreateWebhookDialog } from '../components/create-webhook-dialog'
import { DeleteWebhookDialog } from '../components/delete-webhook-dialog'
import { WebhooksTable } from '../components/webhooks-table'
import { useWebhooks } from '../hooks/use-webhooks'

function WebhooksSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
        <Skeleton key={index} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  )
}

/** `/webhooks`: the organization's webhook endpoints, to create and manage. */
export default function WebhooksPage() {
  const webhooks = useWebhooks()
  const permissions = usePermissions()
  const canManage = permissions?.webhook.manage ?? false
  const now = webhooks.dataUpdatedAt || Date.now()

  const [deleting, setDeleting] = useState<WebhookEndpointView | null>(null)

  const rows = webhooks.data ?? []

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        icon={<WebhookIcon />}
        title="Webhooks"
        description="Endpoints a los que Liro envía eventos de tus decisiones (cuando se toman, o se envían/resuelven a revisión)."
        action={canManage ? <CreateWebhookDialog /> : undefined}
      />

      {permissions && !canManage ? (
        <Alert>
          <AlertDescription>
            Tu rol puede ver los webhooks, pero no crearlos, editarlos ni
            eliminarlos.
          </AlertDescription>
        </Alert>
      ) : null}

      {webhooks.isError ? (
        <ErrorState
          title="No se pudieron cargar los webhooks"
          error={webhooks.error}
          onRetry={() => webhooks.refetch()}
          isRetrying={webhooks.isFetching}
        />
      ) : (
        <Card className="gap-0 py-0">
          {webhooks.isPending ? (
            <WebhooksSkeleton />
          ) : rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <WebhookIcon />
                </EmptyMedia>
                <EmptyTitle>Aún no hay endpoints</EmptyTitle>
                <EmptyDescription>
                  {canManage
                    ? 'Crea uno y úsalo en los efectos de tus decisiones.'
                    : 'Pide a un administrador que cree uno para tu organización.'}
                </EmptyDescription>
              </EmptyHeader>
              {canManage ? (
                <EmptyContent>
                  <CreateWebhookDialog />
                </EmptyContent>
              ) : null}
            </Empty>
          ) : (
            <WebhooksTable
              endpoints={rows}
              now={now}
              canManage={canManage}
              onDelete={setDeleting}
            />
          )}
        </Card>
      )}

      <DeleteWebhookDialog
        endpoint={deleting}
        open={deleting !== null}
        onOpenChange={open => {
          if (!open) setDeleting(null)
        }}
      />
    </div>
  )
}
