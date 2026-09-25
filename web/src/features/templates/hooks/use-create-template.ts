import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '#/sdk'
import type { CreateTemplateRequest } from '#/sdk/modules/templates/types'
import { templatesQueryKeys, useActiveOrganizationId } from './use-templates'

/**
 * `POST /api/templates`. Failures are not toasted here: the creation form
 * shows them next to the fields (`SLUG_TAKEN`, `VALIDATION_FAILED`) or in
 * its own alert.
 */
export function useCreateTemplate() {
  const organizationId = useActiveOrganizationId()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: (request: CreateTemplateRequest) =>
      api.templates.create(request),
    onSuccess: async ({ template }) => {
      queryClient.setQueryData(
        templatesQueryKeys.detail(organizationId, template.id),
        template
      )
      await queryClient.invalidateQueries({
        queryKey: templatesQueryKeys.organization(organizationId),
        refetchType: 'none'
      })

      toast.success('Decisión creada', {
        description: `«${template.name}» está lista como borrador. Pruébala y publícala cuando quieras.`
      })
    }
  })

  return {
    createTemplate: mutation.mutateAsync,
    isPending: mutation.isPending
  }
}
