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
  ApiKeyView,
  CreateApiKeyRequest
} from '#/sdk/modules/api-keys/types'

export const apiKeysBaseQueryKey = ['api-keys'] as const

export const apiKeysQueryKey = (organizationId: string | null | undefined) =>
  [...apiKeysBaseQueryKey, organizationId ?? 'none'] as const

export const apiKeysQueryOptions = (
  organizationId: string | null | undefined
) =>
  queryOptions({
    queryKey: apiKeysQueryKey(organizationId),
    queryFn: () => api.apiKeys.list(),
    staleTime: 30 * 1000
  })

/** The organization's API keys, newest first (every role can list them). */
export function useApiKeys() {
  const organizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  return useQuery(apiKeysQueryOptions(organizationId))
}

/**
 * `POST /api/api-keys`. The response carries the full key, which is shown
 * once and never stored in the query cache.
 */
export function useCreateApiKey() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (request: CreateApiKeyRequest) => api.apiKeys.create(request),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: apiKeysBaseQueryKey })
    },
    onError: (error: Error) => {
      toast.error('No se pudo crear la API key', {
        description: error.message || 'Inténtalo de nuevo.'
      })
    }
  })
}

/** `DELETE /api/api-keys/:id`: the key stops working immediately. */
export function useRevokeApiKey() {
  const queryClient = useQueryClient()
  const organizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  return useMutation({
    mutationFn: (key: ApiKeyView) => api.apiKeys.revoke(key.id),
    onSuccess: async (_result, key) => {
      // Drop it right away; the refetch confirms.
      queryClient.setQueryData<ApiKeyView[]>(
        apiKeysQueryKey(organizationId),
        keys => keys?.filter(item => item.id !== key.id)
      )
      await queryClient.invalidateQueries({ queryKey: apiKeysBaseQueryKey })
      toast.success('API key revocada', {
        description: key.name
          ? `«${key.name}» ya no puede llamar a la API.`
          : 'La clave ya no puede llamar a la API.'
      })
    },
    onError: (error: Error) => {
      toast.error('No se pudo revocar la API key', {
        description: error.message || 'Inténtalo de nuevo.'
      })
    }
  })
}
