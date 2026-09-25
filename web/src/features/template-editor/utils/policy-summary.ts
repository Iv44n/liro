import {
  type Comparison,
  type Condition,
  type DecisionRule,
  type DecisionTarget,
  type FlagRule,
  isComparison,
  type Operand,
  type Operator,
  type SignalDef
} from '#/features/templates/types/definition'

/**
 * Renders the DSL's policy sections (preconditions, signals, flag rules,
 * rules, fallback) as a human, Spanish summary for the read-only "Política"
 * tab — e.g. `si \`category.confidence\` ≥ 0.8 → según la respuesta de
 * \`category\``. A visual editor comes in Phase 2; until then the tab also
 * offers a raw JSON editor for these sections.
 */

const OPERAND_JOINER = ', '

function formatLiteral(value: unknown): string {
  if (value === null) return 'nulo'
  if (typeof value === 'string') return `"${value}"`
  return JSON.stringify(value)
}

/** A single operand, e.g. `` `category.confidence` ``, `señal riesgo` or `"activo"`. */
export function describeOperand(operand: Operand): string {
  if ('answer' in operand) {
    return operand.field === 'prob' && operand.option !== undefined
      ? `\`${operand.answer}.prob(${operand.option})\``
      : `\`${operand.answer}.${operand.field}\``
  }
  if ('signal' in operand) return `señal \`${operand.signal}\``
  if ('flag' in operand) return `flag \`${operand.flag}\``
  if ('input' in operand) return `\`${operand.input}\``
  return formatLiteral(operand.value)
}

function asOperandList(right: Comparison['right']): Operand[] {
  if (right === undefined) return []
  return Array.isArray(right) ? right : [right]
}

function describeOperandList(right: Comparison['right']): string {
  return asOperandList(right).map(describeOperand).join(OPERAND_JOINER)
}

const COMPARATOR_SYMBOLS: Partial<Record<Operator, string>> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤'
}

/** One comparison, e.g. `` `score` ≥ 0.8 `` or `` `ticket.tags` contiene "urgente" ``. */
export function describeComparison(comparison: Comparison): string {
  const { op, right } = comparison
  const left = describeOperand(comparison.left)
  const symbol = COMPARATOR_SYMBOLS[op]
  if (symbol) return `${left} ${symbol} ${describeOperandList(right)}`

  switch (op) {
    case 'exists':
      return `${left} existe`
    case 'in':
      return `${left} está en (${describeOperandList(right)})`
    case 'between': {
      const [low, high] = asOperandList(right)
      return `${left} está entre ${low ? describeOperand(low) : '?'} y ${high ? describeOperand(high) : '?'}`
    }
    case 'contains':
      return `${left} contiene ${describeOperandList(right)}`
    case 'len_gt':
      return `la longitud de ${left} > ${describeOperandList(right)}`
    case 'len_lt':
      return `la longitud de ${left} < ${describeOperandList(right)}`
    case 'before':
      return `${left} es anterior a ${describeOperandList(right)}`
    case 'after':
      return `${left} es posterior a ${describeOperandList(right)}`
    case 'days_since_gt':
      return `pasaron más de ${describeOperandList(right)} días desde ${left}`
    case 'days_since_lt':
      return `pasaron menos de ${describeOperandList(right)} días desde ${left}`
    default:
      return left
  }
}

/** Whether `condition` needs parentheses as a child of a combinator. */
function isCompound(condition: Condition): boolean {
  if (isComparison(condition)) return false
  if ('not' in condition) return false
  const list = 'all' in condition ? condition.all : condition.any
  return list.length > 1
}

function describeChild(condition: Condition): string {
  const text = describeCondition(condition)
  return isCompound(condition) ? `(${text})` : text
}

/** A condition tree, e.g. `` `a` ≥ 1 y (`b` = "x" o `c` existe) ``. */
export function describeCondition(condition: Condition): string {
  if (isComparison(condition)) return describeComparison(condition)
  if ('all' in condition) {
    if (condition.all.length === 0) return 'siempre'
    return condition.all.map(describeChild).join(' y ')
  }
  if ('any' in condition) {
    if (condition.any.length === 0) return 'nunca'
    return condition.any.map(describeChild).join(' o ')
  }
  return `no se cumple que ${describeChild(condition.not)}`
}

/** A decision target: a label, or the question a `fromAnswer` decision reads. */
export function describeTarget(target: DecisionTarget): string {
  return typeof target === 'string'
    ? `\`${target}\``
    : `según la respuesta de \`${target.fromAnswer}\``
}

export interface RuleLine {
  id: string
  /** 1-based position: rules and preconditions match in order, first wins. */
  position: number
  text: string
}

function ruleLine(rule: DecisionRule, index: number): RuleLine {
  const named = rule.name ? ` (${rule.name})` : ''
  return {
    id: rule.id,
    position: index + 1,
    text: `si ${describeCondition(rule.when)} → ${describeTarget(rule.decision)}${named}`
  }
}

/** Preconditions or rules, in match order (the first one whose `when` holds wins). */
export const describeRules = (rules: readonly DecisionRule[]): RuleLine[] =>
  rules.map(ruleLine)

function flagRuleLine(rule: FlagRule, index: number): RuleLine {
  const flags = rule.flags.map(flag => `\`${flag}\``).join(OPERAND_JOINER)
  const named = rule.name ? ` (${rule.name})` : ''
  return {
    id: rule.id,
    position: index + 1,
    text: `si ${describeCondition(rule.when)} → añade ${flags}${named}`
  }
}

/** Flag rules: every matching one applies (order only matters for `flag` self-references). */
export const describeFlagRules = (rules: readonly FlagRule[]): RuleLine[] =>
  rules.map(flagRuleLine)

const SIGNAL_VERB: Record<Exclude<SignalDef['kind'], 'weighted'>, string> = {
  min: 'mínimo',
  max: 'máximo',
  mean: 'promedio'
}

/** One signal's definition, e.g. `` `riesgo` = media ponderada de … ``. */
export function describeSignal(signal: SignalDef): string {
  if (signal.kind === 'weighted') {
    const terms = signal.terms
      .map(
        term =>
          `${describeOperand(term.operand)}${term.invert ? ' invertido' : ''} × ${term.weight}`
      )
      .join(' + ')
    return `\`${signal.name}\` = media ponderada de ${terms || '(sin términos)'}`
  }
  const of = signal.of.map(describeOperand).join(OPERAND_JOINER)
  return `\`${signal.name}\` = ${SIGNAL_VERB[signal.kind]} de ${of || '(sin operandos)'}`
}

/** The fallback line: what decides when nothing else matched. */
export const describeFallback = (fallback: { decision: string }): string =>
  `si ninguna regla coincide → \`${fallback.decision}\``
