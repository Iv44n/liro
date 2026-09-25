import type { ReviewStatus } from '#/sdk/modules/reviews/types'
import type {
  ListRunsParams,
  RunMode,
  RunSource,
  RunStatus
} from '#/sdk/modules/runs/types'

/** The runs explorer's filters; `null` = any. */
export interface RunFilters {
  templateId: string | null
  /** The engine's decision (a label or `needs_review`). */
  decision: string | null
  mode: RunMode | null
  source: RunSource | null
  status: RunStatus | null
  reviewStatus: ReviewStatus | null
  period: RunPeriod
}

export const RUN_PERIODS = ['24h', '7d', '30d', 'all'] as const
export type RunPeriod = (typeof RUN_PERIODS)[number]

export const RUN_PERIOD_LABELS: Record<RunPeriod, string> = {
  '24h': 'Últimas 24 h',
  '7d': 'Últimos 7 días',
  '30d': 'Últimos 30 días',
  all: 'Todo el historial'
}

const PERIOD_MS: Record<Exclude<RunPeriod, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000
}

export const DEFAULT_RUN_FILTERS: RunFilters = {
  templateId: null,
  decision: null,
  mode: null,
  source: null,
  status: null,
  reviewStatus: null,
  period: 'all'
}

/**
 * The inclusive lower bound of `period` as an ISO date-time, rounded down to
 * the minute; `undefined` for the whole history.
 */
export function periodStart(
  period: RunPeriod,
  now: number
): string | undefined {
  if (period === 'all') return undefined
  const start = now - PERIOD_MS[period]
  return new Date(start - (start % 60_000)).toISOString()
}

/** `GET /api/runs` params for `filters` (and one page of them). */
export function toListRunsParams(
  filters: RunFilters,
  page: { cursor?: string; from?: string; limit?: number } = {}
): ListRunsParams {
  const params: ListRunsParams = {}
  if (filters.templateId) params.templateId = filters.templateId
  if (filters.decision) params.decision = filters.decision
  if (filters.mode) params.mode = filters.mode
  if (filters.source) params.source = filters.source
  if (filters.status) params.status = filters.status
  if (filters.reviewStatus) params.reviewStatus = filters.reviewStatus
  if (page.from) params.from = page.from
  if (page.cursor) params.cursor = page.cursor
  if (page.limit) params.limit = page.limit
  return params
}

/** How many filters differ from the defaults (for the "Limpiar" button). */
export function countActiveFilters(filters: RunFilters): number {
  return (Object.keys(DEFAULT_RUN_FILTERS) as (keyof RunFilters)[]).filter(
    key => filters[key] !== DEFAULT_RUN_FILTERS[key]
  ).length
}

/**
 * The decision filter's options: `needs_review` first, then the selected
 * template's labels, then whatever else was seen in the loaded runs (and the
 * current value, so it never disappears from the list).
 */
export function decisionFilterOptions(input: {
  labels?: readonly string[]
  seen?: readonly (string | null)[]
  current?: string | null
  needsReview: string
}): string[] {
  const options = new Set<string>([input.needsReview])
  for (const label of input.labels ?? []) options.add(label)
  for (const decision of input.seen ?? []) if (decision) options.add(decision)
  if (input.current) options.add(input.current)
  return [...options]
}
