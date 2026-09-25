import { HttpClient } from '#/sdk/http/http-client'

/**
 * A local dashboard-API client for the effects/webhooks endpoints, scoped to
 * this feature only. `src/sdk/**` doesn't have `api.effects`/`api.webhooks`
 * yet — those SDK modules are W2-A's scope (built concurrently on the same
 * API) — so per the "wrap it locally" rule this mirrors `sdk.ts`'s dashboard
 * client construction (`${VITE_API_URL}/api`, cookie session) instead of
 * editing `src/sdk/sdk.ts`. Once the SDK grows `api.effects`/`api.webhooks`,
 * this file and `effects-client.ts` can be dropped in favor of them.
 */
export const effectsHttp = HttpClient.create({
  baseURL: `${import.meta.env.VITE_API_URL}/api`,
  config: { credentials: 'include' }
})
