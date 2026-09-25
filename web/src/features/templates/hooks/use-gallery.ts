import { queryOptions, useQuery } from '@tanstack/react-query'
import { api } from '#/sdk'

/** Ready-made templates: the same for every organization, and static. */
export const galleryQueryKey = ['gallery'] as const

export const galleryQueryOptions = queryOptions({
  queryKey: galleryQueryKey,
  queryFn: () => api.gallery.list(),
  staleTime: 60 * 60 * 1000
})

export function useGallery() {
  return useQuery(galleryQueryOptions)
}
