/**
 * Shapes of `/api/api-keys` (mirrors `api/src/modules/api-keys/
 * api-keys.routes.ts`). Dates are ISO strings.
 */

export const API_KEY_MODES = ['live', 'test'] as const
/** `live` keys (`lr_live_…`) run for real; `test` keys (`lr_test_…`) have no effects. */
export type ApiKeyMode = (typeof API_KEY_MODES)[number]

/** What the dashboard may see about a key — never the key itself. */
export interface ApiKeyView {
  id: string
  name: string | null
  /** The key's first characters, e.g. `lr_live_ab`. */
  start: string | null
  enabled: boolean | null
  expiresAt: string | null
  /** Last time the key was used. */
  lastRequest: string | null
  createdAt: string
  mode: ApiKeyMode
}

export interface CreateApiKeyRequest {
  /** 1..32 chars (trimmed). */
  name: string
  /** Default `live`. */
  mode?: ApiKeyMode
  /** Seconds until expiry; omitted = never expires. */
  expiresIn?: number
}

export interface CreatedApiKey {
  id: string
  name: string | null
  mode: ApiKeyMode
  start: string | null
  expiresAt: string | null
  createdAt: string
  /** The full key. Shown once: only a hash is stored. */
  key: string
}
