import { queryOptions, useQuery } from '@tanstack/react-query'
import { useAuth } from '#/features/auth/store/auth'
import { api } from '#/sdk'

/**
 * Pending review count (`GET /api/reviews/stats`), shown as the sidebar
 * badge. Invalidate `reviewStatsBaseQueryKey` after resolving/dismissing.
 */
export const reviewStatsBaseQueryKey = ['reviews', 'stats'] as const

export const reviewStatsQueryKey = (organizationId?: string | null) =>
  [...reviewStatsBaseQueryKey, organizationId ?? 'none'] as const

export const reviewStatsQueryOptions = (organizationId?: string | null) =>
  queryOptions({
    queryKey: reviewStatsQueryKey(organizationId),
    queryFn: () => api.reviews.stats(),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000
  })

export function useReviewStats() {
  const organizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  return useQuery(reviewStatsQueryOptions(organizationId))
}
