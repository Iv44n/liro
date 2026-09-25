import { queryOptions, useQuery } from '@tanstack/react-query'
import { effectsApi } from '../api/effects-client'

/**
 * Effect bindings of one template, plus warnings (`UNBOUND_LABEL`,
 * `ORPHAN_BINDING`) against its latest released version.
 */
export const effectBindingsQueryKey = (templateId: string) =>
  ['effects', 'bindings', templateId] as const

export const effectBindingsQueryOptions = (templateId: string) =>
  queryOptions({
    queryKey: effectBindingsQueryKey(templateId),
    queryFn: () => effectsApi.listBindings(templateId)
  })

export function useEffectBindings(templateId: string) {
  return useQuery(effectBindingsQueryOptions(templateId))
}
