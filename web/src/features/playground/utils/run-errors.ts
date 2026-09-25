import type {
  InputField,
  LintIssue
} from '#/features/templates/types/definition'
import { AppError } from '#/sdk/core/app.error'
import type {
  InputTooLargeDetails,
  LintFailedDetails,
  ValidationFailedDetails,
  ValidationIssue
} from '#/sdk/modules/templates/types'

/**
 * Errors of a test run (`POST /api/templates/:id/draft/test`) or a `/v1`
 * run, turned into what the UI shows: a Spanish title and description,
 * whether retrying may help, and — for 422s — the lint issues or the input
 * issues, mapped onto the form's fields where possible.
 */

export interface InputIssue {
  /** Path inside the input (`ticket.message`); `''` for the whole input. */
  path: string
  message: string
}

export interface RunErrorView {
  code: string
  title: string
  description: string
  /** Retrying later may succeed (429/503/504, network). */
  retryable: boolean
  /** `LINT_FAILED`: the definition's issues. */
  lint: LintIssue[]
  /** `VALIDATION_FAILED`: form field path → message. */
  fieldErrors: Record<string, string>
  /** `VALIDATION_FAILED` issues no form field shows. */
  issues: InputIssue[]
  /** The API's own (English) message, for the curious. */
  technical: string | null
}

const INPUT_PREFIX = 'input'

/** `input.ticket.message` → `ticket.message`; `input` → `''`; other paths → `null`. */
export function inputPathOf(path: string): string | null {
  if (path === INPUT_PREFIX) return ''
  return path.startsWith(`${INPUT_PREFIX}.`)
    ? path.slice(INPUT_PREFIX.length + 1)
    : null
}

const EXPECTED_TYPES: Record<string, string> = {
  string: 'un texto',
  number: 'un número',
  int: 'un número entero',
  boolean: 'verdadero o falso',
  array: 'un array',
  object: 'un objeto',
  record: 'un objeto'
}

/** A zod issue from the API (English) as a Spanish message. */
export function translateIssue(issue: ValidationIssue): string {
  const { code, message } = issue
  if (code === 'invalid_type') {
    if (/received undefined/.test(message)) return 'Campo obligatorio.'
    if (/received null/.test(message)) {
      return 'No admite null: deja el campo vacío para omitirlo.'
    }
    const expected = /expected (\w+)/.exec(message)?.[1]
    const type = expected ? EXPECTED_TYPES[expected] : undefined
    return type ? `Debe ser ${type}.` : 'Tipo de dato incorrecto.'
  }
  if (code === 'too_big') {
    const max = /<=\s*(\d+)/.exec(message)?.[1]
    return max ? `Máximo ${max} caracteres.` : 'Valor demasiado grande.'
  }
  if (code === 'invalid_value') return 'Valor no permitido.'
  if (code === 'invalid_union' || code === 'invalid_format') {
    return /ISO 8601/.test(message)
      ? 'Fecha ISO 8601: 2026-01-01 o 2026-01-01T09:30:00Z.'
      : 'Formato no válido.'
  }
  return message
}

/**
 * `VALIDATION_FAILED` issues split into form field errors and the rest. An
 * issue belongs to the field whose path is the issue's path or a prefix of
 * it (`tags.0` → `tags`); the first issue of a field wins.
 */
export function mapValidationIssues(
  fields: readonly InputField[],
  issues: readonly ValidationIssue[]
): { fieldErrors: Record<string, string>; issues: InputIssue[] } {
  const fieldErrors: Record<string, string> = {}
  const rest: InputIssue[] = []

  for (const issue of issues) {
    const path = inputPathOf(issue.path)
    const message = translateIssue(issue)
    if (path === null) {
      rest.push({ path: issue.path, message })
      continue
    }
    const field = fields.find(
      candidate =>
        path === candidate.path || path.startsWith(`${candidate.path}.`)
    )
    if (field) {
      fieldErrors[field.path] ??= message
    } else {
      rest.push({ path, message })
    }
  }

  return { fieldErrors, issues: rest }
}

const hasArray = <K extends string>(
  details: unknown,
  key: K
): details is Record<K, unknown[]> =>
  typeof details === 'object' &&
  details !== null &&
  Array.isArray((details as Record<string, unknown>)[key])

const formatTokens = (value: number) =>
  new Intl.NumberFormat('es').format(Math.round(value))

type Copy = Pick<RunErrorView, 'title' | 'description' | 'retryable'>

