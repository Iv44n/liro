import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '#/features/auth/store/auth'
import { api } from '#/sdk'
import type {
  CreateWebhookEndpointRequest,
  UpdateWebhookEndpointRequest,
  WebhookEndpointView
} from '#/sdk/modules/webhooks/types'
import { errorText } from '../utils/errors'

export const webhooksBaseQueryKey = ['webhooks'] as const

export const webhooksListQueryKey = (
  organizationId: string | null | undefined
) => [...webhooksBaseQueryKey, 'list', organizationId ?? 'none'] as const

export const webhookQueryKey = (
  organizationId: string | null | undefined,
  id: string
) => [...webhooksBaseQueryKey, 'detail', organizationId ?? 'none', id] as const

export const webhooksListQueryOptions = (
  organizationId: string | null | undefined
) =>
  queryOptions({
    queryKey: webhooksListQueryKey(organizationId),
    queryFn: () => api.webhooks.list(),
    staleTime: 30 * 1000
  })

export const webhookQueryOptions = (
  organizationId: string | null | undefined,
  id: string
) =>
  queryOptions({
    queryKey: webhookQueryKey(organizationId, id),
    queryFn: () => api.webhooks.get(id),
    staleTime: 30 * 1000
  })

function useOrganizationId() {
  return useAuth(state => state.auth?.session.activeOrganizationId)
}

/** The organization's webhook endpoints, alphabetically (every role can list them). */
export function useWebhooks() {
  const organizationId = useOrganizationId()
  return useQuery(webhooksListQueryOptions(organizationId))
}

/** One endpoint's details (`/webhooks/$endpointId`). */
export function useWebhook(id: string) {
  const organizationId = useOrganizationId()
  return useQuery(webhookQueryOptions(organizationId, id))
}

/** `POST /api/webhooks`. The response carries the signing secret, shown once. */
export function useCreateWebhook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: CreateWebhookEndpointRequest) =>
      api.webhooks.create(request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: webhooksBaseQueryKey
      })
    },
    onError: (error: Error) => {
      toast.error('No se pudo crear el endpoint', {
        description: errorText(error)
      })
    }
  })
}

/** `PATCH /api/webhooks/:id`: rename, edit URL/description, or enable/disable. */
export function useUpdateWebhook() {
  const queryClient = useQueryClient()
  const organizationId = useOrganizationId()
  return useMutation({
    mutationFn: ({
      id,
      request
    }: {
      id: string
      request: UpdateWebhookEndpointRequest
    }) => api.webhooks.update(id, request),
    onSuccess: async (endpoint: WebhookEndpointView) => {
      queryClient.setQueryData(
        webhookQueryKey(organizationId, endpoint.id),
        endpoint
      )
      await queryClient.invalidateQueries({
        queryKey: webhooksBaseQueryKey
      })
    },
    onError: (error: Error) => {
      toast.error('No se pudo actualizar el endpoint', {
        description: errorText(error)
      })
    }
  })
}

/** `DELETE /api/webhooks/:id`. 409 `ENDPOINT_IN_USE` if a binding still points at it. */
export function useDeleteWebhook() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.webhooks.delete(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: webhooksBaseQueryKey
      })
      toast.success('Endpoint eliminado')
    },
    onError: (error: Error) => {
      toast.error('No se pudo eliminar el endpoint', {
        description: errorText(error)
      })
    }
  })
}
