import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuth } from '#/features/auth/store/auth'
import { api } from '#/sdk'
import { useOrganization } from '../store/organization'
import { organizationsQueryKey } from './use-organizations'

/**
 * Abandona una organización: elimina al usuario como
 * miembro. El `owner` no puede abandonar la organización (debe eliminarla o
 * transferir la propiedad), por lo que el backend devuelve un error en ese
 * caso. Si era la organización activa, la sesión queda sin organización activa;
 * por eso se refresca la sesión y el listado, y se reevalúan los guards.
 */
export function useLeaveOrganization() {
  const refreshAuth = useAuth(state => state.refreshAuth)
  const refreshOrganizations = useOrganization(
    state => state.refreshOrganizations
  )
  const queryClient = useQueryClient()
  const router = useRouter()

  const mutation = useMutation({
    mutationFn: (organizationId: string) =>
      api.organization.leave({ organizationId }),
    onSuccess: async () => {
      await refreshAuth()
      await refreshOrganizations()
      await queryClient.invalidateQueries({ queryKey: organizationsQueryKey })
      await router.invalidate({ sync: true })

      toast.success('Saliste de la organización')
    },
    onError: (err: Error) => {
      toast.error('No se pudo salir de la organización', {
        description: err.message || 'Inténtalo de nuevo.'
      })
    }
  })

  return {
    leaveOrganization: mutation.mutate,
    isPending: mutation.isPending,
    pendingOrganizationId: mutation.isPending ? mutation.variables : undefined
  }
}
