import { segment } from '#/sdk/http/query'

/**
 * Relative to the dashboard client's base URL (`…/api`). Shares the
 * `templates` resource's path rather than a prefix of its own, mirroring
 * `api/src/modules/effects/effects.routes.ts`.
 */
export const routes = {
  list: (templateId: string) => `/templates/${segment(templateId)}/effects`,
  create: (templateId: string) => `/templates/${segment(templateId)}/effects`,
  update: (templateId: string, bindingId: string) =>
    `/templates/${segment(templateId)}/effects/${segment(bindingId)}`,
  delete: (templateId: string, bindingId: string) =>
    `/templates/${segment(templateId)}/effects/${segment(bindingId)}`
} as const
