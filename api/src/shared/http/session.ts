import type { Context, Middleware } from '@arcton/contracts'
import { Http } from '@arcton/core'
import { can, type Permission } from '#modules/auth/access'
import { auth } from '#modules/auth/config'
import { db } from '#shared/db/config'
import { ApiError } from './errors'

type SessionResult = NonNullable<
  Awaited<ReturnType<typeof auth.api.getSession>>
>

export type OrgSession = {
  user: SessionResult['user']
  session: SessionResult['session']
  organizationId: string
  role: string
}

/**
 * Resolves the caller's session and active organization for `/api/*` routes.
 *
 * The membership row is loaded on every request: better-auth only clears
 * `activeOrganizationId` when a member removes *themselves*, so a member
 * removed by someone else would otherwise keep access through their other
 * sessions.
 */
export async function resolveOrgSession(request: Request): Promise<OrgSession> {
  const result = await auth.api.getSession({ headers: request.headers })
  if (!result) throw Http.Unauthorized()

  const organizationId = result.session.activeOrganizationId
  if (!organizationId) {
    throw new ApiError(403, 'NO_ACTIVE_ORGANIZATION', 'No active organization')
  }

  const member = await db.query.members.findFirst({
    where: { userId: result.user.id, organizationId }
  })
  if (!member) {
    throw new ApiError(
      403,
      'NOT_A_MEMBER',
      'You are not a member of the active organization'
    )
  }

  return {
    user: result.user,
    session: result.session,
    organizationId,
    role: member.role
  }
}

/** `provide()` function for modules whose routes need an org session. */
export const withOrgSession = ({ request }: Context): Promise<OrgSession> =>
  resolveOrgSession(request)

/**
 * Route middleware rejecting callers whose role lacks `permission`. Generic
 * over params/query so it fits any route of a module that provides `role`.
 */
export function requirePermission<P, Q>(
  permission: Permission
): Middleware<P, Q, object, { role: string }> {
  return (ctx, next) => {
    if (!can(ctx.role, permission)) {
      throw new ApiError(403, 'FORBIDDEN', 'Insufficient permissions', {
        details: { required: permission }
      })
    }
    return next()
  }
}
