import { queryOptions, useQuery } from '@tanstack/react-query'
import { api } from '#/sdk'

/**
 * A released version with its definition and input JSON Schema
 * (`GET /api/templates/:id/versions/:versionId`). A version's content never
 * changes once published, so it is cached for the whole session.
 */
export const versionDetailQueryKey = (templateId: string, versionId: string) =>
  ['templates', templateId, 'versions', versionId] as const

export const versionDetailQueryOptions = (
  templateId: string,
  versionId: string
) =>
  queryOptions({
    queryKey: versionDetailQueryKey(templateId, versionId),
    queryFn: () => api.templates.version(templateId, versionId),
    staleTime: Number.POSITIVE_INFINITY
  })

export function useVersionDetail(templateId: string, versionId: string | null) {
  return useQuery({
    ...versionDetailQueryOptions(templateId, versionId ?? ''),
    enabled: versionId !== null
  })
}
