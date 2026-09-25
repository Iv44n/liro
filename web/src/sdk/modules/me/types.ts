/** `GET /api/me` (mirrors `api/src/modules/identity/identity.routes.ts`). */

export interface MePermissions {
  template: {
    create: boolean
    update: boolean
    publish: boolean
    archive: boolean
  }
  review: { resolve: boolean }
  webhook: { manage: boolean }
  apiKey: { create: boolean; delete: boolean }
}

export interface Me {
  user: { id: string; name: string; email: string }
  organizationId: string
  /** better-auth role(s), possibly comma-separated (`owner`, `admin`, `member`). */
  role: string
  permissions: MePermissions
}
