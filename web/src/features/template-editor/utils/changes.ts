import type {
  ChangeSeverity,
  DefinitionChange
} from '#/features/templates/types/definition'
import { backtickedTokens } from './lint'

/**
 * Definition changes (draft vs latest version) in Spanish, grouped by
 * severity for the publish dialog and the Versiones tab.
 */

export const SEVERITY_TEXTS: Record<
  ChangeSeverity,
  { title: string; description: string }
> = {
  breaking: {
    title: 'Incompatibles',
    description:
      'Pueden romper a quien ya llama a esta decisión (etiquetas nuevas o eliminadas, entrada más estricta). Exigen una versión mayor.'
  },
  behavior: {
    title: 'De comportamiento',
    description:
      'El contrato no cambia, pero las decisiones pueden ser distintas (preguntas, política, modelo, lo que ve Jev).'
  },
  compatible: {
    title: 'Compatibles',
    description: 'Entrada más flexible o solo documentación.'
  }
}

const code = (value: string | undefined) => `\`${value ?? '?'}\``

/** What a change's path names: `decisions.bug` → `bug`, `input.fields.ticket.message` → `ticket.message`. */
function target(change: DefinitionChange): string {
  const path = change.path ?? ''
  for (const prefix of ['decisions.', 'input.fields.', 'questions.']) {
    if (path.startsWith(prefix)) return path.slice(prefix.length)
  }
  const [section, ...rest] = path.split('.')
  if (
    rest.length > 0 &&
    ['rules', 'preconditions', 'flagRules'].includes(section ?? '')
  ) {
    return rest.join('.')
  }
  return path
}

const POLICY_SECTIONS: Record<string, string> = {
  preconditions: 'Precondiciones',
  signals: 'Señales',
  flagRules: 'Reglas de marcas',
  rules: 'Reglas',
  fallback: 'Decisión por defecto'
}

/** `Rules: added `a`; removed `b`; changed `c`; reordered` → Spanish. */
function sectionDetails(message: string): string {
  const details = message.split(': ').slice(1).join(': ')
  if (!details || details === 'changed') return 'modificadas'
  return details
    .split('; ')
    .map(part =>
      part
        .replace(/^added /, 'añadidas ')
        .replace(/^removed /, 'eliminadas ')
        .replace(/^changed /, 'modificadas ')
        .replace(/^reordered$/, 'reordenadas')
    )
    .join('; ')
}

export function describeChange(change: DefinitionChange): string {
  const name = target(change)
  const tokens = backtickedTokens(change.message)
  switch (change.code) {
    case 'LABEL_ADDED':
      return `Etiqueta nueva ${code(name)}`
    case 'LABEL_REMOVED':
      return `Etiqueta eliminada ${code(name)}`
    case 'REQUIRED_FIELD_ADDED':
      return `Campo obligatorio nuevo ${code(name)}`
    case 'OPTIONAL_FIELD_ADDED':
      return `Campo opcional nuevo ${code(name)}`
    case 'FIELD_REMOVED':
      return `Campo eliminado ${code(name)}`
    case 'FIELD_TYPE_CHANGED': {
      const match = /from (\w+) to (\w+)/.exec(change.message)
      return match
        ? `El campo ${code(name)} cambió de tipo (${match[1]} → ${match[2]})`
        : `El campo ${code(name)} cambió de tipo`
    }
    case 'FIELD_MADE_REQUIRED':
      return `El campo ${code(name)} ahora es obligatorio`
    case 'FIELD_MADE_OPTIONAL':
      return `El campo ${code(name)} ahora es opcional`
    case 'ENUM_VALUE_REMOVED':
      return `El campo ${code(name)} ya no acepta ${tokens.slice(1).map(code).join(', ')}`
    case 'ENUM_VALUE_ADDED':
      return `El campo ${code(name)} ahora también acepta ${tokens.slice(1).map(code).join(', ')}`
    case 'FIELD_CONSTRAINT_TIGHTENED':
      return `Longitud máxima más estricta en ${code(name)}`
    case 'FIELD_CONSTRAINT_RELAXED':
      return `Longitud máxima más flexible en ${code(name)}`
    case 'MODEL_CHANGED':
      return 'Cambió el modelo'
    case 'QUESTIONS_CHANGED':
      if (/ removed$/.test(change.message)) {
        return `Pregunta eliminada ${code(name)}`
      }
      if (/ added$/.test(change.message)) return `Pregunta nueva ${code(name)}`
      return `Pregunta modificada ${code(name)}`
    case 'POLICY_CHANGED': {
      const path = change.path ?? ''
      if (path.startsWith('decisions.')) {
        return `Umbral o revisión de la etiqueta ${code(name)}`
      }
      if (path === 'fallback') {
        const [from, to] = tokens
        return `Decisión por defecto: ${code(from)} → ${code(to)}`
      }
      const section = POLICY_SECTIONS[path] ?? 'Política'
      return `${section}: ${sectionDetails(change.message)}`
    }
    case 'STATE_CHANGED':
      return change.path === 'state.context'
        ? 'Cambió el contexto estático que se envía a Jev'
        : 'Cambiaron los campos que se envían a Jev'
    case 'DESCRIPTION_CHANGED':
      return /^Name of /.test(change.message)
        ? `Cambió el nombre de ${code(name)}`
        : /^Note of /.test(change.message)
          ? `Cambió la nota de ${code(name)}`
          : `Cambió la descripción de ${code(name)}`
    default:
      return change.message
  }
}

export type GroupedChanges = Record<ChangeSeverity, DefinitionChange[]>

export function groupChanges(
  changes: readonly DefinitionChange[]
): GroupedChanges {
  const groups: GroupedChanges = { breaking: [], behavior: [], compatible: [] }
  for (const change of changes) groups[change.severity].push(change)
  return groups
}
