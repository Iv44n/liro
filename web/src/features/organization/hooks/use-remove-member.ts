import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '#/sdk'
import { membersQueryKey } from './use-members'

/**
 * Elimina a un miembro de una organización (requiere
 * permiso `member:delete`: owner/admin). Tras eliminar, refresca el listado de
 * miembros de esa organización.
 */
export function useRemoveMember(organizationId?: string) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (memberIdOrEmail: string) =>
      api.organization.removeMember({ memberIdOrEmail, organizationId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: membersQueryKey(organizationId)
      })

      toast.success('Miembro eliminado')
    },
    onError: (err: Error) => {
      toast.error('No se pudo eliminar al miembro', {
        description: err.message || 'Inténtalo de nuevo.'
      })
    }
  })

  return {
    removeMember: mutation.mutate,
    isPending: mutation.isPending,
    pendingMemberId: mutation.isPending ? mutation.variables : undefined
  }
}
