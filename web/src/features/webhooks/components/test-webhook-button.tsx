import {
  CheckCircle2Icon,
  Loader2Icon,
  SendIcon,
  XCircleIcon
} from 'lucide-react'
import { formatDuration } from '#/features/runs/utils/format'
import { Button } from '#/shared/components/ui/button'
import { useTestWebhook } from '../hooks/use-webhook-secret'

/** "Enviar prueba": sends `webhook.test` right now and shows status + latency inline. */
export function TestWebhookButton({ endpointId }: { endpointId: string }) {
  const test = useTestWebhook(endpointId)
  const result = test.data

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={test.isPending}
        onClick={() => test.mutate()}
      >
        {test.isPending ? (
          <Loader2Icon aria-hidden="true" className="animate-spin" />
        ) : (
          <SendIcon aria-hidden="true" />
        )}
        Enviar prueba
      </Button>

      {result ? (
        <output className="inline-flex items-center gap-1.5 text-sm">
          {result.ok ? (
            <CheckCircle2Icon
              aria-hidden="true"
              className="size-4 text-emerald-600 dark:text-emerald-400"
            />
          ) : (
            <XCircleIcon
              aria-hidden="true"
              className="size-4 text-destructive"
            />
          )}
          {result.ok
            ? `Respondió ${result.status} en ${formatDuration(result.durationMs)}`
            : result.status
              ? `Respondió ${result.status}`
              : (result.error ?? 'No se pudo entregar')}
        </output>
      ) : null}
    </div>
  )
}
