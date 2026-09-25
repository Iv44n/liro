import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '#/sdk'
import { invitationsQueryKey } from './use-invitations'

/**
 * Cancela una invitación pendiente que envió la organización
 * (`organization-plugin`). Requiere permiso `invitation:cancel`. Tras
 * cancelar, refresca el listado de invitaciones de esa organización.
 */
export function useCancelInvitation(organizationId?: string) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (invitationId: string) =>
      api.organization.cancelInvitation({ invitationId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: invitationsQueryKey(organizationId)
      })

      toast.success('Invitación cancelada')
    },
    onError: (err: Error) => {
      toast.error('No se pudo cancelar la invitación', {
        description: err.message || 'Inténtalo de nuevo.'
      })
    }
  })

  return {
    cancelInvitation: mutation.mutate,
    isPending: mutation.isPending,
    pendingInvitationId: mutation.isPending ? mutation.variables : undefined
  }
}
