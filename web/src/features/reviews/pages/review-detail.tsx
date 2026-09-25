import { Link, useNavigate } from '@tanstack/react-router'
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  Loader2Icon,
  ShieldAlertIcon,
  UserRoundCheckIcon,
  XIcon
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { usePermissions } from '#/features/auth/hooks/use-me'
import {
  AnswersList,
  FlagsList,
  SignalsList
} from '#/features/runs/components/answers-list'
import { DecisionBadge } from '#/features/runs/components/decision-badge'
import { DetailList } from '#/features/runs/components/detail-list'
import { InputView } from '#/features/runs/components/input-view'
import { PageHeader } from '#/features/runs/components/page-header'
import { MeterBar } from '#/features/runs/components/probability-bar'
import {
  ErrorState,
  isNotFoundError,
  NotFoundState
} from '#/features/runs/components/query-states'
import { RunModeBadge } from '#/features/runs/components/run-badges'
import { SectionCard } from '#/features/runs/components/section-card'
import {
  formatDateTime,
  formatPercent,
  formatPreciseDateTime,
  formatRelativeTime
} from '#/features/runs/utils/format'
import type { ReviewView } from '#/sdk/modules/reviews/types'
import { REVIEW_COMMENT_MAX_LENGTH } from '#/sdk/modules/reviews/types'
import { Alert, AlertDescription } from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '#/shared/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldLabel
} from '#/shared/components/ui/field'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { Textarea } from '#/shared/components/ui/textarea'
import { ReviewReasonBadge } from '../components/review-reason-badge'
import { useDismissReview, useResolveReview } from '../hooks/use-review-actions'
import { findNextPendingReview, useReview } from '../hooks/use-reviews'
import {
  type DecisionOption,
  decisionForKey,
  decisionOptions,
  isShortcutEvent,
  REVIEW_REASON_LABELS
} from '../utils/labels'

export interface ReviewDetailPageProps {
  reviewId: string
}

function BackToReviews() {
  return (
    <Link
      to="/reviews"
      className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
      Revisión
    </Link>
  )
}

function ReviewDetailSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="space-y-2 border-b pb-5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    </div>
  )
}

