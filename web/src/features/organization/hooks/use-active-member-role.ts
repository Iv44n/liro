import { queryOptions, useQuery } from '@tanstack/react-query'
import { api } from '#/sdk'

/**
 * Clave del rol del usuario en la organización activa. Se parametriza por
 * `organizationId` para que, al cambiar de organización activa, se vuelva a
 * pedir el rol (la respuesta del endpoint depende de la organización activa de
 * la sesión).
 */
export const activeMemberRoleQueryKey = (organizationId?: string | null) =>
  ['active-member-role', organizationId ?? 'none'] as const

export const activeMemberRoleQueryOptions = (organizationId?: string | null) =>
  queryOptions({
    queryKey: activeMemberRoleQueryKey(organizationId),
    queryFn: () => api.organization.getActiveMemberRole()
  })

/** Rol del usuario en la organización activa; base del control de acceso de la UI. */
export function useActiveMemberRole(
  organizationId?: string | null,
  enabled = true
) {
  return useQuery({
    ...activeMemberRoleQueryOptions(organizationId),
    enabled
  })
}
