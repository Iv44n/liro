import { queryOptions, useQuery } from '@tanstack/react-query'
import { useAuth } from '#/features/auth/store/auth'
import { api } from '#/sdk'
import { RUNS_PAGE_LIMIT } from '#/sdk/modules/runs/types'
import { periodStart } from '../utils/filters'
import { isNeedsReview } from '../utils/labels'
import { runsBaseQueryKey } from './use-runs'

export interface RecentRunsStats {
  /** Runs of the last 24 h, up to one page (`RUNS_PAGE_LIMIT.max`). */
  count: number
  /** There are more than `count` (the page was full). */
  more: boolean
  /** Of those, how many went to human review. */
  needsReview: number
}

/** The dashboard's "ejecuciones (24 h)": the first page is enough. */
export const recentRunsStatsQueryOptions = (
  organizationId: string | null | undefined
) =>
  queryOptions({
    queryKey: [
      ...runsBaseQueryKey,
      'recent',
      organizationId ?? 'none'
    ] as const,
    queryFn: async (): Promise<RecentRunsStats> => {
      const page = await api.runs.list({
        from: periodStart('24h', Date.now()),
        limit: RUNS_PAGE_LIMIT.max
      })
      return {
        count: page.data.length,
        more: page.nextCursor !== null,
        needsReview: page.data.filter(run => isNeedsReview(run.decision)).length
      }
    },
    staleTime: 30 * 1000
  })

export function useRecentRunsStats() {
  const organizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  return useQuery(recentRunsStatsQueryOptions(organizationId))
}

/** Whether the organization ever ran a decision through `/v1` (onboarding). */
export function useHasApiRuns() {
  const organizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  return useQuery({
    queryKey: [
      ...runsBaseQueryKey,
      'has-api-runs',
      organizationId ?? 'none'
    ] as const,
    queryFn: async () => {
      const page = await api.runs.list({ source: 'api', limit: 1 })
      return page.data.length > 0
    },
    staleTime: 60 * 1000
  })
}
