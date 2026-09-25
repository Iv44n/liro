import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { useActiveOrganizationId } from '#/features/templates/hooks/use-templates'
import { effectsApi } from '../api/effects-client'
import type { CreateWebhookEndpointInput } from '../types'
import { errorText } from '../utils/errors'

/**
 * Webhook endpoints of the active organization, for the "webhook" effect
 * type's picker (name + create-inline). The full `/webhooks` management
 * page is feature `webhooks` (W2-A); this only lists and creates.
 */
export const webhookEndpointsQueryKey = (
  organizationId: string | null | undefined
) => ['webhook-endpoints', organizationId ?? 'none'] as const

export const webhookEndpointsQueryOptions = (
  organizationId: string | null | undefined
) =>
  queryOptions({
    queryKey: webhookEndpointsQueryKey(organizationId),
    queryFn: () => effectsApi.listWebhookEndpoints(),
    staleTime: 30 * 1000
  })

export function useWebhookEndpoints() {
  const organizationId = useActiveOrganizationId()
  return useQuery(webhookEndpointsQueryOptions(organizationId))
}

/** `POST /api/webhooks`. The response carries the signing secret, shown once by the caller. */
export function useCreateWebhookEndpoint() {
  const queryClient = useQueryClient()
  const organizationId = useActiveOrganizationId()
  return useMutation({
    mutationFn: (body: CreateWebhookEndpointInput) =>
      effectsApi.createWebhookEndpoint(body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: webhookEndpointsQueryKey(organizationId)
      })
    },
    onError: (error: Error) => {
      toast.error('No se pudo crear el endpoint', {
        description: errorText(error)
      })
    }
  })
}
