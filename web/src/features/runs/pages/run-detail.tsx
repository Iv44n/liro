import { Link } from '@tanstack/react-router'
import {
  ActivityIcon,
  AlertOctagonIcon,
  ArrowLeftIcon,
  ExternalLinkIcon,
  InboxIcon
} from 'lucide-react'
import { REVIEW_REASON_LABELS } from '#/features/reviews/utils/labels'
import type { RunDetailView } from '#/sdk/modules/runs/types'
import {
  Alert,
  AlertDescription,
  AlertTitle
} from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { AnswersList, FlagsList, SignalsList } from '../components/answers-list'
import { DecisionBadge } from '../components/decision-badge'
import { DetailList } from '../components/detail-list'
import { InputView } from '../components/input-view'
import { JsonBlock } from '../components/json-block'
import { PageHeader } from '../components/page-header'
import { MeterBar } from '../components/probability-bar'
import {
  ErrorState,
  isNotFoundError,
  NotFoundState
} from '../components/query-states'
import {
  ReviewStatusBadge,
  RunModeBadge,
  RunStatusBadge
} from '../components/run-badges'
import { RunEffects } from '../components/run-effects'
import { SectionCard } from '../components/section-card'
import { useRun } from '../hooks/use-run'
import {
  formatDateTime,
  formatDuration,
  formatNumber,
  formatPercent,
  formatPreciseDateTime
} from '../utils/format'
import { isNeedsReview, RUN_SOURCE_LABELS } from '../utils/labels'

export interface RunDetailPageProps {
  runId: string
}

function BackToRuns() {
  return (
    <Link
      to="/runs"
      className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
      Ejecuciones
    </Link>
  )
}

function RunDetailSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="space-y-2 border-b pb-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-44 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    </div>
  )
}

