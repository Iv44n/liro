import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '#/sdk'
import type { PlaygroundTestRequest } from '#/sdk/modules/templates/types'

/**
 * `POST /api/templates/:id/draft/test`: runs the editor's definition against
 * an input, in test mode (never creates a review task). Errors are shown
 * inline by the playground, so there is no toast here. A test run is stored
 * like any other run, so run lists are refreshed.
 */
export function usePlaygroundTest(templateId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ['templates', templateId, 'draft', 'test'],
    mutationFn: (request: PlaygroundTestRequest) =>
      api.templates.testDraft(templateId, request),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['runs'], refetchType: 'none' })
  })
}
