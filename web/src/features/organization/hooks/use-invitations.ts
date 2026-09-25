import { queryOptions, useQuery } from '@tanstack/react-query'
import { api } from '#/sdk'

/**
 * Clave de query del listado de invitaciones de una organización. Se
 * parametriza por `organizationId` (o `'active'` cuando se usa la activa) para
 * que cada organización gestione su propia caché de invitaciones.
 */
export const invitationsQueryKey = (organizationId?: string) =>
  ['organization-invitations', organizationId ?? 'active'] as const

export const invitationsQueryOptions = (organizationId?: string) =>
  queryOptions({
    queryKey: invitationsQueryKey(organizationId),
    queryFn: () => api.organization.listInvitations({ organizationId })
  })

/** Lista las invitaciones de una organización (por defecto, la activa). */
export function useInvitations(organizationId?: string, enabled = true) {
  return useQuery({
    ...invitationsQueryOptions(organizationId),
    enabled
  })
}
