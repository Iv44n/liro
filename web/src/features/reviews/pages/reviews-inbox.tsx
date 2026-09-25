import { Link } from '@tanstack/react-router'
import {
  ArchiveXIcon,
  CheckCheckIcon,
  InboxIcon,
  Loader2Icon,
  PlayIcon,
  ShieldAlertIcon
} from 'lucide-react'
import { usePermissions } from '#/features/auth/hooks/use-me'
import { PageHeader } from '#/features/runs/components/page-header'
import { ErrorState } from '#/features/runs/components/query-states'
import { pluralize } from '#/features/runs/utils/format'
import { Alert, AlertDescription } from '#/shared/components/ui/alert'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { Card } from '#/shared/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '#/shared/components/ui/empty'
import { Skeleton } from '#/shared/components/ui/skeleton'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '#/shared/components/ui/tabs'
import { ReviewListItem } from '../components/review-list-item'
import { useReviewStats } from '../hooks/use-review-stats'
import { useReviews } from '../hooks/use-reviews'
import { useReviewsTab } from '../store/reviews-tab'
import {
  isReviewTab,
  REVIEW_TAB_LABELS,
  REVIEW_TABS,
  type ReviewTab
} from '../utils/labels'

const emptyStates: Record<
  ReviewTab,
  { icon: typeof InboxIcon; title: string; description: string }
> = {
  pending: {
    icon: CheckCheckIcon,
    title: 'Todo al día',
    description:
      'No hay revisiones pendientes. Cuando una ejecución necesite a una persona, aparecerá aquí.'
  },
  resolved: {
    icon: InboxIcon,
    title: 'Aún no hay revisiones resueltas',
    description: 'Las revisiones que resuelvas quedarán en este historial.'
  },
  dismissed: {
    icon: ArchiveXIcon,
    title: 'No hay revisiones descartadas',
    description:
      'Descartar cierra una revisión sin decisión: la ejecución queda sin decisión final.'
  }
}

function ReviewsSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
        <Skeleton key={index} className="h-16 w-full rounded-lg" />
      ))}
    </div>
  )
}

/** One tab's list, with cursor pagination ("Cargar más"). */
function ReviewsList({ status }: { status: ReviewTab }) {
  const reviews = useReviews(status)
  const rows = reviews.data?.pages.flatMap(page => page.data) ?? []
  const now = reviews.dataUpdatedAt || Date.now()

  if (reviews.isError && !reviews.data) {
    return (
      <ErrorState
        title="No se pudieron cargar las revisiones"
        error={reviews.error}
        onRetry={() => reviews.refetch()}
        isRetrying={reviews.isFetching}
      />
    )
  }

  const empty = emptyStates[status]
  const EmptyIcon = empty.icon

  return (
    <div className="space-y-4">
      <Card className="gap-0 py-0">
        {reviews.isPending ? (
          <ReviewsSkeleton />
        ) : rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <EmptyIcon />
              </EmptyMedia>
              <EmptyTitle>{empty.title}</EmptyTitle>
              <EmptyDescription>{empty.description}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y">
            {rows.map(review => (
              <ReviewListItem key={review.id} review={review} now={now} />
            ))}
          </ul>
        )}
      </Card>

      {rows.length > 0 ? (
        <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
          <p aria-live="polite">
            {status === 'pending'
              ? 'Las más antiguas primero.'
              : 'Las más recientes primero.'}{' '}
            {reviews.hasNextPage
              ? `Mostrando ${pluralize(rows.length, 'revisión', 'revisiones')}.`
              : `${pluralize(rows.length, 'revisión', 'revisiones')} en total.`}
          </p>
          {reviews.hasNextPage ? (
            <Button
              variant="outline"
              onClick={() => reviews.fetchNextPage()}
              disabled={reviews.isFetchingNextPage}
            >
              {reviews.isFetchingNextPage ? (
                <Loader2Icon aria-hidden="true" className="animate-spin" />
              ) : null}
              {reviews.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
            </Button>
          ) : null}
          {reviews.isFetchNextPageError ? (
            <p role="alert" className="text-destructive">
              No se pudo cargar la siguiente página. Inténtalo de nuevo.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** "Empezar a revisar": opens the review that has waited longest. */
function StartReviewingButton() {
  const pending = useReviews('pending')
  const first = pending.data?.pages[0]?.data[0]
  if (!first) return null

  return (
    <Button
      nativeButton={false}
      render={<Link to="/reviews/$reviewId" params={{ reviewId: first.id }} />}
    >
      <PlayIcon aria-hidden="true" />
      Empezar a revisar
    </Button>
  )
}

/** `/reviews`: the human review inbox. */
export default function ReviewsInboxPage() {
  const { tab, setTab } = useReviewsTab()
  const { data: stats } = useReviewStats()
  const permissions = usePermissions()
  const canResolve = permissions?.review.resolve ?? false

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <PageHeader
        icon={<InboxIcon />}
        title="Revisión"
        description="Ejecuciones que el motor no pudo decidir solo. Tu decisión queda como la decisión final de la ejecución."
        action={canResolve ? <StartReviewingButton /> : undefined}
      />

      {permissions && !canResolve ? (
        <Alert>
          <ShieldAlertIcon aria-hidden="true" />
          <AlertDescription>
            Tu rol puede ver las revisiones, pero no resolverlas. Pide a un
            administrador que te dé acceso si necesitas decidir.
          </AlertDescription>
        </Alert>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={value => {
          if (isReviewTab(value)) setTab(value)
        }}
        className="gap-4"
      >
        <TabsList className="w-full sm:w-fit">
          {REVIEW_TABS.map(value => (
            <TabsTrigger key={value} value={value} className="px-3">
              {REVIEW_TAB_LABELS[value]}
              {value === 'pending' && stats && stats.pending > 0 ? (
                <Badge className="h-4 min-w-4 px-1 tabular-nums">
                  <span className="sr-only">: </span>
                  {stats.pending > 99 ? '99+' : stats.pending}
                </Badge>
              ) : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {REVIEW_TABS.map(value => (
          <TabsContent key={value} value={value}>
            <ReviewsList status={value} />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
