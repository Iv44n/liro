import { queryOptions, useQuery } from '@tanstack/react-query'
import { useAuth } from '#/features/auth/store/auth'
import { api } from '#/sdk'

/**
 * `GET /api/me`: user, active organization, role and the permission map the
 * dashboard uses to hide/disable actions. Keyed by the active organization,
 * since the answer depends on it (switching organizations refetches).
 */
export const meQueryKey = (organizationId?: string | null) =>
  ['me', organizationId ?? 'none'] as const

export const meQueryOptions = (organizationId?: string | null) =>
  queryOptions({
    queryKey: meQueryKey(organizationId),
    queryFn: () => api.me.get(),
    staleTime: 5 * 60 * 1000
  })

/** The current user's `/api/me` for the active organization. */
export function useMe() {
  const organizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  return useQuery(meQueryOptions(organizationId))
}

/** The permission map, or `undefined` while it loads (treat as "not allowed"). */
export function usePermissions() {
  return useMe().data?.permissions
}
