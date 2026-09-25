import { queryOptions, useQuery } from '@tanstack/react-query'
import { api } from '#/sdk'

/**
 * `GET /api/runs/:id/effects`: the effect executions one run triggered, for
 * the run detail page's "Efectos" section.
 */
export const runEffectsQueryKey = (runId: string) =>
  ['webhooks', 'run-effects', runId] as const

export const runEffectsQueryOptions = (runId: string) =>
  queryOptions({
    queryKey: runEffectsQueryKey(runId),
    queryFn: () => api.executions.listByRun(runId),
    staleTime: 15 * 1000
  })

export function useRunEffects(runId: string) {
  return useQuery(runEffectsQueryOptions(runId))
}
