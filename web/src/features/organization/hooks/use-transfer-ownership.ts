import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuth } from '#/features/auth/store/auth'
import { api } from '#/sdk'
import { activeMemberRoleQueryKey } from './use-active-member-role'
import { membersQueryKey } from './use-members'

type TransferOwnershipInput = {
  /** `memberId` del miembro que pasará a ser propietario. */
  newOwnerMemberId: string
  /** `memberId` del propietario actual, que se degradará a administrador. */
  currentOwnerMemberId: string
}

/**
 * Transfiere la propiedad de una organización a otro miembro
 * No existe un endpoint nativo de transferencia, así
 * que se hace en dos pasos con `update-member-role`:
 *
 * 1. Promueve al nuevo propietario a `owner` (solo un owner puede asignar ese
 *    rol).
 * 2. Degrada al propietario anterior a `admin` (traspaso limpio). Se hace
 *    después para que siempre exista al menos un propietario.
 *
 * Tras la transferencia el rol del usuario cambia, por lo que se refresca la
 * sesión, el rol activo y el listado de miembros.
 */
export function useTransferOwnership(organizationId?: string) {
  const refreshAuth = useAuth(state => state.refreshAuth)
  const queryClient = useQueryClient()
  const router = useRouter()

  const mutation = useMutation({
    mutationFn: async ({
      newOwnerMemberId,
      currentOwnerMemberId
    }: TransferOwnershipInput) => {
      await api.organization.updateMemberRole({
        memberId: newOwnerMemberId,
        role: 'owner',
        organizationId
      })
      await api.organization.updateMemberRole({
        memberId: currentOwnerMemberId,
        role: 'admin',
        organizationId
      })
    },
    onSuccess: async () => {
      await refreshAuth()
      await queryClient.invalidateQueries({
        queryKey: membersQueryKey(organizationId)
      })
      await queryClient.invalidateQueries({
        queryKey: [activeMemberRoleQueryKey()[0]]
      })
      await router.invalidate({ sync: true })

      toast.success('Propiedad transferida', {
        description: 'Ahora eres administrador de la organización.'
      })
    },
    onError: (err: Error) => {
      toast.error('No se pudo transferir la propiedad', {
        description: err.message || 'Inténtalo de nuevo.'
      })
    }
  })

  return {
    transferOwnership: mutation.mutate,
    isPending: mutation.isPending,
    pendingMemberId: mutation.isPending
      ? mutation.variables?.newOwnerMemberId
      : undefined
  }
}
