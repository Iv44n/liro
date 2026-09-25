import { Arcton } from '@arcton/core'
import { can } from '#modules/auth/access'
import { withActor } from '#shared/http/actor'
import { withOrgSession } from '#shared/http/session'

/** `GET /api/me`: the dashboard's view of the current user and org. */
export const meModule = Arcton({ prefix: '/api/me' }).provide(withOrgSession)

meModule.get('/', {
  detail: {
    summary: 'Current user and active organization',
    tags: ['Identity']
  },
  handler: ({ user, organizationId, role }) => ({
    user: { id: user.id, name: user.name, email: user.email },
    organizationId,
    role,
    permissions: {
      template: {
        create: can(role, { template: ['create'] }),
        update: can(role, { template: ['update'] }),
        publish: can(role, { template: ['publish'] }),
        archive: can(role, { template: ['archive'] })
      },
      review: { resolve: can(role, { review: ['resolve'] }) },
      webhook: { manage: can(role, { webhook: ['manage'] }) },
      apiKey: {
        create: can(role, { apiKey: ['create'] }),
        delete: can(role, { apiKey: ['delete'] })
      }
    }
  })
})

/**
 * `GET /v1/whoami`: lets integrators check an API key (and whether it's a
 * live or test key) without running a decision.
 */
export const whoamiModule = Arcton({ prefix: '/v1/whoami' }).provide(withActor)

whoamiModule.get('/', {
  detail: { summary: 'Identify the caller', tags: ['Identity'] },
  handler: ({ actor }) => ({
    type: actor.type,
    organizationId: actor.organizationId,
    mode: actor.mode,
    ...(actor.apiKeyId ? { apiKeyId: actor.apiKeyId } : {})
  })
})
