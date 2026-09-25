import { Link } from '@tanstack/react-router'
import {
  ArrowUpRightIcon,
  InfoIcon,
  PlayIcon,
  RotateCcwIcon
} from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { DecisionBadge } from '#/features/playground/components/decision-badge'
import { JsonView } from '#/features/playground/components/json-view'
import { InputJsonEditor } from '#/features/playground/components/playground-form'
import { RunErrorAlert } from '#/features/playground/components/run-error-alert'
import {
  formatLatency,
  formatPercent,
  isNeedsReview,
  REVIEW_REASON_LABELS
} from '#/features/playground/utils/format'
import {
  formatJson,
  parseInputJson
} from '#/features/playground/utils/input-form'
import {
  describeRunError,
  type RunErrorView
} from '#/features/playground/utils/run-errors'
import type {
  InputField,
  JsonObject
} from '#/features/templates/types/definition'
import type { PublicRunView } from '#/sdk/modules/runs/types'
import { Alert, AlertDescription } from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import { Spinner } from '#/shared/components/ui/spinner'
import { useRunDecision } from '../hooks/use-run-decision'

const linkClass =
  'inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline'

function RunSummary({ run }: { run: PublicRunView }) {
  const review = isNeedsReview(run.decision)

  return (
    <div className="space-y-2 rounded-xl border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <DecisionBadge decision={run.decision} size="lg" />
        <span className="text-sm text-muted-foreground">
          confianza {formatPercent(run.confidence)} ·{' '}
          {formatLatency(run.latencyMs)}
        </span>
      </div>
      {review ? (
        <p className="text-sm text-muted-foreground">
          {run.reviewReason
            ? `${REVIEW_REASON_LABELS[run.reviewReason]}. `
            : null}
          Se creó una tarea de revisión
          {run.suggestion ? (
            <>
              {' '}
              (sugerencia{' '}
              <code className="font-mono text-foreground">
                {run.suggestion}
              </code>
              )
            </>
          ) : null}
          . <code className="font-mono">finalDecision</code> será{' '}
          <code className="font-mono">null</code> hasta que alguien la resuelva.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <Link
          to="/runs/$runId"
          params={{ runId: run.id }}
          className={linkClass}
        >
          Ver ejecución
          <ArrowUpRightIcon aria-hidden className="size-4" />
        </Link>
        {run.review ? (
          <Link
            to="/reviews/$reviewId"
            params={{ reviewId: run.review.id }}
            className={linkClass}
          >
            Ir a la revisión
            <ArrowUpRightIcon aria-hidden className="size-4" />
          </Link>
        ) : null}
      </div>
    </div>
  )
}

/**
 * "Probar ahora": runs the published version through `/v1` with the
 * dashboard session (a live caller), from an editable JSON input, and shows
 * the response exactly as an integration would receive it.
 */
export function TryNow({
  decisionRef,
  sample,
  fields,
  disabled = false,
  disabledReason
}: {
  /** The ref to call, e.g. `soporte@1`. */
  decisionRef: string
  /** The initial input (the version's example). */
  sample: JsonObject
  fields: readonly InputField[]
  disabled?: boolean
  disabledReason?: string
}) {
  const id = useId()
  const runDecision = useRunDecision(decisionRef)
  const [text, setText] = useState(() => formatJson(sample))
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [runError, setRunError] = useState<RunErrorView | null>(null)
  const [lastInput, setLastInput] = useState<JsonObject | null>(null)

  const run = (input: JsonObject) => {
    setLastInput(input)
    setRunError(null)
    runDecision.mutate(input, {
      onError: error => setRunError(describeRunError(error, fields))
    })
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (disabled || runDecision.isPending) return
    const parsed = parseInputJson(text)
    if (!parsed.ok) {
      setJsonError(parsed.error)
      return
    }
    run(parsed.input)
  }

  const busy = runDecision.isPending
  const result = runDecision.data

  return (
    <div className="space-y-4">
      <Alert>
        <InfoIcon aria-hidden />
        <AlertDescription>
          Ejecuta{' '}
          <code className="font-mono text-foreground">{decisionRef}</code> con
          tu sesión, igual que una clave{' '}
          <code className="font-mono">lr_live_</code>: crea una ejecución real
          y, si el resultado es <code className="font-mono">needs_review</code>,
          una tarea de revisión.
        </AlertDescription>
      </Alert>

      <form onSubmit={submit} noValidate className="space-y-3">
        <InputJsonEditor
          id={`${id}-input`}
          value={text}
          onChange={next => {
            setText(next)
            setJsonError(null)
          }}
          error={jsonError}
          disabled={busy}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={disabled || busy}>
            {busy ? <Spinner aria-hidden /> : <PlayIcon aria-hidden />}
            {busy ? 'Ejecutando…' : 'Probar ahora'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setText(formatJson(sample))
              setJsonError(null)
            }}
            disabled={busy}
          >
            <RotateCcwIcon aria-hidden />
            Restablecer ejemplo
          </Button>
          {disabled && disabledReason ? (
            <p className="w-full text-xs text-muted-foreground">
              {disabledReason}
            </p>
          ) : null}
        </div>
      </form>

      <div aria-live="polite" aria-busy={busy} className="space-y-3">
        {runError ? (
          <RunErrorAlert
            error={runError}
            fieldsShown={false}
            retrying={busy}
            onRetry={lastInput ? () => run(lastInput) : undefined}
          />
        ) : null}
        {result && !runError ? (
          <>
            <RunSummary run={result} />
            <JsonView value={result} label="Respuesta" maxHeight="max-h-96" />
          </>
        ) : null}
      </div>
    </div>
  )
}
