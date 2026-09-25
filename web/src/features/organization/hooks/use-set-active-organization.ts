import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuth } from '#/features/auth/store/auth'
import { api } from '#/sdk'
import { organizationsQueryKey } from './use-organizations'

type SetActiveOptions = {
  /** Redirige al workspace tras activar la organización. Por defecto `true`. */
  redirectToDashboard?: boolean
}

/**
 * Cambia la organización activa. El backend persiste
 * `activeOrganizationId` en la sesión, por lo que se refresca la sesión local
 * para reflejar el cambio.
 */
export function useSetActiveOrganization(options: SetActiveOptions = {}) {
  const { redirectToDashboard = true } = options

  const refreshAuth = useAuth(state => state.refreshAuth)
  const queryClient = useQueryClient()
  const router = useRouter()
  const navigate = useNavigate()

  const mutation = useMutation({
    mutationFn: (organizationId: string) =>
      api.organization.setActive({ organizationId }),
    onSuccess: async () => {
      await refreshAuth()
      await queryClient.invalidateQueries({ queryKey: organizationsQueryKey })
      await router.invalidate({ sync: true })

      if (redirectToDashboard) {
        await navigate({ to: '/dashboard', replace: true })
      }
    },
    onError: (err: Error) => {
      toast.error('No se pudo cambiar de organización', {
        description: err.message || 'Inténtalo de nuevo.'
      })
    }
  })

  return {
    setActive: mutation.mutate,
    isPending: mutation.isPending,
    pendingOrganizationId: mutation.isPending ? mutation.variables : undefined
  }
}
