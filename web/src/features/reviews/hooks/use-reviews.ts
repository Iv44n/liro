import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery
} from '@tanstack/react-query'
import { useAuth } from '#/features/auth/store/auth'
import { api } from '#/sdk'
import type { ReviewListStatus } from '#/sdk/modules/reviews/types'

/**
 * Every review query (lists, details and the sidebar's stats) starts with
 * `['reviews']`; invalidate it after resolving or dismissing.
 */
export const reviewsBaseQueryKey = ['reviews'] as const

export const reviewsListQueryKey = (
  organizationId: string | null | undefined,
  status: ReviewListStatus
) => [...reviewsBaseQueryKey, 'list', organizationId ?? 'none', status] as const

export const reviewsInfiniteQueryOptions = (
  organizationId: string | null | undefined,
  status: ReviewListStatus
) =>
  infiniteQueryOptions({
    queryKey: reviewsListQueryKey(organizationId, status),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.reviews.list({ status, cursor: pageParam }),
    getNextPageParam: last => last.nextCursor ?? undefined,
    staleTime: 15 * 1000
  })

/** `pending` is oldest first (a work queue); the others newest first. */
export function useReviews(status: ReviewListStatus) {
  const organizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  return useInfiniteQuery(reviewsInfiniteQueryOptions(organizationId, status))
}

export const reviewQueryKey = (
  organizationId: string | null | undefined,
  reviewId: string
) =>
  [
    ...reviewsBaseQueryKey,
    'detail',
    organizationId ?? 'none',
    reviewId
  ] as const

export const reviewQueryOptions = (
  organizationId: string | null | undefined,
  reviewId: string
) =>
  queryOptions({
    queryKey: reviewQueryKey(organizationId, reviewId),
    queryFn: () => api.reviews.get(reviewId)
  })

export function useReview(reviewId: string) {
  const organizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  return useQuery(reviewQueryOptions(organizationId, reviewId))
}

/**
 * The pending review to show after `currentId`: the next one in the queue
 * (oldest first), else the oldest one left; `null` when the inbox is empty.
 */
export async function findNextPendingReview(
  currentId: string
): Promise<string | null> {
  const after = await api.reviews.list({
    status: 'pending',
    cursor: currentId,
    limit: 1
  })
  const next = after.data[0]
  if (next) return next.id

  const first = await api.reviews.list({ status: 'pending', limit: 2 })
  return first.data.find(review => review.id !== currentId)?.id ?? null
}
