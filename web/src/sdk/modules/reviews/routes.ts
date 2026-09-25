import { segment } from '#/sdk/http/query'

/** Relative to the dashboard client's base URL (`…/api`). */
export const routes = {
  list: '/reviews',
  stats: '/reviews/stats',
  get: (id: string) => `/reviews/${segment(id)}`,
  resolve: (id: string) => `/reviews/${segment(id)}/resolve`,
  dismiss: (id: string) => `/reviews/${segment(id)}/dismiss`
} as const
