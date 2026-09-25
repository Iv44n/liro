import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '#/sdk'
import type { TemplateView } from '#/sdk/modules/templates/types'
import { describeError } from '../utils/server-errors'
import { templatesQueryKeys, useActiveOrganizationId } from './use-templates'

type StatusAction = 'archive' | 'restore'

/** Replaces `updated` in every cached list of the organization. */
function patchLists(
  lists: [readonly unknown[], TemplateView[] | undefined][],
  updated: TemplateView
) {
  return lists.map(
    ([key, list]) =>
      [
        key,
        list?.map(template => (template.id === updated.id ? updated : template))
      ] as const
  )
}

/**
 * Archives (`POST …/archive`) or restores (`POST …/restore`) a template
 * (permission `template:archive`). An archived template refuses runs with
 * 410 `TEMPLATE_ARCHIVED` until it is restored; archiving toasts an
 * "Deshacer" action that restores it.
 */
export function useTemplateStatus() {
  const organizationId = useActiveOrganizationId()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: ({
      template,
      action
    }: {
      template: TemplateView
      action: StatusAction
    }) =>
      action === 'archive'
        ? api.templates.archive(template.id)
        : api.templates.restore(template.id),
    onSuccess: async (updated, { action }) => {
      const listsKey = [
        ...templatesQueryKeys.organization(organizationId),
        'list'
      ]
      const lists = queryClient.getQueriesData<TemplateView[]>({
        queryKey: listsKey
      })
      for (const [key, list] of patchLists(lists, updated)) {
        queryClient.setQueryData(key, list)
      }
      queryClient.setQueryData(
        templatesQueryKeys.detail(organizationId, updated.id),
        updated
      )
      await queryClient.invalidateQueries({
        queryKey: templatesQueryKeys.organization(organizationId)
      })

      if (action === 'archive') {
        toast.success('Decisión archivada', {
          description: `«${updated.name}» ya no acepta ejecuciones.`,
          action: {
            label: 'Deshacer',
            onClick: () =>
              mutation.mutate({ template: updated, action: 'restore' })
          }
        })
      } else {
        toast.success('Decisión restaurada', {
          description: `«${updated.name}» vuelve a aceptar ejecuciones.`
        })
      }
    },
    onError: (error: Error, { action }) => {
      toast.error(
        action === 'archive'
          ? 'No se pudo archivar la decisión'
          : 'No se pudo restaurar la decisión',
        { description: describeError(error) }
      )
    }
  })

  return {
    setTemplateStatus: mutation.mutate,
    isPending: mutation.isPending,
    /** The template whose status is changing, while the request runs. */
    pendingTemplateId: mutation.isPending
      ? mutation.variables?.template.id
      : undefined
  }
}
