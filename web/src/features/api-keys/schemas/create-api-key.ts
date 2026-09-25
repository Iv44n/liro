import { z } from 'zod'
import {
  API_KEY_MODES,
  type CreateApiKeyRequest
} from '#/sdk/modules/api-keys/types'

/** The API accepts 1..32 characters (trimmed). */
export const API_KEY_NAME_MAX_LENGTH = 32

/**
 * Expiration choices. The API takes `expiresIn` in seconds and accepts 1 to
 * 365 days; `never` omits it.
 */
export const API_KEY_EXPIRATIONS = ['never', '7', '30', '90', '365'] as const
export type ApiKeyExpiration = (typeof API_KEY_EXPIRATIONS)[number]

export const API_KEY_EXPIRATION_LABELS: Record<ApiKeyExpiration, string> = {
  never: 'Nunca',
  '7': '7 días',
  '30': '30 días',
  '90': '90 días',
  '365': '1 año'
}

const DAY_SECONDS = 24 * 60 * 60

export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Ponle un nombre a la clave')
    .max(
      API_KEY_NAME_MAX_LENGTH,
      `Máximo ${API_KEY_NAME_MAX_LENGTH} caracteres`
    ),
  mode: z.enum(API_KEY_MODES),
  expiration: z.enum(API_KEY_EXPIRATIONS)
})

export type CreateApiKeyFormData = z.input<typeof createApiKeySchema>

export const createApiKeyDefaults: CreateApiKeyFormData = {
  name: '',
  mode: 'live',
  expiration: 'never'
}

/** The request body for the form's values. */
export function toCreateApiKeyRequest(
  values: CreateApiKeyFormData
): CreateApiKeyRequest {
  const request: CreateApiKeyRequest = {
    name: values.name.trim(),
    mode: values.mode
  }
  if (values.expiration !== 'never') {
    request.expiresIn = Number(values.expiration) * DAY_SECONDS
  }
  return request
}
