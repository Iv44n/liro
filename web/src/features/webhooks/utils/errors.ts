import { AppError } from '#/sdk/core/app.error'
import type { EndpointInUseDetails } from '#/sdk/modules/webhooks/types'

/** Spanish text for the API errors the webhooks feature can run into. */
const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Tu rol no tiene permiso para hacer esto.',
  NOT_FOUND: 'No se encontró (puede que lo hayan eliminado).',
  UNSAFE_URL: 'Esa URL no es alcanzable o no está permitida.',
  EXECUTION_NOT_RETRYABLE: 'Esta entrega ya no se puede reintentar.',
  RATE_LIMITED:
    'Demasiadas peticiones. Espera un momento y vuelve a intentarlo.',
  UNKNOWN_ERROR: 'No se pudo conectar con el servidor. Revisa tu conexión.'
}

/** A Spanish description of `error`, for toasts and inline alerts. */
export function errorText(error: unknown): string {
  const appError = AppError.fromUnknown(error)
  const known = MESSAGES[appError.code]
  if (known) return known
  if (appError.status !== undefined && appError.status >= 500) {
    return 'El servidor tuvo un problema. Inténtalo de nuevo en unos segundos.'
  }
  return appError.message || 'Inténtalo de nuevo.'
}

export const errorCode = (error: unknown): string =>
  AppError.fromUnknown(error).code

/** The referencing templates of a 409 `ENDPOINT_IN_USE` error, if that's what `error` is. */
export function endpointInUseTemplates(
  error: unknown
): EndpointInUseDetails['templates'] | null {
  const appError = AppError.fromUnknown(error)
  if (appError.code !== 'ENDPOINT_IN_USE') return null
  const details = appError.details as EndpointInUseDetails | undefined
  return details?.templates ?? []
}
