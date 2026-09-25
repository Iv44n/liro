import { FilterXIcon, SlidersHorizontalIcon } from 'lucide-react'
import { useId, useState } from 'react'
import { REVIEW_STATUS_LABELS } from '#/features/reviews/utils/labels'
import { NEEDS_REVIEW } from '#/features/templates/types/definition'
import { REVIEW_STATUSES, type ReviewStatus } from '#/sdk/modules/reviews/types'
import {
  RUN_MODES,
  RUN_SOURCES,
  RUN_STATUSES,
  type RunMode,
  type RunSource,
  type RunStatus
} from '#/sdk/modules/runs/types'
import type { TemplateView } from '#/sdk/modules/templates/types'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { cn } from '#/shared/utils/shadcn.utils'
import {
  countActiveFilters,
  RUN_PERIOD_LABELS,
  RUN_PERIODS,
  type RunFilters,
  type RunPeriod
} from '../utils/filters'
import {
  decisionText,
  RUN_MODE_LABELS,
  RUN_SOURCE_LABELS,
  RUN_STATUS_LABELS
} from '../utils/labels'
import { FilterSelect } from './filter-select'

const options = <T extends string>(
  values: readonly T[],
  labels: Record<T, string>
) => values.map(value => ({ value, label: labels[value] }))

/**
 * The runs explorer's filters. On phones they fold behind a "Filtros"
 * button (with the active count); from `md` up they are always shown.
 */
export function RunsFilters({
  filters,
  onChange,
  onReset,
  templates,
  decisionOptions
}: {
  filters: RunFilters
  onChange: (patch: Partial<RunFilters>) => void
  onReset: () => void
  templates: readonly TemplateView[] | undefined
  decisionOptions: readonly string[]
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const active = countActiveFilters(filters)

  const templateOptions = (templates ?? []).map(template => ({
    value: template.id,
    label:
      template.status === 'archived'
        ? `${template.name} (archivada)`
        : template.name
  }))
  // Keep a selected template listed while the list loads.
  if (
    filters.templateId &&
    !templateOptions.some(option => option.value === filters.templateId)
  ) {
    templateOptions.push({ value: filters.templateId, label: 'Decisión' })
  }

  return (
    <section aria-label="Filtros de ejecuciones" className="space-y-3">
      <div className="flex items-center justify-between gap-2 md:hidden">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={open}
          aria-controls={`${id}-filters`}
          onClick={() => setOpen(value => !value)}
        >
          <SlidersHorizontalIcon aria-hidden="true" />
          Filtros
          {active > 0 ? (
            <Badge className="ms-1 h-4 min-w-4 px-1">{active}</Badge>
          ) : null}
        </Button>
        {active > 0 ? (
          <Button type="button" variant="ghost" size="sm" onClick={onReset}>
            <FilterXIcon aria-hidden="true" />
            Limpiar
          </Button>
        ) : null}
      </div>

      <div
        id={`${id}-filters`}
        className={cn(
          'grid-cols-2 gap-3 sm:grid-cols-3 md:grid md:grid-cols-4 xl:grid-cols-7',
          open ? 'grid' : 'hidden'
        )}
      >
        <FilterSelect
          id={`${id}-template`}
          label="Decisión"
          anyLabel="Todas"
          value={filters.templateId}
          options={templateOptions}
          className="col-span-2 sm:col-span-1"
          onChange={templateId =>
            // Labels differ per template: a decision filter wouldn't carry over.
            onChange({ templateId, decision: null })
          }
        />
        <FilterSelect
          id={`${id}-decision`}
          label="Resultado"
          anyLabel="Todos"
          value={filters.decision}
          options={decisionOptions.map(decision => ({
            value: decision,
            label:
              decision === NEEDS_REVIEW
                ? `${decisionText(decision)} (${NEEDS_REVIEW})`
                : decision
          }))}
          onChange={decision => onChange({ decision })}
        />
        <FilterSelect
          id={`${id}-mode`}
          label="Modo"
          anyLabel="Todos"
          value={filters.mode}
          options={options(RUN_MODES, RUN_MODE_LABELS)}
          onChange={mode => onChange({ mode: mode as RunMode | null })}
        />
        <FilterSelect
          id={`${id}-source`}
          label="Origen"
          anyLabel="Todos"
          value={filters.source}
          options={options(RUN_SOURCES, RUN_SOURCE_LABELS)}
          onChange={source => onChange({ source: source as RunSource | null })}
        />
        <FilterSelect
          id={`${id}-status`}
          label="Estado"
          anyLabel="Todos"
          value={filters.status}
          options={options(RUN_STATUSES, RUN_STATUS_LABELS)}
          onChange={status => onChange({ status: status as RunStatus | null })}
        />
        <FilterSelect
          id={`${id}-review`}
          label="Revisión"
          anyLabel="Todas"
          value={filters.reviewStatus}
          options={options(REVIEW_STATUSES, REVIEW_STATUS_LABELS)}
          onChange={reviewStatus =>
            onChange({ reviewStatus: reviewStatus as ReviewStatus | null })
          }
        />
        <FilterSelect
          id={`${id}-period`}
          label="Periodo"
          anyLabel={RUN_PERIOD_LABELS.all}
          value={filters.period === 'all' ? null : filters.period}
          options={options(
            RUN_PERIODS.filter(period => period !== 'all'),
            RUN_PERIOD_LABELS
          )}
          onChange={period =>
            onChange({ period: (period as RunPeriod | null) ?? 'all' })
          }
        />
      </div>

      {active > 0 ? (
        <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
          <span>
            {active === 1 ? '1 filtro activo' : `${active} filtros activos`}
          </span>
          <Button type="button" variant="ghost" size="xs" onClick={onReset}>
            <FilterXIcon aria-hidden="true" />
            Limpiar filtros
          </Button>
        </div>
      ) : null}
    </section>
  )
}
