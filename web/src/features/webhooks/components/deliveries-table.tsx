import { Link } from '@tanstack/react-router'
import { Loader2Icon, RotateCwIcon } from 'lucide-react'
import { formatDateTime, formatDuration } from '#/features/runs/utils/format'
import type { EffectExecutionView } from '#/sdk/modules/executions/types'
import { Button } from '#/shared/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '#/shared/components/ui/table'
import { useRetryEffectExecution } from '../hooks/use-retry-effect-execution'
import { EFFECT_EVENT_LABELS } from '../utils/labels'
import { ExecutionStatusBadge } from './execution-status-badge'

const RESPONSE_BODY_PREVIEW = 120

function ResponseCell({ execution }: { execution: EffectExecutionView }) {
  if (execution.lastResponseStatus === null && !execution.lastError) {
    return <span className="text-muted-foreground">—</span>
  }
  const body = execution.lastResponseBody
  const preview =
    body && body.length > RESPONSE_BODY_PREVIEW
      ? `${body.slice(0, RESPONSE_BODY_PREVIEW)}…`
      : body
  return (
    <div className="max-w-56 space-y-0.5">
      {execution.lastResponseStatus !== null ? (
        <p className="font-mono text-xs">{execution.lastResponseStatus}</p>
      ) : null}
      {preview ? (
        <p
          className="truncate text-xs text-muted-foreground"
          title={body ?? undefined}
        >
          {preview}
        </p>
      ) : execution.lastError ? (
        <p
          className="truncate text-xs text-destructive"
          title={execution.lastError}
        >
          {execution.lastError}
        </p>
      ) : null}
    </div>
  )
}

function NextRetryCell({ execution }: { execution: EffectExecutionView }) {
  if (execution.status !== 'queued' || execution.attempts === 0) {
    return <span className="text-muted-foreground">—</span>
  }
  return (
    <time dateTime={execution.runAt} className="text-muted-foreground">
      {formatDateTime(execution.runAt)}
    </time>
  )
}

function RetryButton({ execution }: { execution: EffectExecutionView }) {
  const retry = useRetryEffectExecution()
  if (execution.status !== 'dead') return null
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={retry.isPending}
      onClick={() => retry.mutate(execution.id)}
    >
      {retry.isPending ? (
        <Loader2Icon aria-hidden="true" className="animate-spin" />
      ) : (
        <RotateCwIcon aria-hidden="true" />
      )}
      Reintentar
    </Button>
  )
}

/** An endpoint's deliveries: a table from `md` up, cards on phones. */
export function DeliveriesTable({
  deliveries
}: {
  deliveries: readonly EffectExecutionView[]
}) {
  return (
    <>
      <ul className="divide-y md:hidden">
        {deliveries.map(execution => (
          <li key={execution.id} className="space-y-2 px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <p className="truncate text-sm font-medium">
                  {EFFECT_EVENT_LABELS[execution.event]}
                </p>
                <Link
                  to="/runs/$runId"
                  params={{ runId: execution.runId }}
                  className="truncate text-xs text-muted-foreground underline underline-offset-2"
                >
                  Ver ejecución
                </Link>
              </div>
              <ExecutionStatusBadge status={execution.status} />
            </div>
            <ResponseCell execution={execution} />
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>
                {execution.attempts}/{execution.maxAttempts} intentos ·{' '}
                {formatDuration(execution.lastDurationMs)}
              </span>
              <RetryButton execution={execution} />
            </div>
          </li>
        ))}
      </ul>

      <Table className="hidden md:table">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Evento</TableHead>
            <TableHead>Ejecución</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead>Intentos</TableHead>
            <TableHead>Próximo reintento</TableHead>
            <TableHead>Respuesta</TableHead>
            <TableHead>Duración</TableHead>
            <TableHead className="text-end">
              <span className="sr-only">Acciones</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deliveries.map(execution => (
            <TableRow key={execution.id}>
              <TableCell>{EFFECT_EVENT_LABELS[execution.event]}</TableCell>
              <TableCell>
                <Link
                  to="/runs/$runId"
                  params={{ runId: execution.runId }}
                  className="text-xs underline underline-offset-2"
                >
                  Ver ejecución
                </Link>
              </TableCell>
              <TableCell>
                <ExecutionStatusBadge status={execution.status} />
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {execution.attempts}/{execution.maxAttempts}
              </TableCell>
              <TableCell>
                <NextRetryCell execution={execution} />
              </TableCell>
              <TableCell>
                <ResponseCell execution={execution} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {formatDuration(execution.lastDurationMs)}
              </TableCell>
              <TableCell className="text-end">
                <RetryButton execution={execution} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  )
}
