import { segment } from '#/sdk/http/query'

/** Relative to the dashboard client's base URL (`…/api`). */
export const routes = {
  list: '/api-keys',
  create: '/api-keys',
  revoke: (id: string) => `/api-keys/${segment(id)}`
} as const
