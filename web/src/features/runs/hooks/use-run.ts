import { queryOptions, useQuery } from '@tanstack/react-query'
import { useAuth } from '#/features/auth/store/auth'
import { api } from '#/sdk'
import { runsBaseQueryKey } from './use-runs'

export const runQueryKey = (
  organizationId: string | null | undefined,
  runId: string
) => [...runsBaseQueryKey, 'detail', organizationId ?? 'none', runId] as const

export const runQueryOptions = (
  organizationId: string | null | undefined,
  runId: string
) =>
  queryOptions({
    queryKey: runQueryKey(organizationId, runId),
    queryFn: () => api.runs.get(runId),
    // A run that hasn't finished yet is polled until it does.
    refetchInterval: query => {
      const status = query.state.data?.status
      return status === 'queued' || status === 'running' ? 3000 : false
    }
  })

/** `GET /api/runs/:id`, with everything the detail page shows. */
export function useRun(runId: string) {
  const organizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  return useQuery(runQueryOptions(organizationId, runId))
}
