import { queryOptions, useQuery } from '@tanstack/react-query'
import { api } from '#/sdk'

/**
 * Clave del listado de miembros de una organización. Se parametriza por
 * `organizationId` (o `'active'` cuando se usa la activa) para que cada
 * organización gestione su propia caché de miembros.
 */
export const membersQueryKey = (organizationId?: string) =>
  ['organization-members', organizationId ?? 'active'] as const

export const membersQueryOptions = (organizationId?: string) =>
  queryOptions({
    queryKey: membersQueryKey(organizationId),
    queryFn: () => api.organization.listMembers({ organizationId })
  })

/** Lista los miembros de una organización (por defecto, la activa). */
export function useMembers(organizationId?: string, enabled = true) {
  return useQuery({
    ...membersQueryOptions(organizationId),
    enabled
  })
}
