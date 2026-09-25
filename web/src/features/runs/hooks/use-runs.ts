import {
  infiniteQueryOptions,
  keepPreviousData,
  useInfiniteQuery
} from '@tanstack/react-query'
import { useAuth } from '#/features/auth/store/auth'
import { api } from '#/sdk'
import type { RunPage } from '#/sdk/modules/runs/types'
import {
  periodStart,
  type RunFilters,
  toListRunsParams
} from '../utils/filters'

/**
 * Every runs query starts with this key: invalidate it after anything that
 * changes a run (e.g. resolving its review).
 */
export const runsBaseQueryKey = ['runs'] as const

export const runsListQueryKey = (
  organizationId: string | null | undefined,
  filters: RunFilters
) => [...runsBaseQueryKey, 'list', organizationId ?? 'none', filters] as const

interface RunsPageParam {
  cursor?: string
  /** The period's lower bound, fixed by the first page so pages agree. */
  from?: string
}

type RunsPage = RunPage & { from?: string }

export const runsInfiniteQueryOptions = (
  organizationId: string | null | undefined,
  filters: RunFilters
) =>
  infiniteQueryOptions({
    queryKey: runsListQueryKey(organizationId, filters),
    initialPageParam: {} as RunsPageParam,
    queryFn: async ({ pageParam }): Promise<RunsPage> => {
      const from = pageParam.from ?? periodStart(filters.period, Date.now())
      const page = await api.runs.list(
        toListRunsParams(filters, { cursor: pageParam.cursor, from })
      )
      return { ...page, from }
    },
    getNextPageParam: (last): RunsPageParam | undefined =>
      last.nextCursor
        ? { cursor: last.nextCursor, from: last.from }
        : undefined,
    staleTime: 15 * 1000
  })

/** The runs explorer: newest first, one page per "Cargar más". */
export function useRuns(filters: RunFilters) {
  const organizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  return useInfiniteQuery({
    ...runsInfiniteQueryOptions(organizationId, filters),
    // Keeps the table on screen (dimmed) while other filters load.
    placeholderData: keepPreviousData
  })
}
