import { queryOptions, useQuery } from '@tanstack/react-query'
import { useAuth } from '#/features/auth/store/auth'
import { api } from '#/sdk'
import type { TemplateStatusFilter } from '#/sdk/modules/templates/types'

/**
 * Query keys of `/api/templates`, per active organization. Invalidate
 * `templatesBaseQueryKey` after any change to a template (create, update,
 * archive, restore, publish): it covers every list and detail.
 */
export const templatesBaseQueryKey = ['templates'] as const

export const templatesQueryKeys = {
  /** Every template query of an organization. */
  organization: (organizationId?: string | null) =>
    [...templatesBaseQueryKey, organizationId ?? 'none'] as const,
  list: (
    organizationId: string | null | undefined,
    status: TemplateStatusFilter
  ) =>
    [
      ...templatesQueryKeys.organization(organizationId),
      'list',
      status
    ] as const,
  detail: (organizationId: string | null | undefined, templateId: string) =>
    [
      ...templatesQueryKeys.organization(organizationId),
      'detail',
      templateId
    ] as const
}

export const templatesQueryOptions = (
  organizationId: string | null | undefined,
  status: TemplateStatusFilter = 'all'
) =>
  queryOptions({
    queryKey: templatesQueryKeys.list(organizationId, status),
    queryFn: () => api.templates.list({ status }),
    staleTime: 30 * 1000
  })

export const useActiveOrganizationId = () =>
  useAuth(state => state.auth?.session.activeOrganizationId)

/**
 * The organization's templates, most recently updated first. Defaults to
 * `all` (active and archived): the list page filters them locally and the
 * creation form checks slugs against every one.
 */
export function useTemplates(status: TemplateStatusFilter = 'all') {
  const organizationId = useActiveOrganizationId()
  return useQuery(templatesQueryOptions(organizationId, status))
}
