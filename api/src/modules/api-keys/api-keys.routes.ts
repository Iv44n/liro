import { Arcton } from '@arcton/core'
import { and, desc, eq } from 'drizzle-orm'
import z from 'zod'
import { apikeys } from '#modules/auth/auth.schemas'
import { API_KEY_CONFIGS, type ApiKeyMode, auth } from '#modules/auth/config'
import { db } from '#shared/db/config'
import { ApiError } from '#shared/http/errors'
import { requirePermission, withOrgSession } from '#shared/http/session'

const createApiKeySchema = z.object({
  name: z.string().trim().min(1).max(32),
  mode: z.enum(['live', 'test']).default('live'),
  /** Seconds until expiry; omitted = never expires. */
  expiresIn: z.number().int().positive().optional()
})

const modeOf = (configId: string): ApiKeyMode =>
  configId === API_KEY_CONFIGS.test.configId ? 'test' : 'live'

/** What the dashboard may see about a key — never the key itself. */
const publicColumns = {
  id: apikeys.id,
  name: apikeys.name,
  start: apikeys.start,
  configId: apikeys.configId,
  enabled: apikeys.enabled,
  expiresAt: apikeys.expiresAt,
  lastRequest: apikeys.lastRequest,
  createdAt: apikeys.createdAt
}

const tags = ['API keys']

/**
 * Organization API keys for `/v1`. Created server-side through the plugin
 * (the plugin's own client endpoints can't set org ownership explicitly), and
 * always scoped by the caller's active organization.
 */
export const apiKeysModule = Arcton({ prefix: '/api/api-keys' }).provide(
  withOrgSession
)

apiKeysModule.get('/', {
  detail: { summary: 'List API keys', tags },
  middleware: [requirePermission({ apiKey: ['read'] })],
  handler: async ({ organizationId }) => {
    const rows = await db
      .select(publicColumns)
      .from(apikeys)
      .where(eq(apikeys.referenceId, organizationId))
      .orderBy(desc(apikeys.createdAt))

    return {
      data: rows.map(({ configId, ...row }) => ({
        ...row,
        mode: modeOf(configId)
      }))
    }
  }
})

apiKeysModule.post('/', {
  body: createApiKeySchema,
  detail: { summary: 'Create an API key', tags },
  middleware: [requirePermission({ apiKey: ['create'] })],
  handler: async ({ response, organizationId, user, body }) => {
    const created = await auth.api.createApiKey({
      body: {
        configId: API_KEY_CONFIGS[body.mode].configId,
        organizationId,
        userId: user.id,
        name: body.name,
        ...(body.expiresIn ? { expiresIn: body.expiresIn } : {})
      }
    })

    response.status = 201
    return {
      id: created.id,
      name: created.name,
      mode: body.mode,
      start: created.start,
      expiresAt: created.expiresAt,
      createdAt: created.createdAt,
      // Shown once; only a hash is stored.
      key: created.key
    }
  }
})

apiKeysModule.delete('/:id', {
  detail: { summary: 'Revoke an API key', tags },
  middleware: [requirePermission({ apiKey: ['delete'] })],
  handler: async ({ params, response, organizationId }) => {
    const deleted = await db
      .delete(apikeys)
      .where(
        and(eq(apikeys.id, params.id), eq(apikeys.referenceId, organizationId))
      )
      .returning({ id: apikeys.id })

    if (deleted.length === 0) {
      throw new ApiError(404, 'NOT_FOUND', 'API key not found')
    }

    response.status = 204
  }
})
