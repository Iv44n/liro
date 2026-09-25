import { segment } from '#/sdk/http/query'

/** Relative to the dashboard client's base URL (`…/api`). */
export const routes = {
  list: '/webhooks',
  create: '/webhooks',
  get: (id: string) => `/webhooks/${segment(id)}`,
  update: (id: string) => `/webhooks/${segment(id)}`,
  delete: (id: string) => `/webhooks/${segment(id)}`,
  secret: (id: string) => `/webhooks/${segment(id)}/secret`,
  rotateSecret: (id: string) => `/webhooks/${segment(id)}/rotate-secret`,
  test: (id: string) => `/webhooks/${segment(id)}/test`,
  deliveries: (id: string) => `/webhooks/${segment(id)}/deliveries`
} as const
