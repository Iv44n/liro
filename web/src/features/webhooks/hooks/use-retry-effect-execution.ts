import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '#/sdk'
import { errorText } from '../utils/errors'

/**
 * `POST /api/effect-executions/:id/retry`: only a `dead`/`canceled`
 * execution (409 `EXECUTION_NOT_RETRYABLE` otherwise). Shared by the
 * endpoint's deliveries table and a run's "Efectos" section.
 */
export function useRetryEffectExecution() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.executions.retry(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['webhooks', 'deliveries']
        }),
        queryClient.invalidateQueries({
          queryKey: ['webhooks', 'run-effects']
        })
      ])
      toast.success('Entrega puesta en cola de nuevo')
    },
    onError: (error: Error) => {
      toast.error('No se pudo reintentar', {
        description: errorText(error)
      })
    }
  })
}
