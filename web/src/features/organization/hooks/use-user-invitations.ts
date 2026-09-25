import { queryOptions, useQuery } from '@tanstack/react-query'
import { api } from '#/sdk'

/** Invitaciones que ha recibido el usuario autenticado. */
export const userInvitationsQueryKey = ['user-invitations'] as const

export const userInvitationsQueryOptions = queryOptions({
  queryKey: userInvitationsQueryKey,
  queryFn: () => api.organization.listUserInvitations()
})

export function useUserInvitations() {
  return useQuery(userInvitationsQueryOptions)
}
