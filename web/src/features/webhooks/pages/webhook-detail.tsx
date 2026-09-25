import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeftIcon, Loader2Icon, WebhookIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { usePermissions } from '#/features/auth/hooks/use-me'
import { FilterSelect } from '#/features/runs/components/filter-select'
import { PageHeader } from '#/features/runs/components/page-header'
import {
  ErrorState,
  isNotFoundError,
  NotFoundState
} from '#/features/runs/components/query-states'
import { SectionCard } from '#/features/runs/components/section-card'
import { formatDateTime } from '#/features/runs/utils/format'
import type { ExecutionStatus } from '#/sdk/modules/executions/types'
import { EXECUTION_STATUSES } from '#/sdk/modules/executions/types'
import { Button } from '#/shared/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '#/shared/components/ui/empty'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { Switch } from '#/shared/components/ui/switch'
import { DeleteWebhookDialog } from '../components/delete-webhook-dialog'
import { DeliveriesTable } from '../components/deliveries-table'
import { RevealSecretDialog } from '../components/reveal-secret-dialog'
import { RotateSecretDialog } from '../components/rotate-secret-dialog'
import { TestWebhookButton } from '../components/test-webhook-button'
import { WebhookStatusBadge } from '../components/webhook-status-badge'
import { useWebhookDeliveries } from '../hooks/use-webhook-deliveries'
import { useUpdateWebhook, useWebhook } from '../hooks/use-webhooks'
import { EXECUTION_STATUS_LABELS } from '../utils/labels'

export interface WebhookDetailPageProps {
  endpointId: string
}

function BackToWebhooks() {
  return (
    <Link
      to="/webhooks"
      className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
      Webhooks
    </Link>
  )
}

function WebhookDetailSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="space-y-2 border-b pb-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-64" />
      </div>
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  )
}

const statusOptions = EXECUTION_STATUSES.map(status => ({
  value: status,
  label: EXECUTION_STATUS_LABELS[status]
}))

/** `/webhooks/$endpointId`: one endpoint's details, secret and deliveries. */
export default function WebhookDetailPage({
  endpointId
}: WebhookDetailPageProps) {
  const permissions = usePermissions()
  const canManage = permissions?.webhook.manage ?? false
  const navigate = useNavigate()

  const {
    data: endpoint,
    isPending,
    isError,
    error,
    refetch,
    isFetching
  } = useWebhook(endpointId)
  const updateWebhook = useUpdateWebhook()
  const [deleting, setDeleting] = useState(false)
  const [statusFilter, setStatusFilter] = useState<ExecutionStatus | null>(null)

  const deliveries = useWebhookDeliveries(endpointId, statusFilter)
  const rows = useMemo(
    () => deliveries.data?.pages.flatMap(page => page.data) ?? [],
    [deliveries.data]
  )

  if (isPending) {
    return (
      <div className="mx-auto w-full max-w-5xl">
        <WebhookDetailSkeleton />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <BackToWebhooks />
        {isNotFoundError(error) ? (
          <NotFoundState
            title="Endpoint no encontrado"
            description="No existe o pertenece a otra organización."
            action={
              <Button nativeButton={false} render={<Link to="/webhooks" />}>
                Ver webhooks
              </Button>
            }
          />
        ) : (
          <ErrorState
            title="No se pudo cargar el endpoint"
            error={error}
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <PageHeader
        eyebrow={<BackToWebhooks />}
        icon={<WebhookIcon />}
        title={endpoint.name}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <WebhookStatusBadge endpoint={endpoint} />
            <span className="font-mono text-xs">{endpoint.url}</span>
          </span>
        }
        action={
          canManage ? (
            <>
              <div className="flex items-center gap-2 text-sm">
                <Switch
                  checked={endpoint.enabled}
                  onCheckedChange={checked =>
                    updateWebhook.mutate({
                      id: endpoint.id,
                      request: { enabled: checked }
                    })
                  }
                  disabled={updateWebhook.isPending}
                  aria-label={
                    endpoint.enabled
                      ? 'Desactivar endpoint'
                      : 'Activar endpoint'
                  }
                />
                {endpoint.enabled ? 'Activo' : 'Desactivado'}
              </div>
              <Button
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleting(true)}
              >
                Eliminar
              </Button>
            </>
          ) : undefined
        }
      />

      <SectionCard
        title="Detalles"
        description={endpoint.description || undefined}
        action={
          canManage ? (
            <div className="flex flex-wrap items-center gap-2">
              <RevealSecretDialog endpointId={endpoint.id} />
              <RotateSecretDialog endpointId={endpoint.id} />
            </div>
          ) : undefined
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Fallos consecutivos</p>
            <p className="text-sm font-medium tabular-nums">
              {endpoint.failureCount}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Último envío correcto
            </p>
            <p className="text-sm font-medium">
              {endpoint.lastSuccessAt
                ? formatDateTime(endpoint.lastSuccessAt)
                : 'Nunca'}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Último fallo</p>
            <p className="text-sm font-medium">
              {endpoint.lastFailureAt
                ? formatDateTime(endpoint.lastFailureAt)
                : 'Ninguno'}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Creado</p>
            <p className="text-sm font-medium">
              {formatDateTime(endpoint.createdAt)}
            </p>
          </div>
        </div>

        {canManage ? (
          <div className="mt-4 border-t pt-4">
            <TestWebhookButton endpointId={endpoint.id} />
          </div>
        ) : null}
      </SectionCard>

      <SectionCard
        title="Entregas"
        description="Cada evento que un efecto de una decisión envió a este endpoint."
        action={
          <FilterSelect
            id="deliveries-status"
            label="Estado"
            anyLabel="Todos"
            value={statusFilter}
            options={statusOptions}
            className="w-40"
            onChange={value => setStatusFilter(value as ExecutionStatus | null)}
          />
        }
      >
        {deliveries.isError && !deliveries.data ? (
          <ErrorState
            title="No se pudieron cargar las entregas"
            error={deliveries.error}
            onRetry={() => deliveries.refetch()}
            isRetrying={deliveries.isFetching}
          />
        ) : deliveries.isPending ? (
          <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: 3 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
              <Skeleton key={index} className="h-10 w-full rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WebhookIcon />
              </EmptyMedia>
              <EmptyTitle>Sin entregas</EmptyTitle>
              <EmptyDescription>
                {statusFilter
                  ? 'Ninguna entrega coincide con ese estado.'
                  : 'Todavía no se envió ningún evento a este endpoint.'}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-4">
            <DeliveriesTable deliveries={rows} />
            {deliveries.hasNextPage ? (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => deliveries.fetchNextPage()}
                  disabled={deliveries.isFetchingNextPage}
                >
                  {deliveries.isFetchingNextPage ? (
                    <Loader2Icon aria-hidden="true" className="animate-spin" />
                  ) : null}
                  Cargar más
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>

      <DeleteWebhookDialog
        endpoint={deleting ? endpoint : null}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={() => navigate({ to: '/webhooks' })}
      />
    </div>
  )
}
