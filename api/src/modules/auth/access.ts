import { createAccessControl } from 'better-auth/plugins/access'
import {
  adminAc,
  defaultStatements,
  memberAc,
  ownerAc
} from 'better-auth/plugins/organization/access'

/**
 * Liro's permission statements, on top of better-auth's organization ones.
 * `apiKey` is also what `@better-auth/api-key` checks for organization-owned
 * keys (`{ apiKey: [action] }`) — without it only the owner could manage them.
 */
export const statements = {
  ...defaultStatements,
  template: ['create', 'update', 'publish', 'archive'],
  review: ['resolve'],
  webhook: ['manage'],
  apiKey: ['create', 'read', 'update', 'delete']
} as const

export const ac = createAccessControl(statements)

const manageEverything = {
  template: ['create', 'update', 'publish', 'archive'],
  review: ['resolve'],
  webhook: ['manage'],
  apiKey: ['create', 'read', 'update', 'delete']
} as const

export const roles = {
  owner: ac.newRole({ ...ownerAc.statements, ...manageEverything }),
  admin: ac.newRole({ ...adminAc.statements, ...manageEverything }),
  member: ac.newRole({
    ...memberAc.statements,
    template: ['create', 'update'],
    review: ['resolve'],
    apiKey: ['read']
  })
}

export type Role = keyof typeof roles

type Statements = typeof statements
export type Permission = {
  [Resource in keyof Statements]?: readonly Statements[Resource][number][]
}

/** Whether `role` (possibly a comma-separated list, as better-auth stores it) grants `permission`. */
export function can(role: string, permission: Permission): boolean {
  return role
    .split(',')
    .map(name => name.trim())
    .some(name => {
      const definition = roles[name as Role]
      return definition?.authorize(permission as never).success ?? false
    })
}
