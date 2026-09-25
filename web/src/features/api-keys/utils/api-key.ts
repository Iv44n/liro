import type { ApiKeyMode, ApiKeyView } from '#/sdk/modules/api-keys/types'

export const API_KEY_PREFIXES: Record<ApiKeyMode, string> = {
  live: 'lr_live_',
  test: 'lr_test_'
}

export const API_KEY_MODE_LABELS: Record<ApiKeyMode, string> = {
  live: 'Producción',
  test: 'Prueba'
}

/**
 * The key as the list shows it: its first characters and an ellipsis
 * (`lr_live_ab…`). Falls back to the mode's prefix when `start` is missing.
 */
export function maskedApiKey(key: Pick<ApiKeyView, 'start' | 'mode'>): string {
  return `${key.start || API_KEY_PREFIXES[key.mode]}…`
}

/** Days before expiry under which a key is flagged as expiring soon. */
export const EXPIRING_SOON_DAYS = 7

export type ApiKeyState = 'active' | 'expiring' | 'expired' | 'disabled'

export function apiKeyState(
  key: Pick<ApiKeyView, 'enabled' | 'expiresAt'>,
  now: number = Date.now()
): ApiKeyState {
  if (key.enabled === false) return 'disabled'
  if (!key.expiresAt) return 'active'

  const expiresAt = new Date(key.expiresAt).getTime()
  if (Number.isNaN(expiresAt)) return 'active'
  if (expiresAt <= now) return 'expired'
  return expiresAt - now <= EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000
    ? 'expiring'
    : 'active'
}
