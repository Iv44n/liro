import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { api } from '#/sdk'
import type { UpdateOrganizationRequest } from '#/sdk/modules/organization/types'
import { useOrganization } from '../store/organization'
import { organizationsQueryKey } from './use-organizations'

/**
 * Actualiza los datos de una organización (requiere
 * permiso `organization:update`: owner/admin). El nombre, slug y logo se leen
 * del listado de organizaciones, por lo que se refresca el store y la caché y
 * se reevalúan los guards.
 */
export function useUpdateOrganization() {
  const refreshOrganizations = useOrganization(
    state => state.refreshOrganizations
  )
  const queryClient = useQueryClient()
  const router = useRouter()

  const mutation = useMutation({
    mutationFn: (request: UpdateOrganizationRequest) =>
      api.organization.update(request),
    onSuccess: async updated => {
      await refreshOrganizations()
      await queryClient.invalidateQueries({ queryKey: organizationsQueryKey })
      await router.invalidate({ sync: true })

      toast.success('Organización actualizada', {
        description: `Se guardaron los cambios de "${updated.name}".`
      })
    },
    onError: (err: Error) => {
      toast.error('No se pudo actualizar la organización', {
        description: err.message || 'Inténtalo de nuevo.'
      })
    }
  })

  return {
    updateOrganization: mutation.mutate,
    isPending: mutation.isPending
  }
}
