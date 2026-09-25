import { MessageCircleQuestionIcon } from 'lucide-react'
import type { PublicAnswers } from '#/sdk/modules/runs/types'
import { Badge } from '#/shared/components/ui/badge'
import { answerTypeLabel, signalRows, summarizeAnswers } from '../utils/answers'
import { formatNumber, formatPercent } from '../utils/format'
import { MeterBar, ProbabilityRow } from './probability-bar'

/**
 * Per-question answers with a probability bar per option, level or yes/no.
 * Questions that weren't asked (their `when` didn't hold, or a precondition
 * decided first) are listed as such.
 */
export function AnswersList({
  answers,
  emptyMessage = 'No se hicieron preguntas: una precondición decidió antes de consultar al modelo.'
}: {
  answers: PublicAnswers | null | undefined
  emptyMessage?: string
}) {
  const summaries = summarizeAnswers(answers)

  if (summaries.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>
  }

  return (
    <ul className="divide-y">
      {summaries.map(summary => (
        <li key={summary.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <MessageCircleQuestionIcon
              aria-hidden="true"
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="font-mono text-sm font-medium break-all">
              {summary.id}
            </span>
            {summary.asked ? (
              <>
                <Badge variant="outline">{answerTypeLabel(summary.type)}</Badge>
                <span className="ms-auto flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    Respuesta:{' '}
                    <span className="font-mono font-semibold text-foreground">
                      {summary.value}
                    </span>
                  </span>
                  {summary.confidence !== null ? (
                    <span>· confianza {formatPercent(summary.confidence)}</span>
                  ) : null}
                </span>
              </>
            ) : (
              <span className="ms-auto text-xs text-muted-foreground">
                No se preguntó
              </span>
            )}
          </div>

          {summary.asked && summary.score !== null ? (
            <p className="text-xs text-muted-foreground">
              Puntuación esperada:{' '}
              <span className="tabular-nums text-foreground">
                {formatNumber(summary.score)}
              </span>{' '}
              (de 0 a {Math.max(summary.bars.length - 1, 0)})
            </p>
          ) : null}

          {summary.asked && summary.bars.length > 0 ? (
            <ul
              className="space-y-1.5"
              aria-label={`Probabilidades de ${summary.id}`}
            >
              {summary.bars.map(bar => (
                <ProbabilityRow key={bar.label} {...bar} />
              ))}
            </ul>
          ) : null}

          {summary.asked && summary.bars.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              El proveedor no envió probabilidades para esta respuesta.
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

/** Computed signals (usually in [0, 1]); `null` when every input was null. */
export function SignalsList({
  signals
}: {
  signals: Record<string, number | null> | null | undefined
}) {
  const rows = signalRows(signals)

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Esta decisión no define señales.
      </p>
    )
  }

  return (
    <ul className="space-y-2">
      {rows.map(row => {
        const inUnitRange =
          row.value !== null && row.value >= 0 && row.value <= 1
        return (
          <li
            key={row.name}
            className="grid grid-cols-[minmax(0,10rem)_1fr_4rem] items-center gap-2 text-xs"
          >
            <span title={row.name} className="truncate font-mono">
              {row.name}
            </span>
            {inUnitRange ? (
              <MeterBar value={row.value ?? 0} />
            ) : (
              <span aria-hidden="true" />
            )}
            <span className="text-end tabular-nums">
              {row.value === null ? (
                <span className="text-muted-foreground">sin valor</span>
              ) : (
                formatNumber(row.value, 3)
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Flags raised by flag rules. */
export function FlagsList({ flags }: { flags: readonly string[] }) {
  if (flags.length === 0) {
    return <span className="text-sm text-muted-foreground">Ninguno</span>
  }

  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Flags">
      {flags.map(flag => (
        <li key={flag}>
          <Badge variant="secondary" className="font-mono">
            {flag}
          </Badge>
        </li>
      ))}
    </ul>
  )
}
