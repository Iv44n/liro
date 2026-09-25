import { Loader2Icon, RotateCwIcon } from 'lucide-react'
import { ExecutionStatusBadge } from '#/features/webhooks/components/execution-status-badge'
import { useRetryEffectExecution } from '#/features/webhooks/hooks/use-retry-effect-execution'
import { useRunEffects } from '#/features/webhooks/hooks/use-run-effects'
import {
  EFFECT_EVENT_LABELS,
  EFFECT_TYPE_LABELS
} from '#/features/webhooks/utils/labels'
import type { EffectExecutionView } from '#/sdk/modules/executions/types'
import { Button } from '#/shared/components/ui/button'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { formatDuration } from '../utils/format'
import { SectionCard } from './section-card'

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

function ExecutionRow({ execution }: { execution: EffectExecutionView }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">
          {EFFECT_TYPE_LABELS[execution.type]} · {execution.target}
        </p>
        <p className="text-xs text-muted-foreground">
          {EFFECT_EVENT_LABELS[execution.event]} · {execution.attempts}/
          {execution.maxAttempts} intentos ·{' '}
          {formatDuration(execution.lastDurationMs)}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <ExecutionStatusBadge status={execution.status} />
        <RetryButton execution={execution} />
      </div>
    </li>
  )
}

/**
 * The run's effect executions (webhook/email/Slack deliveries it triggered),
 * with status and a "Reintentar" for dead ones. Hidden when the run has
 * none (most runs of templates without effects configured).
 */
export function RunEffects({ runId }: { runId: string }) {
  const { data, isPending, isError } = useRunEffects(runId)

  if (isPending) {
    return (
      <SectionCard title="Efectos">
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-10 w-full rounded-lg" />
        </div>
      </SectionCard>
    )
  }

  // Quiet failure: effects are secondary to the run itself, and most runs
  // have none — no error state is worth interrupting the page for.
  if (isError) return null
  if (data.length === 0) return null

  return (
    <SectionCard
      title="Efectos"
      description="Webhooks, correos o mensajes de Slack que disparó esta ejecución."
    >
      <ul className="divide-y">
        {data.map(execution => (
          <ExecutionRow key={execution.id} execution={execution} />
        ))}
      </ul>
    </SectionCard>
  )
}
