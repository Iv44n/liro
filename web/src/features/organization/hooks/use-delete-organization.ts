import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuth } from '#/features/auth/store/auth'
import { api } from '#/sdk'
import { useOrganization } from '../store/organization'
import { organizationsQueryKey } from './use-organizations'

/**
 * Elimina una organización (solo el `owner` tiene
 * permiso). Si era la organización activa, el backend deja la sesión sin
 * organización activa, por lo que se refresca la sesión y el listado. La
 * invalidación del router reevalúa los guards (p. ej. si era la última
 * organización, redirige al onboarding).
 */
export function useDeleteOrganization() {
  const refreshAuth = useAuth(state => state.refreshAuth)
  const refreshOrganizations = useOrganization(
    state => state.refreshOrganizations
  )
  const queryClient = useQueryClient()
  const router = useRouter()

  const mutation = useMutation({
    mutationFn: (organizationId: string) =>
      api.organization.delete({ organizationId }),
    onSuccess: async deleted => {
      await refreshAuth()
      await refreshOrganizations()
      await queryClient.invalidateQueries({ queryKey: organizationsQueryKey })
      await router.invalidate({ sync: true })

      toast.success('Organización eliminada', {
        description: `"${deleted.name}" fue eliminada.`
      })
    },
    onError: (err: Error) => {
      toast.error('No se pudo eliminar la organización', {
        description: err.message || 'Inténtalo de nuevo.'
      })
    }
  })

  return {
    deleteOrganization: mutation.mutate,
    isPending: mutation.isPending,
    pendingOrganizationId: mutation.isPending ? mutation.variables : undefined
  }
}
