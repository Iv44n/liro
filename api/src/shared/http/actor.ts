import type { Context } from '@arcton/contracts'
import { API_KEY_CONFIGS, type ApiKeyMode, auth } from '#modules/auth/config'
import { db } from '#shared/db/config'
import { ApiError } from './errors'
import { resolveOrgSession } from './session'

/** Who is calling a `/v1` route, and on behalf of which organization. */
export type Actor =
  | {
      type: 'api_key'
      organizationId: string
      apiKeyId: string
      mode: ApiKeyMode
      userId: null
    }
  | {
      type: 'user'
      organizationId: string
      apiKeyId: null
      mode: 'live'
      userId: string
      role: string
    }

const invalidApiKey = () =>
  new ApiError(401, 'INVALID_API_KEY', 'Invalid or missing API key')

/** `x-api-key: <key>` or `Authorization: Bearer <key>` (n8n/Zapier/Make). */
export function extractApiKey(headers: Headers): string | null {
  const header = headers.get('x-api-key')?.trim()
  if (header) return header

  const authorization = headers.get('authorization')
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() || null
}

/** The key's config, from its public prefix (`lr_live_…` / `lr_test_…`). */
function modeOfKey(key: string): ApiKeyMode | null {
  for (const [mode, config] of Object.entries(API_KEY_CONFIGS)) {
    if (key.startsWith(config.defaultPrefix)) return mode as ApiKeyMode
  }
  return null
}

export async function resolveActor(request: Request): Promise<Actor> {
  const key = extractApiKey(request.headers)

  // No key: fall back to the dashboard session (e.g. the playground or the
  // Integrate tab calling /v1 from the browser).
  if (!key) {
    const session = await resolveOrgSession(request)
    return {
      type: 'user',
      organizationId: session.organizationId,
      apiKeyId: null,
      mode: 'live',
      userId: session.user.id,
      role: session.role
    }
  }

  const mode = modeOfKey(key)
  if (!mode) throw invalidApiKey()

  const result = await auth.api.verifyApiKey({
    body: { key, configId: API_KEY_CONFIGS[mode].configId }
  })
  if (!result.valid || !result.key) throw invalidApiKey()

  // The key's owner is only a `reference_id` (no FK): make sure the
  // organization still exists.
  const organization = await db.query.organizations.findFirst({
    where: { id: result.key.referenceId },
    columns: { id: true }
  })
  if (!organization) throw invalidApiKey()

  return {
    type: 'api_key',
    organizationId: organization.id,
    apiKeyId: result.key.id,
    mode,
    userId: null
  }
}

/** `provide()` function for `/v1` modules. */
export const withActor = async ({
  request
}: Context): Promise<{ actor: Actor }> => ({
  actor: await resolveActor(request)
})