/** The engine's suggestion, why it asked for review, its rule and flags. */
function SuggestionSection({ review }: { review: ReviewView }) {
  const { run } = review
  const reasonMeta = REVIEW_REASON_LABELS[review.reason]

  return (
    <SectionCard
      title="Sugerencia del motor"
      description={reasonMeta.description}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">Sugerencia</p>
            {review.suggestedDecision ? (
              <DecisionBadge size="lg" decision={review.suggestedDecision} />
            ) : (
              <p className="text-sm text-muted-foreground italic">
                Sin candidato: ninguna decisión superó el umbral.
              </p>
            )}
          </div>
          {run.confidence !== null ? (
            <div className="min-w-40 flex-1 space-y-1.5 sm:max-w-60">
              <p className="flex justify-between text-xs text-muted-foreground">
                Confianza
                <span className="font-medium text-foreground tabular-nums">
                  {formatPercent(run.confidence)}
                </span>
              </p>
              <MeterBar value={run.confidence} className="h-2" />
            </div>
          ) : null}
        </div>

        <DetailList
          items={[
            {
              label: 'Regla que decidió',
              value: run.rule ? (
                <code className="font-mono text-xs">{run.rule}</code>
              ) : null
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

function InputSection({ review }: { review: ReviewView }) {
  const { run } = review

  return (
    <SectionCard
      title="Entrada"
      description={
        run.input
          ? 'Tal como se guardó según la política de almacenamiento de la decisión.'
          : undefined
      }
    >
      {run.input ? (
        <InputView input={run.input} />
      ) : (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          La entrada no se guardó: la decisión está configurada para no
          almacenarla, o ya se eliminó por la retención.
        </p>
      )}
    </SectionCard>
  )
}

/** What already happened: who closed it, with what decision and comment. */
function ResolutionSummary({ review }: { review: ReviewView }) {
  return (
    <SectionCard title="Resolución">
      <DetailList
        items={[
          {
            label: 'Estado',
            value:
              review.status === 'resolved'
                ? 'Resuelta'
                : review.status === 'dismissed'
                  ? 'Descartada'
                  : 'Expirada'
          },
          {
            label: 'Decisión',
            value: review.resolvedDecision ? (
              <DecisionBadge decision={review.resolvedDecision} />
            ) : null
          },
          {
            label: 'Resuelta por',
            value: review.resolvedBy?.name ?? null
          },
          {
            label: 'Fecha',
            value: review.resolvedAt ? formatDateTime(review.resolvedAt) : null
          },
          { label: 'Comentario', value: review.comment }
        ]}
      />
    </SectionCard>
  )
}

/** One decision button: the label, its description and its number shortcut. */
function DecisionButton({
  option,
  disabled,
  onSelect
}: {
  option: DecisionOption
  disabled: boolean
  onSelect: (label: string) => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(option.label)}
      className="flex w-full items-start gap-3 rounded-xl border border-input bg-input/30 p-3 text-start transition-colors outline-none hover:bg-input/50 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-suggested:border-primary/40 data-suggested:bg-primary/5"
      data-suggested={option.suggested || undefined}
    >
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <DecisionBadge decision={option.label} />
          {option.suggested ? (
            <Badge className="bg-primary/15 text-primary">
              <UserRoundCheckIcon aria-hidden="true" />
              Sugerida
            </Badge>
          ) : null}
        </span>
        {option.description ? (
          <span className="block text-xs text-muted-foreground">
            {option.description}
          </span>
        ) : null}
      </span>
      {option.shortcut ? (
        <kbd className="shrink-0 rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
          {option.shortcut}
        </kbd>
      ) : null}
    </button>
  )
}

/** A loading placeholder for the decision panel while permissions load. */
function DecisionPanelSkeleton() {
  return (
    <SectionCard title="Decisión">
      <div className="space-y-2" aria-hidden="true">
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <Skeleton className="h-14 w-full rounded-xl" />
      </div>
    </SectionCard>
  )
}

/** The decision buttons, comment field and "Descartar", or a summary when closed. */
function DecisionPanel({
  review,
  canResolve
}: {
  review: ReviewView
  /** `undefined` while `/api/me` is still loading — don't assert either way yet. */
  canResolve: boolean | undefined
}) {
  const [comment, setComment] = useState('')
  const [confirmDismiss, setConfirmDismiss] = useState(false)
  const resolveReview = useResolveReview()
  const dismissReview = useDismissReview()
  const navigate = useNavigate()

  const pending = review.status === 'pending'
  const options = decisionOptions(review)
  const busy = resolveReview.isPending || dismissReview.isPending

  async function goToNext() {
    const nextId = await findNextPendingReview(review.id)
    if (nextId) {
      navigate({
        to: '/reviews/$reviewId',
        params: { reviewId: nextId },
        replace: true
      })
    } else {
      navigate({ to: '/reviews', replace: true })
    }
  }

  function submitResolve(decision: string) {
    if (busy) return
    resolveReview.mutate(
      { reviewId: review.id, decision, comment },
      { onSuccess: () => void goToNext() }
    )
  }

  function submitDismiss() {
    dismissReview.mutate(
      { reviewId: review.id, comment },
      {
        onSuccess: () => {
          setConfirmDismiss(false)
          void goToNext()
        }
      }
    )
  }

  // The listener is attached once per review and reads state through this
  // ref (refreshed every render) so it always sees the latest options and
  // comment, without needing to be re-attached on every keystroke.
  const latest = useRef({ options, submitResolve })
  latest.current = { options, submitResolve }

  useEffect(() => {
    if (!pending || !canResolve) return

    function onKeyDown(event: KeyboardEvent) {
      if (!isShortcutEvent(event)) return
      const option = decisionForKey(latest.current.options, event.key)
      if (!option) return
      event.preventDefault()
      latest.current.submitResolve(option.label)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [pending, canResolve])

  if (!pending) {
    return <ResolutionSummary review={review} />
  }

  if (canResolve === undefined) {
    return <DecisionPanelSkeleton />
  }

  if (!canResolve) {
    return (
      <SectionCard title="Decisión">
        <Alert>
          <ShieldAlertIcon aria-hidden="true" />
          <AlertDescription>
            Tu rol puede ver esta revisión, pero no resolverla.
          </AlertDescription>
        </Alert>
      </SectionCard>
    )
  }

  return (
    <SectionCard
      title="Tu decisión"
      description="Queda como la decisión final de la ejecución. Puedes usar las teclas 1-9."
    >
      <div className="space-y-4">
        <ul className="space-y-2">
          {options.map(option => (
            <li key={option.label}>
              <DecisionButton
                option={option}
                disabled={busy}
                onSelect={submitResolve}
              />
            </li>
          ))}
        </ul>

        <Field className="gap-1.5">
          <FieldLabel htmlFor="review-comment">
            Comentario (opcional)
          </FieldLabel>
          <Textarea
            id="review-comment"
            value={comment}
            onChange={event =>
              setComment(event.target.value.slice(0, REVIEW_COMMENT_MAX_LENGTH))
            }
            rows={2}
            disabled={busy}
            placeholder="Por qué decidiste esto (opcional)…"
          />
          <FieldDescription className="text-end text-xs">
            {comment.length}/{REVIEW_COMMENT_MAX_LENGTH}
          </FieldDescription>
        </Field>

        {resolveReview.isPending ? (
          <p
            aria-live="polite"
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            <Loader2Icon aria-hidden="true" className="size-3.5 animate-spin" />
            Guardando la decisión…
          </p>
        ) : null}

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => setConfirmDismiss(true)}
        >
          <XIcon aria-hidden="true" />
          Descartar
        </Button>
      </div>

      <Dialog open={confirmDismiss} onOpenChange={setConfirmDismiss}>
        <DialogContent className="sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Descartar revisión</DialogTitle>
            <DialogDescription>
              La ejecución queda sin decisión final. No es lo mismo que elegir
              una de las decisiones de arriba.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              className="rounded-md"
              disabled={dismissReview.isPending}
              onClick={() => setConfirmDismiss(false)}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="rounded-md"
              disabled={dismissReview.isPending}
              onClick={submitDismiss}
            >
              {dismissReview.isPending ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <XIcon />
              )}
              Descartar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SectionCard>
  )
}

/** `/reviews/$reviewId`: everything about one review, and how to close it. */
export default function ReviewDetailPage({ reviewId }: ReviewDetailPageProps) {
  const {
    data: review,
    isPending,
    isError,
    error,
    refetch,
    isFetching
  } = useReview(reviewId)
  const permissions = usePermissions()
  const canResolve = permissions?.review.resolve

  if (isPending) {
    return (
      <div className="mx-auto w-full max-w-6xl">
        <ReviewDetailSkeleton />
      </div>
    )
  }

  if (isError || !review) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <BackToReviews />
        {isNotFoundError(error) ? (
          <NotFoundState
            title="Revisión no encontrada"
            description="No existe o pertenece a otra organización."
            action={
              <Button nativeButton={false} render={<Link to="/reviews" />}>
                Ver revisiones
              </Button>
            }
          />
        ) : (
          <ErrorState
            title="No se pudo cargar la revisión"
            error={error}
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        )}
      </div>
    )
  }

  const { run } = review

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        eyebrow={<BackToReviews />}
        title={
          <span className="inline-flex flex-wrap items-baseline gap-x-2">
            {review.template.name}
            {run.version ? (
              <span className="font-mono text-base font-normal text-muted-foreground">
                @{run.version}
              </span>
            ) : null}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <ReviewReasonBadge reason={review.reason} />
            <RunModeBadge mode={run.mode} />
            <span className="ms-1">
              <time
                dateTime={review.createdAt}
                title={formatPreciseDateTime(review.createdAt)}
              >
                {formatRelativeTime(review.createdAt)}
              </time>
            </span>
          </span>
        }
        action={
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link to="/runs/$runId" params={{ runId: run.id }} />}
          >
            <ExternalLinkIcon aria-hidden="true" />
            Ver ejecución
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <SuggestionSection review={review} />
          <SectionCard
            title="Respuestas"
            description="Lo que respondió el modelo a cada pregunta, con la probabilidad de cada opción."
          >
            <AnswersList answers={run.answers} />
          </SectionCard>
          {run.signals && Object.keys(run.signals).length > 0 ? (
            <SectionCard title="Señales">
              <SignalsList signals={run.signals} />
            </SectionCard>
          ) : null}
          <InputSection review={review} />
        </div>
        <div className="min-w-0 space-y-6">
          <DecisionPanel review={review} canResolve={canResolve} />
        </div>
      </div>
    </div>
  )
}
