import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '#/sdk'
import { errorText } from '../utils/errors'
import { webhooksBaseQueryKey } from './use-webhooks'

/**
 * `GET /api/webhooks/:id/secret`: reveals the current signing secret. A
 * mutation (not a query) since it's a deliberate, confirmed action — never
 * fetched or cached automatically.
 */
export function useRevealWebhookSecret(id: string) {
  return useMutation({
    mutationFn: () => api.webhooks.secret(id),
    onError: (error: Error) => {
      toast.error('No se pudo revelar el secreto', {
        description: errorText(error)
      })
    }
  })
}

/**
 * `POST /api/webhooks/:id/rotate-secret`: a fresh secret becomes current;
 * the previous one stays valid 24h more (both signatures are sent then).
 */
export function useRotateWebhookSecret(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => api.webhooks.rotateSecret(id),
    onSuccess: async () => {
      // failureCount/disabledReason aren't affected, but keep the endpoint fresh.
      await queryClient.invalidateQueries({ queryKey: webhooksBaseQueryKey })
    },
    onError: (error: Error) => {
      toast.error('No se pudo rotar el secreto', {
        description: errorText(error)
      })
    }
  })
}

/** `POST /api/webhooks/:id/test`: a signed `webhook.test` event, sent right now. */
export function useTestWebhook(id: string) {
  return useMutation({
    mutationFn: () => api.webhooks.test(id),
    onError: (error: Error) => {
      toast.error('No se pudo enviar la prueba', {
        description: errorText(error)
      })
    }
  })
}
