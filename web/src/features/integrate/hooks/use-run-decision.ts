import { useMutation, useQueryClient } from '@tanstack/react-query'
import { reviewStatsBaseQueryKey } from '#/features/reviews/hooks/use-review-stats'
import type { JsonObject } from '#/features/templates/types/definition'
import { api } from '#/sdk'

/** A random `Idempotency-Key` (UUID v4; `randomUUID` needs a secure context). */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'))
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join('')
  ].join('-')
}

/**
 * "Probar ahora": `POST /v1/decisions/:ref/run` with the dashboard session,
 * which counts as a live caller — a real run, and a review task when the
 * result is `needs_review`. Each call gets a fresh `Idempotency-Key`, as an
 * integration would send. Errors are shown inline by the caller.
 */
export function useRunDecision(ref: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: ['v1', 'decisions', ref, 'run'],
    mutationFn: (input: JsonObject) =>
      api.v1.decisions.run(
        ref,
        { input },
        { idempotencyKey: newIdempotencyKey() }
      ),
    onSuccess: async run => {
      await queryClient.invalidateQueries({
        queryKey: ['runs'],
        refetchType: 'none'
      })
      if (run.review) {
        await queryClient.invalidateQueries({
          queryKey: reviewStatsBaseQueryKey
        })
      }
    }
  })
}
