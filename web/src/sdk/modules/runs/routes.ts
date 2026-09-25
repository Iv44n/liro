import { segment } from '#/sdk/http/query'

/** Relative to the dashboard client's base URL (`…/api`). */
export const routes = {
  list: '/runs',
  get: (id: string) => `/runs/${segment(id)}`
} as const
