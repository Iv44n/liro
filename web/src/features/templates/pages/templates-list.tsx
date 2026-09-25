import { Link } from '@tanstack/react-router'
import {
  ArchiveIcon,
  LayoutTemplateIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SearchXIcon,
  WorkflowIcon,
  XIcon
} from 'lucide-react'
import { useDeferredValue, useMemo, useState } from 'react'
import { usePermissions } from '#/features/auth/hooks/use-me'
import type { TemplateView } from '#/sdk/modules/templates/types'
import {
  Alert,
  AlertDescription,
  AlertTitle
} from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '#/shared/components/ui/empty'
import { Input } from '#/shared/components/ui/input'
import { Skeleton } from '#/shared/components/ui/skeleton'
import {
  ToggleGroup,
  ToggleGroupItem
} from '#/shared/components/ui/toggle-group'
import { PageHeader } from '../components/page-header'
import { TemplatesListView } from '../components/templates-list-view'
import { useTemplates } from '../hooks/use-templates'
import { countLabel, matchesTemplateQuery } from '../utils/format'
import { describeError } from '../utils/server-errors'

const FILTERS = [
  { value: 'active', label: 'Activas' },
  { value: 'archived', label: 'Archivadas' },
  { value: 'all', label: 'Todas' }
] as const

type Filter = (typeof FILTERS)[number]['value']

const isFilter = (value: unknown): value is Filter =>
  FILTERS.some(filter => filter.value === value)

const byFilter = (templates: TemplateView[], filter: Filter) =>
  filter === 'all'
    ? templates
    : templates.filter(template => template.status === filter)

function NewTemplateButton() {
  return (
    <Button nativeButton={false} render={<Link to="/decisions/new" />}>
      <PlusIcon aria-hidden="true" />
      Nueva decisión
    </Button>
  )
}

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true">
      <span className="sr-only">Cargando decisiones…</span>
      {['a', 'b', 'c', 'd'].map(key => (
        <div
          key={key}
          className="flex items-center gap-4 rounded-2xl p-4 ring-1 ring-foreground/10"
        >
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-32 max-w-full" />
          </div>
          <Skeleton className="hidden h-5 w-20 md:block" />
          <Skeleton className="hidden h-5 w-24 md:block" />
          <Skeleton className="size-8 rounded-full" />
        </div>
      ))}
    </div>
  )
}

function NoTemplates({ canCreate }: { canCreate: boolean }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <WorkflowIcon />
        </EmptyMedia>
        <EmptyTitle>Aún no hay decisiones</EmptyTitle>
        <EmptyDescription>
          Una decisión define qué evalúa el modelo y cómo se decide con su
          respuesta. Crea la primera con un asistente o parte de una plantilla
          de la galería.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {canCreate ? (
          <div className="flex flex-wrap justify-center gap-2">
            <NewTemplateButton />
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link to="/decisions/new" />}
            >
              <LayoutTemplateIcon aria-hidden="true" />
              Ver la galería
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Pide a un administrador de tu organización que cree la primera.
          </p>
        )}
      </EmptyContent>
    </Empty>
  )
}

/** `/decisions`: the organization's decision templates. */
export default function TemplatesListPage() {
  const permissions = usePermissions()
  const canCreate = permissions?.template.create ?? false
  const canArchive = permissions?.template.archive ?? false

  const {
    data: templates,
    error,
    isPending,
    isFetching,
    refetch
  } = useTemplates('all')
  const [filter, setFilter] = useState<Filter>('active')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)

  const counts = useMemo(
    () =>
      Object.fromEntries(
        FILTERS.map(({ value }) => [
          value,
          byFilter(templates ?? [], value).length
        ])
      ) as Record<Filter, number>,
    [templates]
  )

  const visible = useMemo(
    () =>
      byFilter(templates ?? [], filter).filter(template =>
        matchesTemplateQuery(template, deferredQuery)
      ),
    [templates, filter, deferredQuery]
  )

  const hasAny = (templates?.length ?? 0) > 0

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <PageHeader
        icon={<WorkflowIcon />}
        title="Decisiones"
        description="Cada decisión define la entrada que recibe, qué pregunta al modelo y cómo decide con sus respuestas."
        action={canCreate && hasAny ? <NewTemplateButton /> : null}
      />

      {isPending ? (
        <ListSkeleton />
      ) : error ? (
        <Alert variant="destructive">
          <AlertTitle>No se pudieron cargar las decisiones</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>{describeError(error)}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCwIcon
                className={isFetching ? 'animate-spin' : undefined}
                aria-hidden="true"
              />
              Reintentar
            </Button>
          </AlertDescription>
        </Alert>
      ) : !hasAny ? (
        <NoTemplates canCreate={canCreate} />
      ) : (
        <section aria-label="Listado de decisiones" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <ToggleGroup
              variant="outline"
              size="sm"
              spacing={0}
              value={[filter]}
              onValueChange={values => {
                const [next] = values
                if (isFilter(next)) setFilter(next)
              }}
              aria-label="Filtrar por estado"
            >
              {FILTERS.map(({ value, label }) => (
                <ToggleGroupItem key={value} value={value}>
                  {label}
                  <span className="ms-1 text-xs text-muted-foreground tabular-nums">
                    {counts[value]}
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <div className="relative w-full sm:max-w-xs">
              <SearchIcon
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Buscar por nombre o slug"
                aria-label="Buscar decisiones"
                className="ps-9 pe-9"
              />
              {query ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="absolute end-2 top-1/2 -translate-y-1/2"
                  aria-label="Limpiar búsqueda"
                  onClick={() => setQuery('')}
                >
                  <XIcon aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          </div>

          {visible.length > 0 ? (
            <>
              <TemplatesListView
                templates={visible}
                canArchive={canArchive}
                showStatus={filter === 'all'}
              />
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {countLabel(visible.length, 'decisión', 'decisiones')}
                {deferredQuery.trim()
                  ? ` coinciden con «${deferredQuery.trim()}»`
                  : null}
              </p>
            </>
          ) : deferredQuery.trim() ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchXIcon />
                </EmptyMedia>
                <EmptyTitle>Sin resultados</EmptyTitle>
                <EmptyDescription>
                  Ninguna decisión {filter === 'archived' ? 'archivada ' : ''}
                  coincide con «{deferredQuery.trim()}».
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" onClick={() => setQuery('')}>
                  Limpiar búsqueda
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {filter === 'archived' ? <ArchiveIcon /> : <WorkflowIcon />}
                </EmptyMedia>
                <EmptyTitle>
                  {filter === 'archived'
                    ? 'No hay decisiones archivadas'
                    : 'No hay decisiones activas'}
                </EmptyTitle>
                <EmptyDescription>
                  {filter === 'archived'
                    ? 'Las decisiones que archives aparecerán aquí; podrás restaurarlas cuando quieras.'
                    : 'Todas tus decisiones están archivadas. Restaura una o crea una nueva.'}
                </EmptyDescription>
              </EmptyHeader>
              {filter === 'active' && canCreate ? (
                <EmptyContent>
                  <NewTemplateButton />
                </EmptyContent>
              ) : null}
            </Empty>
          )}
        </section>
      )}
    </div>
  )
}
