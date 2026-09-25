import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '#/sdk'
import { userInvitationsQueryKey } from './use-user-invitations'

/**
 * Rechaza una invitación recibida. Tras rechazarla,
 * refresca el listado de invitaciones del usuario.
 */
export function useRejectInvitation() {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (invitationId: string) =>
      api.organization.rejectInvitation({ invitationId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: userInvitationsQueryKey
      })

      toast.success('Invitación rechazada')
    },
    onError: (err: Error) => {
      toast.error('No se pudo rechazar la invitación', {
        description: err.message || 'Inténtalo de nuevo.'
      })
    }
  })

  return {
    rejectInvitation: mutation.mutate,
    isPending: mutation.isPending,
    pendingInvitationId: mutation.isPending ? mutation.variables : undefined
  }
}
