import type {
  LintIssue,
  LintSeverity
} from '#/features/templates/types/definition'
import type { EditorTab } from '#/features/templates/types/editor'

/**
 * Lint issues as the editor shows them: in Spanish, and pointing at the tab
 * that edits the offending part of the definition. The API's messages are
 * English; each known code gets a Spanish sentence built from the names the
 * message quotes in backticks (falling back to the API's text).
 */

/** The editor tab that edits `path` (a dotted definition path); `null` for the whole definition. */
export function tabForPath(path: string): EditorTab | null {
  const [section] = path.split('.')
  switch (section) {
    case 'input':
    case 'state':
      return 'input'
    case 'questions':
      return 'questions'
    case 'decisions':
      return 'decisions'
    case 'preconditions':
    case 'signals':
    case 'flagRules':
    case 'rules':
    case 'fallback':
      return 'policy'
    default:
      return null
  }
}

/** Tokens the message quotes in backticks, in order. */
export const backtickedTokens = (message: string): string[] =>
  [...message.matchAll(/`([^`]+)`/g)].map(match => match[1] ?? '')

const code = (value: string | undefined) => `\`${value ?? '?'}\``
const codes = (values: readonly string[]) => values.map(code).join(', ')

const SECTION_NOUNS: Record<string, string> = {
  'input.fields': 'campos de entrada',
  questions: 'preguntas',
  decisions: 'decisiones',
  preconditions: 'precondiciones',
  rules: 'reglas',
  flagRules: 'reglas de marcas',
  signals: 'señales'
}

function tooManyText(issue: LintIssue): string | null {
  const match = /^(\d+) .*; the limit is (\d+)$/.exec(issue.message)
  if (!match) return null
  const [, count, max] = match
  const noun = /^signals\.\d+\.(terms|of)$/.test(issue.path)
    ? 'términos en la señal'
    : (SECTION_NOUNS[issue.path] ?? 'elementos')
  return `Hay ${count} ${noun}; el máximo es ${max}.`
}

interface LintText {
  title: string
  /** Builds the Spanish explanation; `null` falls back to the API message. */
  detail?: (tokens: string[], issue: LintIssue) => string | null
}

