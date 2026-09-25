import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuth } from '#/features/auth/store/auth'
import { api } from '#/sdk'
import { useOrganization } from '../store/organization'
import { organizationsQueryKey } from './use-organizations'
import { userInvitationsQueryKey } from './use-user-invitations'

type AcceptInvitationOptions = {
  /** Redirige al selector de organizaciones tras aceptar. Por defecto `true`. */
  redirect?: boolean
}

/**
 * Acepta una invitación con `organization-plugin`. El usuario pasa a ser
 * miembro de la organización, por lo que se refresca la sesión y el listado de
 * organizaciones. No deja la organización como activa: se redirige al selector
 * para que el usuario la elija.
 */
export function useAcceptInvitation(options: AcceptInvitationOptions = {}) {
  const { redirect = true } = options

  const refreshAuth = useAuth(state => state.refreshAuth)
  const refreshOrganizations = useOrganization(
    state => state.refreshOrganizations
  )
  const queryClient = useQueryClient()
  const router = useRouter()
  const navigate = useNavigate()

  const mutation = useMutation({
    mutationFn: (invitationId: string) =>
      api.organization.acceptInvitation({ invitationId }),
    onSuccess: async ({ invitation }) => {
      await refreshAuth()
      await refreshOrganizations()
      await queryClient.invalidateQueries({ queryKey: organizationsQueryKey })
      await queryClient.invalidateQueries({
        queryKey: userInvitationsQueryKey
      })
      await router.invalidate({ sync: true })

      toast.success('Invitación aceptada', {
        description: 'Ya formas parte de la organización.'
      })

      if (redirect) {
        await navigate({ to: '/organizations', replace: true })
      }

      return invitation
    },
    onError: (err: Error) => {
      toast.error('No se pudo aceptar la invitación', {
        description: err.message || 'Inténtalo de nuevo.'
      })
    }
  })

  return {
    acceptInvitation: mutation.mutate,
    isPending: mutation.isPending,
    pendingInvitationId: mutation.isPending ? mutation.variables : undefined
  }
}
