import { Link } from '@tanstack/react-router'
import {
  ActivityIcon,
  FilterXIcon,
  Loader2Icon,
  RefreshCwIcon
} from 'lucide-react'
import { useMemo } from 'react'
import { useAuth } from '#/features/auth/store/auth'
import { NEEDS_REVIEW } from '#/features/templates/types/definition'
import { Button } from '#/shared/components/ui/button'
import { Card } from '#/shared/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '#/shared/components/ui/empty'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { cn } from '#/shared/utils/shadcn.utils'
import { PageHeader } from '../components/page-header'
import { ErrorState } from '../components/query-states'
import { RunsFilters } from '../components/runs-filters'
import { RunsTable } from '../components/runs-table'
import { useRuns } from '../hooks/use-runs'
import {
  useTemplateLabels,
  useTemplateOptions
} from '../hooks/use-template-options'
import { useRunsFilters } from '../store/runs-filters'
import { countActiveFilters, decisionFilterOptions } from '../utils/filters'
import { pluralize } from '../utils/format'

function RunsSkeleton() {
  return (
    <div className="space-y-3 p-4" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders.
        <Skeleton key={index} className="h-11 w-full rounded-lg" />
      ))}
    </div>
  )
}

/** `/runs`: every decision run of the organization, newest first. */
export default function RunsListPage() {
  const organizationId =
    useAuth(state => state.auth?.session.activeOrganizationId) ?? null
  const { filters, setFilters, reset } = useRunsFilters(organizationId)
  const runs = useRuns(filters)
  const templates = useTemplateOptions()
  // Relative times are computed against the last fetch, not every render.
  const now = runs.dataUpdatedAt || Date.now()

  const selectedTemplate = templates.data?.find(
    template => template.id === filters.templateId
  )
  const labels = useTemplateLabels(
    filters.templateId,
    selectedTemplate?.latestVersion?.id
  )

  const rows = useMemo(
    () => runs.data?.pages.flatMap(page => page.data) ?? [],
    [runs.data]
  )
  const decisionOptions = decisionFilterOptions({
    needsReview: NEEDS_REVIEW,
    labels: labels.data,
    seen: rows.map(run => run.decision),
    current: filters.decision
  })
  const activeFilters = countActiveFilters(filters)

  const refresh = () => {
    void runs.refetch()
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6">
      <PageHeader
        icon={<ActivityIcon />}
        title="Ejecuciones"
        description="Cada vez que una decisión se ejecuta —desde la API, el playground o una revisión— queda registrada aquí con su resultado."
        action={
          <Button
            variant="outline"
            onClick={refresh}
            disabled={runs.isFetching}
          >
            <RefreshCwIcon
              aria-hidden="true"
              className={cn(runs.isRefetching && 'animate-spin')}
            />
            Actualizar
          </Button>
        }
      />

      <RunsFilters
        filters={filters}
        onChange={setFilters}
        onReset={reset}
        templates={templates.data}
        decisionOptions={decisionOptions}
      />

      {runs.isError && !runs.data ? (
        <ErrorState
          title="No se pudieron cargar las ejecuciones"
          error={runs.error}
          onRetry={refresh}
          isRetrying={runs.isFetching}
        />
      ) : (
        <Card className="gap-0 py-0">
          {runs.isPending ? (
            <RunsSkeleton />
          ) : rows.length === 0 ? (
            activeFilters > 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <FilterXIcon />
                  </EmptyMedia>
                  <EmptyTitle>Ninguna ejecución coincide</EmptyTitle>
                  <EmptyDescription>
                    Prueba con otros filtros o amplía el periodo.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" onClick={reset}>
                    Limpiar filtros
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ActivityIcon />
                  </EmptyMedia>
                  <EmptyTitle>Aún no hay ejecuciones</EmptyTitle>
                  <EmptyDescription>
                    Prueba una decisión en su playground o llámala desde tu
                    sistema con una API key: cada ejecución aparecerá aquí.
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button
                    nativeButton={false}
                    render={<Link to="/decisions" />}
                  >
                    Ir a Decisiones
                  </Button>
                </EmptyContent>
              </Empty>
            )
          ) : (
            <RunsTable
              runs={rows}
              now={now}
              className={cn(
                'transition-opacity',
                runs.isPlaceholderData && 'opacity-60'
              )}
            />
          )}
        </Card>
      )}

      {rows.length > 0 ? (
        <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
          <p aria-live="polite">
            {runs.hasNextPage
              ? `Mostrando las ${pluralize(rows.length, 'ejecución más reciente', 'ejecuciones más recientes')}`
              : `${pluralize(rows.length, 'ejecución', 'ejecuciones')} en total`}
          </p>
          {runs.hasNextPage ? (
            <Button
              variant="outline"
              onClick={() => runs.fetchNextPage()}
              disabled={runs.isFetchingNextPage}
            >
              {runs.isFetchingNextPage ? (
                <Loader2Icon aria-hidden="true" className="animate-spin" />
              ) : null}
              {runs.isFetchingNextPage ? 'Cargando…' : 'Cargar más'}
            </Button>
          ) : null}
          {runs.isFetchNextPageError ? (
            <p role="alert" className="text-destructive">
              No se pudo cargar la siguiente página. Inténtalo de nuevo.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
