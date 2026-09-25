import { Link } from '@tanstack/react-router'
import { MoreHorizontalIcon, TrashIcon } from 'lucide-react'
import {
  formatDateTime,
  formatRelativeTime
} from '#/features/runs/utils/format'
import type { WebhookEndpointView } from '#/sdk/modules/webhooks/types'
import { Button } from '#/shared/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '#/shared/components/ui/dropdown-menu'
import { Switch } from '#/shared/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '#/shared/components/ui/table'
import { useUpdateWebhook } from '../hooks/use-webhooks'
import { urlHost } from '../utils/labels'
import { WebhookStatusBadge } from './webhook-status-badge'

function LastSuccess({ value, now }: { value: string | null; now: number }) {
  if (!value) return <span className="text-muted-foreground">Nunca</span>
  return (
    <time dateTime={value} title={formatDateTime(value)}>
      {formatRelativeTime(value, now)}
    </time>
  )
}

/** The organization's webhook endpoints: a table from `md` up, cards on phones. */
export function WebhooksTable({
  endpoints,
  now,
  canManage,
  onDelete
}: {
  endpoints: readonly WebhookEndpointView[]
  now: number
  canManage: boolean
  onDelete: (endpoint: WebhookEndpointView) => void
}) {
  const updateWebhook = useUpdateWebhook()

  function toggleEnabled(endpoint: WebhookEndpointView) {
    updateWebhook.mutate({
      id: endpoint.id,
      request: { enabled: !endpoint.enabled }
    })
  }

  return (
    <>
      <ul className="divide-y md:hidden">
        {endpoints.map(endpoint => (
          <li key={endpoint.id} className="space-y-2 px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <Link
                to="/webhooks/$endpointId"
                params={{ endpointId: endpoint.id }}
                className="min-w-0 space-y-1"
              >
                <p className="truncate text-sm font-medium">{endpoint.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {urlHost(endpoint.url) ?? endpoint.url}
                </p>
              </Link>
              {canManage ? (
                <Switch
                  size="sm"
                  checked={endpoint.enabled}
                  onCheckedChange={() => toggleEnabled(endpoint)}
                  aria-label={
                    endpoint.enabled
                      ? 'Desactivar endpoint'
                      : 'Activar endpoint'
                  }
                />
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <WebhookStatusBadge endpoint={endpoint} />
              {endpoint.failureCount > 0 ? (
                <span className="text-xs text-muted-foreground">
                  {endpoint.failureCount} fallos seguidos
                </span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Último envío correcto:{' '}
              <LastSuccess value={endpoint.lastSuccessAt} now={now} />
            </p>
          </li>
        ))}
      </ul>

      <Table className="hidden md:table">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Nombre</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Fallos seguidos</TableHead>
            <TableHead>Último envío correcto</TableHead>
            {canManage ? (
              <TableHead className="text-end">
                <span className="sr-only">Acciones</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {endpoints.map(endpoint => (
            <TableRow key={endpoint.id}>
              <TableCell className="max-w-56">
                <Link
                  to="/webhooks/$endpointId"
                  params={{ endpointId: endpoint.id }}
                  className="truncate font-medium hover:underline"
                >
                  {endpoint.name}
                </Link>
              </TableCell>
              <TableCell className="max-w-48 truncate font-mono text-xs text-muted-foreground">
                {urlHost(endpoint.url) ?? endpoint.url}
              </TableCell>
              <TableCell>
                <WebhookStatusBadge endpoint={endpoint} />
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {endpoint.failureCount > 0 ? endpoint.failureCount : '—'}
              </TableCell>
              <TableCell className="text-muted-foreground">
                <LastSuccess value={endpoint.lastSuccessAt} now={now} />
              </TableCell>
              {canManage ? (
                <TableCell className="text-end">
                  <div className="flex items-center justify-end gap-1">
                    <Switch
                      size="sm"
                      checked={endpoint.enabled}
                      onCheckedChange={() => toggleEnabled(endpoint)}
                      aria-label={
                        endpoint.enabled
                          ? 'Desactivar endpoint'
                          : 'Activar endpoint'
                      }
                    />
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Más acciones para ${endpoint.name}`}
                            className="text-muted-foreground"
                          />
                        }
                      >
                        <MoreHorizontalIcon aria-hidden="true" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onDelete(endpoint)}
                        >
                          <TrashIcon aria-hidden="true" />
                          Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}