function copyOf(error: AppError): Copy {
  switch (error.code) {
    case 'LINT_FAILED':
      return {
        title: 'La definición tiene errores',
        description:
          'Corrige los errores de lint antes de probarla. El panel de lint del editor indica dónde está cada uno.',
        retryable: false
      }
    case 'VALIDATION_FAILED':
      return {
        title: 'La entrada no cumple el contrato',
        description: 'Revisa los campos marcados y vuelve a probar.',
        retryable: false
      }
    case 'INPUT_TOO_LARGE': {
      const details = error.details as Partial<InputTooLargeDetails> | undefined
      const size =
        typeof details?.estimatedTokens === 'number' &&
        typeof details.maxContextTokens === 'number'
          ? ` Se estiman ~${formatTokens(details.estimatedTokens)} tokens y el límite es ${formatTokens(details.maxContextTokens)}.`
          : ''
      return {
        title: 'La entrada es demasiado grande para el modelo',
        description: `${size} Envía menos texto o menos campos a Jev.`.trim(),
        retryable: false
      }
    }
    case 'TEMPLATE_INVALID':
      return {
        title: 'Jev rechazó la plantilla',
        description:
          'El evaluador no aceptó las preguntas o el contrato de entrada de esta definición. Revisa las preguntas y los campos.',
        retryable: false
      }
    case 'RATE_LIMITED':
      return {
        title: 'Cuota de evaluaciones agotada',
        description:
          'La organización alcanzó su límite de evaluaciones. Inténtalo de nuevo más tarde.',
        retryable: true
      }
    case 'JEV_UNAVAILABLE':
      return {
        title: 'Jev no está disponible',
        description:
          'El servicio de evaluación no responde en este momento. Reintenta en unos segundos.',
        retryable: true
      }
    case 'JEV_TIMEOUT':
      return {
        title: 'La evaluación tardó demasiado',
        description:
          'Jev no respondió a tiempo. Reintenta; si se repite, prueba con una entrada más corta.',
        retryable: true
      }
    case 'MODEL_UNAVAILABLE':
    case 'VERSION_UNAVAILABLE':
      return {
        title: 'El modelo ya no está disponible',
        description:
          'La versión fija un modelo que el proveedor ya no sirve. Publica una versión nueva con otro modelo.',
        retryable: false
      }
    case 'EVALUATOR_ERROR':
      return {
        title: 'La evaluación falló',
        description:
          'Registramos el error. Reintenta en unos minutos; si persiste, contacta con soporte.',
        retryable: true
      }
    case 'FORBIDDEN':
      return {
        title: 'No tienes permiso',
        description: 'Tu rol no permite esta acción en la organización.',
        retryable: false
      }
    case 'NO_ACTIVE_ORGANIZATION':
    case 'NOT_A_MEMBER':
      return {
        title: 'Sin organización activa',
        description:
          'Elige una organización de la que seas miembro y vuelve a intentarlo.',
        retryable: false
      }
    case 'NOT_FOUND':
    case 'TEMPLATE_NOT_FOUND':
      return {
        title: 'La decisión no existe',
        description:
          'Puede que se haya eliminado o que pertenezca a otra organización.',
        retryable: false
      }
    case 'VERSION_NOT_FOUND':
      return {
        title: 'No hay una versión que coincida',
        description:
          'Ninguna versión publicada de esta decisión coincide con la referencia.',
        retryable: false
      }
    case 'TEMPLATE_ARCHIVED':
      return {
        title: 'La decisión está archivada',
        description: 'Restáurala para poder ejecutarla de nuevo.',
        retryable: false
      }
    case 'INVALID_REF':
      return {
        title: 'Referencia no válida',
        description: 'Usa <slug>, <slug>@<mayor> o <slug>@<mayor>.<menor>.',
        retryable: false
      }
    case 'IDEMPOTENCY_IN_PROGRESS':
      return {
        title: 'La misma petición sigue en curso',
        description: 'Espera unos segundos y vuelve a intentarlo.',
        retryable: true
      }
    case 'IDEMPOTENCY_KEY_REUSED':
      return {
        title: 'Idempotency-Key reutilizada',
        description:
          'Esa clave ya se usó con otra petición. Usa una clave nueva para cada ejecución distinta.',
        retryable: false
      }
  }

  if (error.status === 401) {
    return {
      title: 'Tu sesión expiró',
      description: 'Vuelve a iniciar sesión para continuar.',
      retryable: false
    }
  }
  if (error.status === undefined) {
    return {
      title: 'No se pudo conectar con la API',
      description: 'Comprueba tu conexión e inténtalo de nuevo.',
      retryable: true
    }
  }
  return {
    title: 'No se pudo ejecutar',
    description: 'Ocurrió un error inesperado. Inténtalo de nuevo.',
    retryable: error.status >= 500
  }
}

/** Any error thrown by a run call, as the UI shows it. */
export function describeRunError(
  error: unknown,
  fields: readonly InputField[] = []
): RunErrorView {
  const appError = AppError.fromUnknown(error)
  const view: RunErrorView = {
    code: appError.code,
    ...copyOf(appError),
    lint: [],
    fieldErrors: {},
    issues: [],
    technical: appError.message || null
  }

  if (appError.code === 'LINT_FAILED' && hasArray(appError.details, 'issues')) {
    view.lint = (appError.details as LintFailedDetails).issues
  }
  if (
    appError.code === 'VALIDATION_FAILED' &&
    hasArray(appError.details, 'issues')
  ) {
    const { issues } = appError.details as ValidationFailedDetails
    const mapped = mapValidationIssues(fields, issues)
    view.fieldErrors = mapped.fieldErrors
    view.issues = mapped.issues
    // The playground also validates the editor's definition.
    if (issues.every(issue => inputPathOf(issue.path) === null)) {
      view.title = 'La definición no es válida'
      view.description =
        'La API no acepta el estado actual del editor. Revisa los cambios sin guardar.'
    }
  }

  return view
}
