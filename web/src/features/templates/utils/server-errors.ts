import { AppError } from '#/sdk/core/app.error'
import type {
  SlugTakenDetails,
  ValidationFailedDetails,
  ValidationIssue
} from '#/sdk/modules/templates/types'

/**
 * `POST /api/templates` failures turned into what the creation form shows:
 * errors next to the fields they belong to (409 `SLUG_TAKEN`, 422
 * `VALIDATION_FAILED`) and the rest as form-level messages, all in Spanish.
 * Field names are TanStack Form paths (`labels[1].label`).
 */
export interface CreateFormErrors {
  fields: Record<string, string>
  form: string[]
}

/** Top-level keys of the creation form that API paths can map onto. */
const FORM_ROOTS = new Set(['name', 'slug', 'description'])

const isIndex = (segment: string | undefined): segment is string =>
  segment !== undefined && /^\d+$/.test(segment)

/**
 * The form field an API issue path points at (`source.labels.1.label` →
 * `labels[1].label`), or `null` when it has no field of its own.
 */
export function apiPathToFormPath(path: string): string | null {
  const segments = path.split('.').filter(Boolean)
  const [root] = segments
  if (root === undefined) return null
  if (FORM_ROOTS.has(root)) return root
  if (root !== 'source') return null

  const [, key, second, third] = segments
  switch (key) {
    case 'fields': {
      if (!isIndex(second)) return 'fields'
      const item = `fields[${second}]`
      if (third === undefined || third === 'path') return `${item}.path`
      if (third === 'enum') return `${item}.enumValues`
      if (third === 'type' || third === 'description') return `${item}.${third}`
      return `${item}.path`
    }
    case 'labels': {
      if (!isIndex(second)) return 'labels'
      const item = `labels[${second}]`
      return third === 'description' || third === 'criteria'
        ? `${item}.description`
        : `${item}.label`
    }
    case 'yes':
    case 'no':
      return second === 'description' || second === 'criteria'
        ? `${key}.description`
        : `${key}.label`
    case 'instructions':
      return 'instructions'
    case 'minConfidence':
      return 'minConfidence'
    case 'yesThreshold':
    case 'noThreshold':
      return 'bands'
    default:
      return null
  }
}

const leafOf = (formPath: string) => formPath.split('.').at(-1) ?? formPath

/** A Spanish message for an API validation issue on `formPath`. */
export function issueMessage(formPath: string, issue: ValidationIssue): string {
  const leaf = leafOf(formPath)
  switch (issue.code) {
    case 'invalid_format':
    case 'custom':
      if (leaf === 'slug') {
        return 'Usa minúsculas y números separados por guiones (p. ej. tickets-soporte).'
      }
      if (leaf === 'label') {
        return 'Usa minúsculas y números separados por _ o - (p. ej. facturacion).'
      }
      if (leaf === 'path') {
        return 'Usa identificadores separados por puntos (p. ej. ticket.message).'
      }
      return `Valor no válido: ${issue.message}`
    case 'too_big':
      return 'Es demasiado largo.'
    case 'too_small':
      return formPath === 'labels'
        ? 'Añade al menos 2 etiquetas.'
        : 'Este campo es obligatorio.'
    case 'out_of_range':
      return 'El umbral está fuera del rango permitido.'
    default:
      return issue.message
  }
}

const NETWORK_MESSAGE =
  'No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.'

/**
 * A Spanish description of any failed request, for toasts and error states
 * (the API's own messages are in English).
 */
export function describeError(error: unknown): string {
  if (!(error instanceof AppError)) return NETWORK_MESSAGE
  switch (error.code) {
    case 'FORBIDDEN':
      return 'No tienes permiso para hacer esto en esta organización.'
    case 'UNAUTHORIZED':
      return 'Tu sesión expiró. Vuelve a iniciar sesión para continuar.'
    case 'NO_ACTIVE_ORGANIZATION':
      return 'Elige una organización activa para continuar.'
    case 'NOT_FOUND':
      return 'La decisión ya no existe o pertenece a otra organización.'
    case 'RATE_LIMITED':
      return 'Demasiadas solicitudes. Espera unos segundos e inténtalo de nuevo.'
    default:
      return error.status !== undefined && error.status >= 500
        ? 'El servidor tuvo un problema. Inténtalo de nuevo en unos minutos.'
        : error.message || 'Ocurrió un error inesperado. Inténtalo de nuevo.'
  }
}

/** What the creation form shows for a failed `POST /api/templates`. */
export function createErrorToFormErrors(error: unknown): CreateFormErrors {
  if (!(error instanceof AppError)) {
    return { fields: {}, form: [NETWORK_MESSAGE] }
  }

  switch (error.code) {
    case 'SLUG_TAKEN': {
      const { slug } = (error.details ?? {}) as Partial<SlugTakenDetails>
      return {
        fields: {
          slug: slug
            ? `Ya existe una decisión con el slug «${slug}» en tu organización (quizá archivada). Elige otro.`
            : 'Ese slug ya está en uso en tu organización. Elige otro.'
        },
        form: []
      }
    }
    case 'VALIDATION_FAILED': {
      const { issues = [] } = (error.details ??
        {}) as Partial<ValidationFailedDetails>
      const result: CreateFormErrors = { fields: {}, form: [] }
      for (const issue of issues) {
        const formPath = apiPathToFormPath(issue.path)
        if (formPath === null) {
          result.form.push(
            issue.path ? `${issue.path}: ${issue.message}` : issue.message
          )
        } else {
          result.fields[formPath] ??= issueMessage(formPath, issue)
        }
      }
      if (issues.length === 0) {
        result.form.push('Revisa los datos del formulario.')
      }
      return result
    }
    case 'FORBIDDEN':
      return {
        fields: {},
        form: ['No tienes permiso para crear decisiones en esta organización.']
      }
    default:
      return { fields: {}, form: [describeError(error)] }
  }
}

/**
 * The value at a TanStack Form path (`labels[1].label`) inside `values`, or
 * `undefined` when any step is missing.
 */
export function valueAtPath(values: unknown, path: string): unknown {
  const steps = path.match(/[^.[\]]+/g) ?? []
  let current: unknown = values
  for (const step of steps) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[step]
  }
  return current
}
