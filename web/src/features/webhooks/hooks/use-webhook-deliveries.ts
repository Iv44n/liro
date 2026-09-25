import {
  infiniteQueryOptions,
  keepPreviousData,
  useInfiniteQuery
} from '@tanstack/react-query'
import { api } from '#/sdk'
import type { ExecutionStatus } from '#/sdk/modules/executions/types'
import type { WebhookDeliveriesPage } from '#/sdk/modules/webhooks/types'

export const deliveriesQueryKey = (
  endpointId: string,
  status: ExecutionStatus | null
) => ['webhooks', 'deliveries', endpointId, status ?? 'all'] as const

export const deliveriesInfiniteQueryOptions = (
  endpointId: string,
  status: ExecutionStatus | null
) =>
  infiniteQueryOptions({
    queryKey: deliveriesQueryKey(endpointId, status),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }): Promise<WebhookDeliveriesPage> =>
      api.webhooks.deliveries(endpointId, {
        status: status ?? undefined,
        cursor: pageParam
      }),
    getNextPageParam: last => last.nextCursor ?? undefined,
    staleTime: 15 * 1000
  })

/** An endpoint's deliveries, newest first, filtered by `status`. */
export function useWebhookDeliveries(
  endpointId: string,
  status: ExecutionStatus | null
) {
  return useInfiniteQuery({
    ...deliveriesInfiniteQueryOptions(endpointId, status),
    placeholderData: keepPreviousData
  })
}