/** The decision, how confident it was and what decided it. */
function ResultSection({ run }: { run: RunDetailView }) {
  const inReview = isNeedsReview(run.decision)
  const reviewed = inReview && run.finalDecision !== null

  return (
    <SectionCard
      title="Resultado"
      description={
        inReview
          ? reviewed
            ? 'El motor la envió a revisión humana y una persona decidió.'
            : 'El motor la envió a revisión humana: aún no hay decisión final.'
          : undefined
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">
              {reviewed ? 'Decisión final' : 'Decisión'}
            </p>
            <DecisionBadge
              size="lg"
              decision={reviewed ? run.finalDecision : run.decision}
            />
          </div>
          {reviewed ? (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                Decisión del motor
              </p>
              <DecisionBadge decision={run.decision} />
            </div>
          ) : null}
          {inReview && run.suggestion ? (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Sugerencia</p>
              <DecisionBadge decision={run.suggestion} />
            </div>
          ) : null}
          <div className="min-w-40 flex-1 space-y-1.5 sm:max-w-60">
            <p className="flex justify-between text-xs text-muted-foreground">
              Confianza
              <span className="font-medium text-foreground tabular-nums">
                {formatPercent(run.confidence)}
              </span>
            </p>
            {run.confidence !== null ? (
              <MeterBar value={run.confidence} className="h-2" />
            ) : (
              <p className="text-xs text-muted-foreground">
                Sin confianza (decidió una regla sin pregunta asociada).
              </p>
            )}
          </div>
        </div>

        <DetailList
          items={[
            {
              label: 'Regla que decidió',
              value: run.rule ? (
                <code className="font-mono text-xs">{run.rule}</code>
              ) : run.status === 'succeeded' ? (
                'Ninguna (decisión por defecto)'
              ) : null
            },
            {
              label: 'Motivo de revisión',
              value: run.reviewReason
                ? REVIEW_REASON_LABELS[run.reviewReason].label
                : null
            },
            {
              label: 'Flags',
              value:
                run.flags.length > 0 ? (
                  <FlagsList flags={run.flags} />
                ) : (
                  'Ninguno'
                )
            }
          ]}
        />
      </div>
    </SectionCard>
  )
}

function ReviewSection({ run }: { run: RunDetailView }) {
  if (!run.review) {
    if (!isNeedsReview(run.decision)) return null
    return (
      <SectionCard title="Revisión">
        <p className="text-sm text-muted-foreground">
          {run.source === 'playground'
            ? 'Las ejecuciones del playground no crean tareas de revisión.'
            : 'Esta ejecución no tiene tarea de revisión.'}
        </p>
      </SectionCard>
    )
  }

  const { review } = run
  return (
    <SectionCard
      title="Revisión"
      action={
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={
            <Link to="/reviews/$reviewId" params={{ reviewId: review.id }} />
          }
        >
          <InboxIcon aria-hidden="true" />
          {review.status === 'pending' ? 'Revisar' : 'Abrir'}
        </Button>
      }
    >
      <DetailList
        items={[
          {
            label: 'Estado',
            value: <ReviewStatusBadge status={review.status} />
          },
          { label: 'Motivo', value: REVIEW_REASON_LABELS[review.reason].label },
          {
            label: 'Decisión del revisor',
            value: review.resolvedDecision ? (
              <DecisionBadge decision={review.resolvedDecision} />
            ) : null
          },
          {
            label: 'Cerrada',
            value: review.resolvedAt ? formatDateTime(review.resolvedAt) : null
          }
        ]}
      />
    </SectionCard>
  )
}

function InputSection({ run }: { run: RunDetailView }) {
  const hasPolicyInput = Object.keys(run.policyInput).length > 0

  return (
    <SectionCard
      title="Entrada"
      description={
        run.input
          ? 'Tal como se guardó según la política de almacenamiento de la decisión. Los campos marcados como datos personales nunca se guardan.'
          : undefined
      }
    >
      <div className="space-y-5">
        {run.input ? (
          <InputView input={run.input} />
        ) : (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            La entrada completa no se guardó: la decisión está configurada para
            no almacenarla, o ya se eliminó por la retención.
            {hasPolicyInput
              ? ' Abajo están los campos que lee la política, que siempre se guardan.'
              : null}
          </p>
        )}

        {hasPolicyInput ? (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Campos que lee la política
            </h3>
            <JsonBlock
              value={run.policyInput}
              label="Campos de la política en JSON"
            />
          </div>
        ) : null}

        {run.metadata ? (
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-muted-foreground">
              Metadata
            </h3>
            <JsonBlock value={run.metadata} label="Metadata en JSON" />
          </div>
        ) : null}
      </div>
    </SectionCard>
  )
}

function TechnicalSection({ run }: { run: RunDetailView }) {
  const tokens =
    run.inputTokens !== null || run.outputTokens !== null
      ? `${formatNumber(run.inputTokens, 0)} entrada · ${formatNumber(run.outputTokens, 0)} salida`
      : null

  return (
    <SectionCard title="Detalles técnicos">
      <DetailList
        items={[
          { label: 'ID', value: run.id, copy: run.id, mono: true },
          {
            label: 'Creada',
            value: formatPreciseDateTime(run.createdAt)
          },
          {
            label: 'Completada',
            value: run.completedAt
              ? formatPreciseDateTime(run.completedAt)
              : null
          },
          { label: 'Latencia total', value: formatDuration(run.latencyMs) },
          {
            label: 'Latencia del modelo',
            value:
              run.evaluatorLatencyMs !== null
                ? formatDuration(run.evaluatorLatencyMs)
                : null
          },
          { label: 'Modelo solicitado', value: run.modelRequested, mono: true },
          { label: 'Modelo resuelto', value: run.modelResolved, mono: true },
          { label: 'Proveedor', value: run.provider, mono: true },
          {
            label: 'ID de petición',
            value: run.providerRequestId,
            copy: run.providerRequestId,
            mono: true
          },
          { label: 'Tokens', value: tokens },
          {
            label: 'Llamada con',
            value: run.apiKeyId
              ? 'API key'
              : run.userId
                ? 'Sesión del dashboard'
                : null
          },
          {
            label: 'API key',
            value: run.apiKeyId,
            copy: run.apiKeyId,
            mono: true
          },
          {
            label: 'Hash de la definición',
            value: run.definitionHash.slice(0, 12),
            copy: run.definitionHash,
            mono: true
          },
          { label: 'Motor', value: run.engineVersion, mono: true }
        ]}
      />
    </SectionCard>
  )
}

/** `/runs/$runId`: everything about one run. */
export default function RunDetailPage({ runId }: RunDetailPageProps) {
  const {
    data: run,
    isPending,
    isError,
    error,
    refetch,
    isFetching
  } = useRun(runId)

  if (isPending) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <RunDetailSkeleton />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <BackToRuns />
        {isNotFoundError(error) ? (
          <NotFoundState
            title="Ejecución no encontrada"
            description="No existe o pertenece a otra organización."
            action={
              <Button nativeButton={false} render={<Link to="/runs" />}>
                Ver ejecuciones
              </Button>
            }
          />
        ) : (
          <ErrorState
            title="No se pudo cargar la ejecución"
            error={error}
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        )}
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        eyebrow={<BackToRuns />}
        icon={<ActivityIcon />}
        title={
          <span className="inline-flex flex-wrap items-baseline gap-x-2">
            {run.templateName}
            <span className="font-mono text-base font-normal text-muted-foreground">
              {run.version ? `@${run.version}` : 'borrador'}
            </span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <RunStatusBadge status={run.status} />
            <RunModeBadge mode={run.mode} showLive />
            <Badge variant="outline">{RUN_SOURCE_LABELS[run.source]}</Badge>
            <span className="ms-1">
              <time dateTime={run.createdAt}>
                {formatDateTime(run.createdAt)}
              </time>
            </span>
          </span>
        }
        action={
          <Button
            variant="outline"
            nativeButton={false}
            render={
              <Link
                to="/decisions/$templateId"
                params={{ templateId: run.templateId }}
              />
            }
          >
            <ExternalLinkIcon aria-hidden="true" />
            Ver decisión
          </Button>
        }
      />

      {run.error ? (
        <Alert variant="destructive">
          <AlertOctagonIcon aria-hidden="true" />
          <AlertTitle>La ejecución falló</AlertTitle>
          <AlertDescription>
            <p>{run.error.message || 'Sin mensaje de error.'}</p>
            <p>
              Código: <code className="font-mono">{run.error.code}</code>
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <ResultSection run={run} />
          <SectionCard
            title="Respuestas"
            description="Lo que respondió el modelo a cada pregunta, con la probabilidad de cada opción."
          >
            <AnswersList
              answers={run.answers}
              emptyMessage={
                run.status === 'failed'
                  ? 'La ejecución falló antes de obtener respuestas.'
                  : undefined
              }
            />
          </SectionCard>
          {run.signals && Object.keys(run.signals).length > 0 ? (
            <SectionCard title="Señales">
              <SignalsList signals={run.signals} />
            </SectionCard>
          ) : null}
          <InputSection run={run} />
          <RunEffects runId={run.id} />
        </div>
        <div className="min-w-0 space-y-6">
          <ReviewSection run={run} />
          <TechnicalSection run={run} />
        </div>
      </div>
    </div>
  )
}
