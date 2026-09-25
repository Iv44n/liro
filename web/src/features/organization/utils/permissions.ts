import type { OrganizationRole } from '#/sdk/modules/organization/types'

/**
 * Acciones de organización controladas por rol. Reflejan la tabla de permisos
 * del producto y se usan para ocultar elementos del sidebar y proteger rutas
 * en el cliente. El servidor (better-auth + middleware) es la fuente de verdad;
 * esto es solo para la UX.
 */
export type OrgAction =
  | 'org:update'
  | 'org:delete'
  | 'org:leave'
  | 'member:add'
  | 'member:remove'
  | 'member:list'
  | 'member:transfer'
  | 'invitation:create'
  | 'invitation:cancel'
  | 'invitation:list'

type BaseRole = 'owner' | 'admin' | 'member'

const ROLE_PERMISSIONS: Record<BaseRole, ReadonlySet<OrgAction>> = {
  owner: new Set<OrgAction>([
    'org:update',
    'org:delete',
    'org:leave',
    'member:add',
    'member:remove',
    'member:list',
    'member:transfer',
    'invitation:create',
    'invitation:cancel',
    'invitation:list'
  ]),
  admin: new Set<OrgAction>([
    'org:update',
    'org:leave',
    'member:add',
    'member:remove',
    'member:list',
    'invitation:create',
    'invitation:cancel',
    'invitation:list'
  ]),
  member: new Set<OrgAction>(['org:leave', 'member:list'])
}

/**
 * Normaliza el rol que devuelve better-auth. Un miembro puede tener varios
 * roles separados por coma (p. ej. `"owner,admin"`), así que se separan todos.
 */
function parseRoles(role: OrganizationRole | null | undefined): string[] {
  if (!role) return []
  return role
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
}

/** Indica si el rol (posiblemente múltiple) puede ejecutar la acción. */
export function can(
  role: OrganizationRole | null | undefined,
  action: OrgAction
): boolean {
  return parseRoles(role).some(value =>
    ROLE_PERMISSIONS[value as BaseRole]?.has(action)
  )
}

/** Indica si el rol incluye `owner` (posiblemente entre varios roles). */
export function isOwner(role: OrganizationRole | null | undefined): boolean {
  return parseRoles(role).includes('owner')
}
