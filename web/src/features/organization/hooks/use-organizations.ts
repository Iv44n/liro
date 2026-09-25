import { queryOptions, useQuery } from '@tanstack/react-query'
import { api } from '#/sdk'

export const organizationsQueryKey = ['organizations'] as const

/**
 * Query única para el listado de organizaciones del usuario. Se comparte entre
 * los guards de las rutas (`ensureQueryData`), la pantalla de organizaciones y
 * el sidebar, por lo que solo se hace una llamada a `list`. El `staleTime`
 * evita que `useQuery` vuelva a pedir los datos recién cacheados por el guard.
 */
export const organizationsQueryOptions = queryOptions({
  queryKey: organizationsQueryKey,
  queryFn: () => api.organization.list(),
  staleTime: 5 * 60 * 1000
})

export function useOrganizations() {
  return useQuery(organizationsQueryOptions)
}
