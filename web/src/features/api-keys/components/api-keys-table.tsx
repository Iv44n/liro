import { Trash2Icon } from 'lucide-react'
import {
  formatDateTime,
  formatRelativeTime,
  formatTimeUntil
} from '#/features/runs/utils/format'
import type { ApiKeyView } from '#/sdk/modules/api-keys/types'
import { Button } from '#/shared/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '#/shared/components/ui/table'
import { apiKeyState, maskedApiKey } from '../utils/api-key'
import { ApiKeyModeBadge, ApiKeyStateBadge } from './api-key-badges'

function ExpiresAt({
  expiresAt,
  now
}: {
  expiresAt: string | null
  now: number
}) {
  if (!expiresAt) {
    return <span className="text-muted-foreground">Nunca</span>
  }
  const until = formatTimeUntil(expiresAt, now)
  return (
    <time dateTime={expiresAt} title={formatDateTime(expiresAt)}>
      {until ?? formatDateTime(expiresAt)}
    </time>
  )
}

function LastUsed({ value, now }: { value: string | null; now: number }) {
  if (!value) return <span className="text-muted-foreground">Nunca</span>
  return (
    <time dateTime={value} title={formatDateTime(value)}>
      {formatRelativeTime(value, now)}
    </time>
  )
}

/** The organization's API keys: a table from `md` up, cards on phones. */
export function ApiKeysTable({
  apiKeys,
  now,
  canRevoke,
  onRevoke
}: {
  apiKeys: readonly ApiKeyView[]
  now: number
  canRevoke: boolean
  onRevoke: (apiKey: ApiKeyView) => void
}) {
  return (
    <>
      <ul className="divide-y md:hidden">
        {apiKeys.map(apiKey => {
          const state = apiKeyState(apiKey, now)
          const revoked = apiKey.enabled === false
          return (
            <li key={apiKey.id} className="space-y-2 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">
                    {apiKey.name || 'Sin nombre'}
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {maskedApiKey(apiKey)}
                  </p>
                </div>
                {canRevoke && !revoked ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Revocar API key"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onRevoke(apiKey)}
                  >
                    <Trash2Icon aria-hidden="true" />
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <ApiKeyModeBadge mode={apiKey.mode} />
                <ApiKeyStateBadge state={state} />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Creada {formatRelativeTime(apiKey.createdAt, now)}</span>
                <span>
                  Último uso: <LastUsed value={apiKey.lastRequest} now={now} />
                </span>
                <span>
                  Expira: <ExpiresAt expiresAt={apiKey.expiresAt} now={now} />
                </span>
              </div>
            </li>
          )
        })}
      </ul>

      <Table className="hidden md:table">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Nombre</TableHead>
            <TableHead>Modo</TableHead>
            <TableHead>Clave</TableHead>
            <TableHead>Creada</TableHead>
            <TableHead>Último uso</TableHead>
            <TableHead>Expira</TableHead>
            {canRevoke ? (
              <TableHead className="text-end">
                <span className="sr-only">Acciones</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {apiKeys.map(apiKey => {
            const state = apiKeyState(apiKey, now)
            const revoked = apiKey.enabled === false
            return (
              <TableRow key={apiKey.id}>
                <TableCell className="max-w-48">
                  <span className="truncate font-medium">
                    {apiKey.name || 'Sin nombre'}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ApiKeyModeBadge mode={apiKey.mode} />
                    <ApiKeyStateBadge state={state} />
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {maskedApiKey(apiKey)}
                </TableCell>
                <TableCell
                  className="text-muted-foreground"
                  title={formatDateTime(apiKey.createdAt)}
                >
                  {formatRelativeTime(apiKey.createdAt, now)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <LastUsed value={apiKey.lastRequest} now={now} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <ExpiresAt expiresAt={apiKey.expiresAt} now={now} />
                </TableCell>
                {canRevoke ? (
                  <TableCell className="text-end">
                    {!revoked ? (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Revocar ${apiKey.name || 'API key'}`}
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => onRevoke(apiKey)}
                      >
                        <Trash2Icon aria-hidden="true" />
                      </Button>
                    ) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </>
  )
}
