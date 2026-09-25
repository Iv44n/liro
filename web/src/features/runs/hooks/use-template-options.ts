import { queryOptions, useQuery } from '@tanstack/react-query'
import { useAuth } from '#/features/auth/store/auth'
import { decisionLabels } from '#/features/templates/types/definition'
import { api } from '#/sdk'

/**
 * Every template of the organization, archived ones included (runs of an
 * archived template are still explorable). Lives under `['templates', …]`
 * so the templates feature's invalidations refresh it too.
 */
export const templateOptionsQueryKey = (
  organizationId: string | null | undefined
) => ['templates', 'options', organizationId ?? 'none'] as const

export const templateOptionsQueryOptions = (
  organizationId: string | null | undefined
) =>
  queryOptions({
    queryKey: templateOptionsQueryKey(organizationId),
    queryFn: () => api.templates.list({ status: 'all' }),
    staleTime: 60 * 1000
  })

export function useTemplateOptions() {
  const organizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  return useQuery(templateOptionsQueryOptions(organizationId))
}

/**
 * The decision labels of a template's latest released version (for the
 * decision filter); empty until one is published.
 */
export function useTemplateLabels(
  templateId: string | null,
  versionId: string | null | undefined
) {
  const organizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  return useQuery({
    queryKey: [
      'templates',
      'labels',
      organizationId ?? 'none',
      templateId,
      versionId
    ] as const,
    queryFn: async () => {
      if (!templateId || !versionId) return []
      const version = await api.templates.version(templateId, versionId)
      return decisionLabels(version.definition)
    },
    enabled: Boolean(templateId && versionId),
    staleTime: 5 * 60 * 1000
  })
}
