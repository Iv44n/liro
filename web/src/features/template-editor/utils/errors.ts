import { AppError } from '#/sdk/core/app.error'
import type {
  ValidationFailedDetails,
  ValidationIssue
} from '#/sdk/modules/templates/types'
import type { StructureIssue } from '../schemas/definition'

/**
 * Spanish text for the API errors the editor can run into. The API's own
 * messages are English, so known codes get a translation; unknown ones keep
 * the API's message.
 */
const MESSAGES: Record<string, string> = {
  FORBIDDEN: 'Tu rol no tiene permiso para hacer esto.',
  NOT_A_MEMBER: 'Ya no eres miembro de la organización activa.',
  NO_ACTIVE_ORGANIZATION: 'No hay una organización activa.',
  NOT_FOUND: 'No se encontró la decisión (puede que la hayan eliminado).',
  UNAUTHORIZED: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  HTTP_401: 'Tu sesión expiró. Vuelve a iniciar sesión.',
  DRAFT_CONFLICT:
    'Alguien guardó otros cambios en este borrador desde que lo abriste.',
  PRECONDITION_REQUIRED: 'Falta la versión del borrador (If-Match).',
  NO_DRAFT: 'No hay un borrador que publicar.',
  NO_CHANGES: 'El borrador es idéntico a la última versión publicada.',
  LINT_FAILED: 'Corrige los errores del borrador antes de publicarlo.',
  BREAKING_CHANGES:
    'El borrador tiene cambios incompatibles: publícalo como versión mayor.',
  TEMPLATE_ARCHIVED:
    'La decisión está archivada: restáurala antes de publicarla.',
  SLUG_TAKEN: 'Otra decisión de la organización ya usa ese slug.',
  SLUG_LOCKED:
    'El slug ya no se puede cambiar: hay versiones publicadas que lo usan.',
  VERSION_NOT_PUBLISHED:
    'Solo se puede marcar como obsoleta una versión publicada.',
  VERSION_NOT_DEPRECATED: 'Esa versión no está marcada como obsoleta.',
  VALIDATION_FAILED: 'Hay datos no válidos.',
  INVALID_JSON: 'El cuerpo de la petición no es JSON válido.',
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

/** The error's `details`, typed by the caller for a known `code`. */
export const errorDetails = <T>(error: unknown): T | undefined =>
  AppError.fromUnknown<T>(error).details

/**
 * The issues of a 422 `VALIDATION_FAILED` on a draft save, relative to the
 * definition (`definition.questions.x` → `questions.x`).
 */
export function draftValidationIssues(error: unknown): StructureIssue[] {
  const details = errorDetails<ValidationFailedDetails>(error)
  const issues: ValidationIssue[] = Array.isArray(details?.issues)
    ? details.issues
    : []
  return issues.map(issue => ({
    path: issue.path.replace(/^definition(\.|$)/, ''),
    message: issue.message
  }))
}
