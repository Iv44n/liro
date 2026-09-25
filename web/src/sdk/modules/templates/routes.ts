import { segment } from '#/sdk/http/query'

/** Relative to the dashboard client's base URL (`…/api`). */
export const routes = {
  list: '/templates',
  create: '/templates',
  lint: '/templates/lint',
  get: (id: string) => `/templates/${segment(id)}`,
  update: (id: string) => `/templates/${segment(id)}`,
  archive: (id: string) => `/templates/${segment(id)}/archive`,
  restore: (id: string) => `/templates/${segment(id)}/restore`,
  draft: (id: string) => `/templates/${segment(id)}/draft`,
  testDraft: (id: string) => `/templates/${segment(id)}/draft/test`,
  publish: (id: string) => `/templates/${segment(id)}/publish`,
  versions: (id: string) => `/templates/${segment(id)}/versions`,
  version: (id: string, versionId: string) =>
    `/templates/${segment(id)}/versions/${segment(versionId)}`,
  deprecate: (id: string, versionId: string) =>
    `/templates/${segment(id)}/versions/${segment(versionId)}/deprecate`,
  undeprecate: (id: string, versionId: string) =>
    `/templates/${segment(id)}/versions/${segment(versionId)}/undeprecate`
} as const
