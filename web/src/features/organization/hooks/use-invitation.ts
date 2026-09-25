import { queryOptions, useQuery } from '@tanstack/react-query'
import { api } from '#/sdk'

export const invitationQueryKey = (invitationId: string) =>
  ['invitation', invitationId] as const

export const invitationQueryOptions = (invitationId: string) =>
  queryOptions({
    queryKey: invitationQueryKey(invitationId),
    queryFn: () => api.organization.getInvitation({ id: invitationId }),
    retry: false
  })

/** Consulta una invitación por su id (datos de la organización e invitante). */
export function useInvitation(invitationId: string) {
  return useQuery(invitationQueryOptions(invitationId))
}
