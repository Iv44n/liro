import {
  type QueryClient,
  useMutation,
  useQueryClient
} from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '#/features/auth/store/auth'
import { runsBaseQueryKey } from '#/features/runs/hooks/use-runs'
import { decisionText } from '#/features/runs/utils/labels'
import { api } from '#/sdk'
import { AppError } from '#/sdk/core/app.error'
import type { ReviewView } from '#/sdk/modules/reviews/types'
import { reviewStatsBaseQueryKey } from './use-review-stats'
import { reviewQueryKey, reviewsBaseQueryKey } from './use-reviews'

/** Another reviewer closed it first (409). */
export const isReviewNotPending = (error: unknown) =>
  error instanceof AppError && error.code === 'REVIEW_NOT_PENDING'

async function refreshAfterChange(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: reviewsBaseQueryKey }),
    queryClient.invalidateQueries({ queryKey: reviewStatsBaseQueryKey }),
    queryClient.invalidateQueries({ queryKey: runsBaseQueryKey })
  ])
}

/**
 * Shared error handling: a review closed by someone else is refreshed and
 * explained; anything else is a plain error toast.
 */
function handleError(
  queryClient: QueryClient,
  error: Error,
  fallbackTitle: string
) {
  if (isReviewNotPending(error)) {
    toast.warning('Esta revisión ya fue resuelta', {
      description:
        'Otra persona la cerró antes que tú. Actualizamos la vista con su estado actual.'
    })
    void refreshAfterChange(queryClient)
    return
  }

  if (error instanceof AppError && error.code === 'INVALID_DECISION') {
    toast.error('Esa decisión ya no es válida', {
      description: 'Recargamos la revisión con las decisiones permitidas.'
    })
    void refreshAfterChange(queryClient)
    return
  }

  toast.error(fallbackTitle, {
    description: error.message || 'Inténtalo de nuevo.'
  })
}

function useOnReviewClosed() {
  const queryClient = useQueryClient()
  const organizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  return async (review: ReviewView) => {
    queryClient.setQueryData(reviewQueryKey(organizationId, review.id), review)
    await refreshAfterChange(queryClient)
  }
}

interface ResolveInput {
  reviewId: string
  decision: string
  comment?: string
}

/** `POST /api/reviews/:id/resolve` (permission `review:resolve`). */
export function useResolveReview() {
  const queryClient = useQueryClient()
  const onClosed = useOnReviewClosed()

  return useMutation({
    mutationFn: ({ reviewId, decision, comment }: ResolveInput) =>
      api.reviews.resolve(reviewId, {
        decision,
        comment: comment?.trim() || null
      }),
    onSuccess: async review => {
      await onClosed(review)
      toast.success('Revisión resuelta', {
        description: `Decisión final: ${decisionText(review.resolvedDecision)}.`
      })
    },
    onError: (error: Error) =>
      handleError(queryClient, error, 'No se pudo resolver la revisión')
  })
}

interface DismissInput {
  reviewId: string
  comment?: string
}

/** `POST /api/reviews/:id/dismiss`: closes it without a decision. */
export function useDismissReview() {
  const queryClient = useQueryClient()
  const onClosed = useOnReviewClosed()

  return useMutation({
    mutationFn: ({ reviewId, comment }: DismissInput) =>
      api.reviews.dismiss(reviewId, { comment: comment?.trim() || null }),
    onSuccess: async review => {
      await onClosed(review)
      toast.success('Revisión descartada', {
        description: 'La ejecución queda sin decisión final.'
      })
    },
    onError: (error: Error) =>
      handleError(queryClient, error, 'No se pudo descartar la revisión')
  })
}
