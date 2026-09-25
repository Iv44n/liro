import { AppError } from '#/sdk/core/app.error'

export interface InvalidRecipientsDetails {
  invalid: string[]
}

/** Spanish text for the API errors the effects tab can run into. */
const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Tu rol no tiene permiso para hacer esto.',
  NOT_FOUND: 'No se encontró (puede que lo hayan eliminado).',
  UNSAFE_URL: 'Esa URL no es alcanzable o no está permitida.',
  INVALID_SLACK_URL:
    'Debe ser una URL de webhook entrante de Slack (empieza con https://hooks.slack.com/).',
  RATE_LIMITED:
    'Demasiadas peticiones. Espera un momento y vuelve a intentarlo.',
  UNKNOWN_ERROR: 'No se pudo conectar con el servidor. Revisa tu conexión.'
}

/** A Spanish description of `error`, for toasts and inline alerts. */
export function errorText(error: unknown): string {
  const appError = AppError.fromUnknown(error)
  if (appError.code === 'INVALID_RECIPIENTS') {
    const details = appError.details as InvalidRecipientsDetails | undefined
    const invalid = details?.invalid ?? []
    return invalid.length > 0
      ? `No son correos verificados de la organización: ${invalid.join(', ')}.`
      : 'Uno o más destinatarios no son correos verificados de la organización.'
  }
  const known = MESSAGES[appError.code]
  if (known) return known
  if (appError.status !== undefined && appError.status >= 500) {
    return 'El servidor tuvo un problema. Inténtalo de nuevo en unos segundos.'
  }
  return appError.message || 'Inténtalo de nuevo.'
}

export const errorCode = (error: unknown): string =>
  AppError.fromUnknown(error).code
