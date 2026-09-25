import { Link } from '@tanstack/react-router'
import {
  ArrowUpRightIcon,
  CircleAlertIcon,
  FlagIcon,
  GaugeIcon,
  TriangleAlertIcon
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { LintIssue } from '#/features/templates/types/definition'
import type { RunDetailView } from '#/sdk/modules/runs/types'
import type { RunTrace } from '#/sdk/modules/templates/types'
import { Badge } from '#/shared/components/ui/badge'
import { cn } from '#/shared/utils/shadcn.utils'
import {
  type AnswerView,
  clamp01,
  formatDecimal,
  formatInteger,
  formatLatency,
  formatPercent,
  isNeedsReview,
  REVIEW_REASON_DESCRIPTIONS,
  REVIEW_REASON_LABELS,
  RUN_MODE_LABELS,
  type StageView,
  TOKEN_STATUS_LABELS
} from '../utils/format'
import { DecisionBadge } from './decision-badge'
import { Disclosure, JsonView } from './json-view'
import { ProbabilityBar } from './probability-bar'

function Section({
  title,
  icon,
  children,
  aside
}: {
  title: string
  icon?: ReactNode
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5">
        {icon ? (
          <span aria-hidden className="text-muted-foreground [&_svg]:size-3.5">
            {icon}
          </span>
        ) : null}
        <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h4>
        {aside ? <div className="ms-auto">{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border bg-background/60 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium tabular-nums">{value}</dd>
    </div>
  )
}

/** The decision headline: badge, suggestion and reason for a review, confidence. */
function DecisionSummary({
  run,
  stage
}: {
  run: RunDetailView
  stage: StageView
}) {
  const review = isNeedsReview(run.decision)

  return (
    <div
      className={cn(
        'space-y-3 rounded-xl border p-4',
        review ? 'border-amber-500/40 bg-amber-500/5' : 'bg-card'
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <DecisionBadge decision={run.decision} size="lg" />
        <Badge variant="outline" className="ms-auto">
          {RUN_MODE_LABELS[run.mode]}
        </Badge>
      </div>

      {review ? (
        <div className="space-y-1 text-sm">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className="text-muted-foreground">Sugerencia:</span>
            {run.suggestion ? (
              <DecisionBadge decision={run.suggestion} />
            ) : (
              <span className="text-muted-foreground">ninguna</span>
            )}
          </p>
          {run.reviewReason ? (
            <p>
              <span className="font-medium">
                {REVIEW_REASON_LABELS[run.reviewReason]}:
              </span>{' '}
              <span className="text-muted-foreground">
                {REVIEW_REASON_DESCRIPTIONS[run.reviewReason]}
              </span>
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            En el playground no se crean tareas de revisión.
          </p>
        </div>
      ) : null}

      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">Confianza</p>
        {run.confidence === null ? (
          <p className="text-sm text-muted-foreground">
            Sin confianza (la decisión no depende de una respuesta de Jev).
          </p>
        ) : (
          <ProbabilityBar
            label="confianza"
            mono={false}
            value={run.confidence}
            selected
            tone={
              review && run.reviewReason === 'low_confidence'
                ? 'warning'
                : 'primary'
            }
          />
        )}
      </div>

      <p className="text-sm">
        <span className="text-muted-foreground">Decidió: </span>
        <span className="font-medium">{stage.label}</span>
        {stage.ruleId ? (
          <>
            {' '}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
              {stage.ruleId}
            </code>
          </>
        ) : null}
        {stage.ruleName ? (
          <span className="text-muted-foreground"> · {stage.ruleName}</span>
        ) : null}
      </p>
    </div>
  )
}

function AnswersSection({ answers }: { answers: AnswerView[] }) {
  if (answers.length === 0) return null

  return (
    <Section title="Respuestas">
      <ul className="space-y-3">
        {answers.map(view => (
          <li key={view.id} className="space-y-1.5 rounded-lg border p-3">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <code className="font-mono text-sm font-medium">{view.id}</code>
              {view.type ? (
                <span className="text-xs text-muted-foreground">
                  {view.type === 'choice'
                    ? 'opción'
                    : view.type === 'score'
                      ? 'puntuación'
                      : 'sí/no'}
                </span>
              ) : null}
              <span className="ms-auto text-xs text-muted-foreground">
                {view.answer
                  ? `confianza ${formatPercent(view.confidence)}`
                  : null}
              </span>
            </div>
            {view.answer ? (
              <>
                <p className="text-sm">
                  <span className="text-muted-foreground">Respuesta: </span>
                  <span className="font-medium">{view.summary}</span>
                </p>
                <div className="space-y-1">
                  {view.rows.map(row => (
                    <ProbabilityBar
                      key={row.label}
                      label={row.label}
                      value={row.probability}
                      selected={row.selected}
                      mono={view.type !== 'boolean'}
                    />
                  ))}
                </div>
                {view.answer.type !== 'boolean' &&
                view.answer.probabilities === null ? (
                  <p className="text-xs text-muted-foreground">
                    El proveedor no devolvió probabilidades.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No se preguntó: su condición no se cumplió o decidió una
                precondición.
              </p>
            )}
          </li>
        ))}
      </ul>
    </Section>
  )
}

function SignalsSection({
  signals
}: {
  signals: Record<string, number | null> | null
}) {
  const entries = Object.entries(signals ?? {})
  if (entries.length === 0) return null

  return (
    <Section title="Señales" icon={<GaugeIcon />}>
      <div className="space-y-1">
        {entries.map(([name, value]) =>
          value === null ? (
            <div
              key={name}
              className="flex items-center justify-between gap-2 text-xs"
            >
              <code className="truncate font-mono text-muted-foreground">
                {name}
              </code>
              <span className="text-muted-foreground">sin valor</span>
            </div>
          ) : (
            <ProbabilityBar
              key={name}
              label={name}
              value={clamp01(value)}
              valueLabel={formatDecimal(value)}
              tone={value >= 0 && value <= 1 ? 'primary' : 'muted'}
            />
          )
        )}
      </div>
    </Section>
  )
}

function TokensBudget({ tokens }: { tokens: NonNullable<RunTrace['tokens']> }) {
  const ratio = tokens.limit > 0 ? tokens.estimate / tokens.limit : 0

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="text-muted-foreground">
          Estimación de tokens vs. límite del modelo
        </span>
        <span
          className={cn(
            'font-medium',
            tokens.status === 'warn' && 'text-amber-700 dark:text-amber-300',
            tokens.status === 'reject' && 'text-destructive'
          )}
        >
          {TOKEN_STATUS_LABELS[tokens.status]}
        </span>
      </div>
      <ProbabilityBar
        label={`~${formatInteger(tokens.estimate)} / ${formatInteger(tokens.limit)}`}
        mono={false}
        value={ratio}
        selected
        tone={
          tokens.status === 'ok'
            ? 'primary'
            : tokens.status === 'warn'
              ? 'warning'
              : 'destructive'
        }
      />
    </div>
  )
}

function LintWarnings({ lint }: { lint: LintIssue[] }) {
  const warnings = lint.filter(issue => issue.severity === 'warning')
  if (warnings.length === 0) return null

  return (
    <Disclosure
      title={
        <span className="inline-flex items-center gap-1.5">
          <TriangleAlertIcon
            aria-hidden
            className="size-4 text-amber-600 dark:text-amber-400"
          />
          Avisos de lint
        </span>
      }
      hint={warnings.length}
    >
      <ul className="space-y-1.5 text-xs">
        {warnings.map(issue => (
          <li
            key={`${issue.code}:${issue.path}:${issue.message}`}
            className="rounded-md bg-muted/50 px-2 py-1.5"
          >
            <code className="font-mono font-medium">{issue.code}</code>
            {issue.path ? (
              <code className="ms-1 font-mono text-muted-foreground">
                {issue.path}
              </code>
            ) : null}
            <p className="text-muted-foreground">{issue.message}</p>
          </li>
        ))}
      </ul>
    </Disclosure>
  )
}

/** Everything a test run returned: decision, answers, signals, metrics and the state sent to Jev. */
export function RunResult({
  run,
  trace,
  lint,
  stage,
  answers
}: {
  run: RunDetailView
  trace: RunTrace
  lint: LintIssue[]
  stage: StageView
  answers: AnswerView[]
}) {
  const modelLabel =
    run.modelRequested &&
    run.modelResolved &&
    run.modelRequested !== run.modelResolved
      ? `${run.modelRequested} → ${run.modelResolved}`
      : (run.model ?? '—')

  return (
    <div className="space-y-5">
      {run.error ? (
        <div className="flex gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">La ejecución falló</p>
            <p className="text-destructive/90">
              <code className="font-mono">{run.error.code}</code>{' '}
              {run.error.message}
            </p>
          </div>
        </div>
      ) : null}

      <DecisionSummary run={run} stage={stage} />

      <Section title="Flags" icon={<FlagIcon />}>
        {run.flags.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {run.flags.map(flag => (
              <li key={flag}>
                <Badge variant="secondary" className="font-mono">
                  {flag}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Ningún flag activado.</p>
        )}
      </Section>

      <AnswersSection answers={answers} />
      <SignalsSection signals={run.signals} />

      <Section title="Ejecución">
        <dl className="grid grid-cols-2 gap-2 @md:grid-cols-3">
          <Metric label="Latencia total" value={formatLatency(run.latencyMs)} />
          <Metric
            label="Latencia de Jev"
            value={formatLatency(run.evaluatorLatencyMs)}
          />
          <Metric
            label="Tokens (entrada / salida)"
            value={
              run.inputTokens === null && run.outputTokens === null
                ? '—'
                : `${formatInteger(run.inputTokens ?? 0)} / ${formatInteger(run.outputTokens ?? 0)}`
            }
          />
          <Metric
            label="Modelo"
            value={<span title={modelLabel}>{modelLabel}</span>}
          />
          <Metric label="Proveedor" value={run.provider ?? '—'} />
          <Metric
            label="Preguntas enviadas"
            value={
              trace.questions.length > 0 ? trace.questions.length : 'Ninguna'
            }
          />
        </dl>
        {trace.tokens ? <TokensBudget tokens={trace.tokens} /> : null}
      </Section>

      <LintWarnings lint={lint} />

      <Disclosure
        title="Estado enviado a Jev"
        hint={trace.state ? 'JSON exacto' : 'no se llamó'}
      >
        {trace.state ? (
          <JsonView value={trace.state} label="Estado enviado a Jev" />
        ) : (
          <p className="text-sm text-muted-foreground">
            No se llamó a Jev: decidió una precondición o ninguna pregunta
            aplicaba.
          </p>
        )}
      </Disclosure>

      <Link
        to="/runs/$runId"
        params={{ runId: run.id }}
        className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Ver la ejecución completa
        <ArrowUpRightIcon aria-hidden className="size-4" />
      </Link>
    </div>
  )
}