const LINT_TEXTS: Record<string, LintText> = {
  NO_DECISIONS: {
    title: 'Sin decisiones',
    detail: () => 'Declara al menos una etiqueta de decisión.'
  },
  DUPLICATE_LABEL: {
    title: 'Etiqueta repetida',
    detail: ([label]) =>
      `La etiqueta ${code(label)} está declarada más de una vez.`
  },
  RESERVED_LABEL: {
    title: 'Etiqueta reservada',
    detail: () =>
      '`needs_review` es interna (envía la ejecución a revisión humana) y no se puede declarar.'
  },
  UNKNOWN_LABEL: {
    title: 'Decisión desconocida',
    detail: ([label]) => `${code(label)} no es una decisión declarada.`
  },
  FROM_ANSWER_UNKNOWN_QUESTION: {
    title: 'Pregunta desconocida',
    detail: ([id]) =>
      `La regla decide según la respuesta de ${code(id)}, pero esa pregunta no existe.`
  },
  FROM_ANSWER_BOOLEAN: {
    title: 'No se puede decidir según una pregunta sí/no',
    detail: ([id]) =>
      `${code(id)} es una pregunta sí/no y no tiene una etiqueta que decidir: escribe reglas sobre su \`probability\`.`
  },
  FROM_ANSWER_LABEL_MISSING: {
    title: 'Respuestas sin decisión',
    detail: ([id, ...missing]) =>
      `${code(id)} puede responder ${codes(missing)}, que no ${missing.length === 1 ? 'está declarada como decisión' : 'están declaradas como decisiones'}.`
  },
  FROM_ANSWER_IN_PRECONDITION: {
    title: 'Precondición con respuesta de Jev',
    detail: () =>
      'Las precondiciones se evalúan antes de llamar a Jev, así que no pueden decidir según una respuesta (`fromAnswer`).'
  },
  CONFIDENCE_FROM_UNKNOWN_QUESTION: {
    title: 'Pregunta desconocida',
    detail: ([id]) =>
      `La confianza se toma de ${code(id)}, pero esa pregunta no existe.`
  },
  INPUT_ONLY_OPERAND: {
    title: 'Solo se puede usar la entrada',
    detail: () =>
      'Esta condición se evalúa antes de llamar a Jev: usa solo operandos `input` y `value`.'
  },
  UNKNOWN_QUESTION: {
    title: 'Pregunta desconocida',
    detail: ([id]) => `No existe la pregunta ${code(id)}.`
  },
  UNKNOWN_SIGNAL: {
    title: 'Señal desconocida',
    detail: ([name]) => `No existe la señal ${code(name)}.`
  },
  SIGNAL_FORWARD_REFERENCE: {
    title: 'Señal aún no calculada',
    detail: ([name]) =>
      `La señal ${code(name)} todavía no está calculada aquí: una señal solo ve las definidas antes que ella.`
  },
  UNKNOWN_FLAG: {
    title: 'Marca desconocida',
    detail: ([flag]) => `Ninguna regla de marcas activa ${code(flag)}.`
  },
  FLAG_IN_FLAG_RULE: {
    title: 'Marca aún no activada',
    detail: ([flag]) =>
      `La marca ${code(flag)} solo la activa esta regla o una posterior, así que aquí siempre es falsa.`
  },
  UNKNOWN_INPUT_PATH: {
    title: 'Campo de entrada desconocido',
    detail: ([path]) => `${code(path)} no es un campo de entrada declarado.`
  },
  STATE_INCLUDE_UNKNOWN: {
    title: 'Se envía un campo que no existe',
    detail: ([path]) => `${code(path)} no es un campo de entrada declarado.`
  },
  STATE_CONTEXT_COLLISION: {
    title: 'El contexto pisa la entrada',
    detail: ([key]) =>
      `La clave de contexto ${code(key)} reemplazaría el campo ${code(key)} de la entrada en lo que se envía a Jev.`
  },
  DUPLICATE_FIELD: {
    title: 'Campo repetido',
    detail: ([path]) => `El campo ${code(path)} está declarado más de una vez.`
  },
  OVERLAPPING_FIELDS: {
    title: 'Campos superpuestos',
    detail: ([parent, child]) =>
      `${code(parent)} es un campo y a la vez el padre de ${code(child)}: declara el objeto o sus campos, no ambos.`
  },
  ANSWER_FIELD_MISMATCH: {
    title: 'Dato de respuesta no disponible',
    detail: ([field, ...valid]) =>
      `Este tipo de pregunta no tiene ${code(field)}${valid.length > 0 ? ` (usa ${codes(valid)})` : ''}.`
  },
  UNKNOWN_OPTION: { title: 'Opción desconocida' },
  OPERATOR_TYPE: { title: 'Operador incompatible con el tipo' },
  CHOICE_OPTIONS: {
    title: 'Número de opciones',
    detail: ([id]) => `${code(id)} necesita de 2 a 255 opciones.`
  },
  SCORE_LEVELS: {
    title: 'Número de niveles',
    detail: ([id]) => `${code(id)} necesita de 2 a 10 niveles.`
  },
  DUPLICATE_LEVEL: {
    title: 'Nivel repetido',
    detail: ([level, id]) =>
      `El nivel ${code(level)} aparece más de una vez en ${code(id)}.`
  },
  DUPLICATE_RULE_ID: {
    title: 'Id de regla repetido',
    detail: ([id]) =>
      `El id ${code(id)} ya está en uso; los ids son únicos entre precondiciones, reglas y reglas de marcas.`
  },
  DUPLICATE_SIGNAL: {
    title: 'Señal repetida',
    detail: ([name]) => `La señal ${code(name)} está definida más de una vez.`
  },
  CONDITION_TOO_DEEP: {
    title: 'Condición demasiado anidada',
    detail: () => 'Las condiciones admiten como máximo 8 niveles de anidación.'
  },
  DEFINITION_TOO_LARGE: {
    title: 'Definición demasiado grande',
    detail: () => 'La definición supera el límite de 256 KiB.'
  },
  TOO_MANY: {
    title: 'Límite superado',
    detail: (_, issue) => tooManyText(issue)
  },
  INSTRUCTION_UNKNOWN_PATH: {
    title: 'Referencia desconocida en las instrucciones',
    detail: ([token]) =>
      `${code(token)} no es un campo de entrada declarado ni una clave del contexto.`
  },
  UNUSED_QUESTION: {
    title: 'Pregunta sin usar',
    detail: ([id]) =>
      `Ninguna regla lee ${code(id)}, pero se pregunta en cada ejecución.`
  },
  NUMERIC_LEVELS: {
    title: 'Niveles sin criterio',
    detail: tokens =>
      `Hay niveles de ${code(tokens.at(-1))} que son solo números sin criterio; Jev puntúa mejor si cada nivel dice qué significa.`
  },
  UNREACHABLE_RULE: {
    title: 'Regla inalcanzable',
    detail: ([id, winner]) =>
      `${code(id)} nunca se ejecuta: ${code(winner)} siempre coincide antes.`
  },
  CONFIDENCE_SOURCE_MISSING: {
    title: 'Sin confianza disponible',
    detail: (_, issue) => {
      const match = /but `([^`]+)` needs ([\d.]+)/.exec(issue.message)
      if (!match) return null
      return `${code(match[1])} exige una confianza de ${match[2]}, pero aquí no hay de dónde obtenerla: siempre irá a revisión.`
    }
  },
  PII_IN_POLICY: {
    title: 'Dato personal en la política',
    detail: ([path, reader]) =>
      `${code(path)} es un dato personal, pero la política lee ${code(reader)}, así que se guarda en el policyInput de cada ejecución.`
  },
  ALWAYS_REVIEW: {
    title: 'Todo va a revisión',
    detail: () =>
      'Ninguna regla ni precondición puede decidir y la decisión por defecto es `needs_review`: todas las ejecuciones irán a revisión humana.'
  },
  TOKEN_BUDGET: {
    title: 'Cerca del límite de tokens',
    detail: (_, issue) => {
      const match = /~(\d+) tokens \((\d+)% of the (\d+)-token limit\)/.exec(
        issue.message
      )
      if (!match) return null
      return `El contexto estático y la pregunta más larga ocupan ~${match[1]} tokens (${match[2]} % del límite de ${match[3]}) antes de añadir la entrada.`
    }
  }
}

export interface DescribedIssue {
  title: string
  /** Spanish when the code is known; the API's (English) message otherwise. */
  detail: string
  /** `detail` is the API's own message. */
  untranslated: boolean
}

export function describeLintIssue(issue: LintIssue): DescribedIssue {
  const text = LINT_TEXTS[issue.code]
  const detail = text?.detail?.(backtickedTokens(issue.message), issue) ?? null
  return {
    title:
      text?.title ??
      (issue.severity === 'error' ? 'Error en la definición' : 'Advertencia'),
    detail: detail ?? issue.message,
    untranslated: detail === null
  }
}

export const SEVERITY_LABELS: Record<LintSeverity, string> = {
  error: 'Error',
  warning: 'Advertencia'
}

/** Issues per tab (`null` = the whole definition), errors and warnings apart. */
export function issueCountsByTab(
  issues: readonly { severity: LintSeverity; path: string }[]
): Partial<Record<EditorTab, { errors: number; warnings: number }>> {
  const counts: Partial<
    Record<EditorTab, { errors: number; warnings: number }>
  > = {}
  for (const issue of issues) {
    const tab = tabForPath(issue.path)
    if (!tab) continue
    const entry = counts[tab] ?? { errors: 0, warnings: 0 }
    if (issue.severity === 'error') entry.errors++
    else entry.warnings++
    counts[tab] = entry
  }
  return counts
}

/** A path for people: `questions.category.instructions` → `questions › category › instructions`. */
export const formatIssuePath = (path: string): string =>
  path === '' ? 'Definición completa' : path.split('.').join(' › ')
