import { type QueryClient, queryOptions, useQuery } from '@tanstack/react-query'
import {
  templatesQueryKeys,
  useActiveOrganizationId
} from '#/features/templates/hooks/use-templates'
import { api } from '#/sdk'

/**
 * Query keys of the editor. Everything lives under `['templates', …]`, so
 * invalidating `['templates']` (e.g. from the list page) refreshes it too.
 *
 * `detail` reuses `templatesQueryKeys.detail` from the templates-list
 * feature verbatim (rather than a same-shaped-by-hand copy), so this is
 * *the same cache entry* the list page's archive/restore/create mutations
 * read and write — see `templatesQueryKeys` in
 * `#/features/templates/hooks/use-templates` — instead of two independently
 * shaped `['templates', …]` keys that only coincidentally never collide.
 */
export const templateKeys = {
  all: ['templates'] as const,
  detail: templatesQueryKeys.detail,
  draft: (id: string) => ['templates', 'draft', id] as const,
  versions: (id: string) => ['templates', 'versions', id] as const,
  version: (id: string, versionId: string) =>
    ['templates', 'version', id, versionId] as const
}

export const templateQueryOptions = (
  organizationId: string | null | undefined,
  id: string
) =>
  queryOptions({
    queryKey: templateKeys.detail(organizationId, id),
    queryFn: () => api.templates.get(id)
  })

/**
 * The draft and its ETag. A refetch never overwrites unsaved edits: the
 * editor store only loads it when there's nothing unsaved (see
 * `EditorState.receive`).
 */
export const draftQueryOptions = (id: string) =>
  queryOptions({
    queryKey: templateKeys.draft(id),
    queryFn: () => api.templates.getDraft(id),
    staleTime: 30_000
  })

export const versionsQueryOptions = (id: string) =>
  queryOptions({
    queryKey: templateKeys.versions(id),
    queryFn: () => api.templates.versions(id)
  })

/** A released version with its definition (immutable, so cached for good). */
export const versionQueryOptions = (id: string, versionId: string) =>
  queryOptions({
    queryKey: templateKeys.version(id, versionId),
    queryFn: () => api.templates.version(id, versionId),
    staleTime: Number.POSITIVE_INFINITY
  })

export const useTemplate = (id: string) => {
  const organizationId = useActiveOrganizationId()
  return useQuery(templateQueryOptions(organizationId, id))
}
export const useDraft = (id: string) => useQuery(draftQueryOptions(id))
export const useVersions = (id: string) => useQuery(versionsQueryOptions(id))
export const useVersion = (id: string, versionId: string | null) =>
  useQuery({
    ...versionQueryOptions(id, versionId ?? ''),
    enabled: versionId !== null
  })

/**
 * Marks template listings (and details) stale after a change, without
 * refetching the draft — the editor updates it itself.
 */
export function invalidateTemplateListings(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    queryKey: templateKeys.all,
    predicate: query => {
      const [, scope] = query.queryKey
      return scope !== 'draft' && scope !== 'version'
    }
  })
}
