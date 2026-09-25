import {
  ANSWER_FIELDS,
  type AnswerField,
  type InputField,
  type InputFieldType,
  type JsonValue,
  OPERATORS,
  type Operand,
  type Operator,
  type QuestionDef,
  type QuestionType,
  type TemplateDefinition
} from '#/features/templates/types/definition'

/**
 * What kind of thing an operand reads, and what its value looks like — a
 * lightweight mirror of the API lint's `operandType`/`isNumeric`/`isDate`/
 * `hasLength` (`api/src/modules/templates/lint.ts`), just enough to drive
 * the visual policy editor's pickers (which operators make sense, which
 * options a literal can take…). The API lint stays the source of truth for
 * whether a condition is actually valid; a picker that's slightly generous
 * just means the live lint catches the rest.
 */

export type OperandKind = 'answer' | 'signal' | 'flag' | 'input' | 'value'

/** The operand kinds available in `context`: preconditions and a question's
 * `when` only see the input (they run before Jev is called). */
export type OperandContext = 'input-only' | 'full'

export const OPERAND_KINDS_BY_CONTEXT: Record<
  OperandContext,
  readonly OperandKind[]
> = {
  'input-only': ['input', 'value'],
  full: ['answer', 'signal', 'flag', 'input', 'value']
}

export function operandKind(operand: Operand): OperandKind {
  if ('answer' in operand) return 'answer'
  if ('signal' in operand) return 'signal'
  if ('flag' in operand) return 'flag'
  if ('input' in operand) return 'input'
  return 'value'
}

const ANSWER_FIELDS_BY_QUESTION_TYPE: Record<
  QuestionType,
  readonly AnswerField[]
> = {
  choice: ['choice', 'confidence', 'prob'],
  score: ['level', 'score', 'score_norm', 'confidence', 'prob'],
  boolean: ['probability', 'confidence']
}

/** `AnswerField`s that make sense for a question of `type`, in picker order. */
export const answerFieldsFor = (type: QuestionType): readonly AnswerField[] =>
  ANSWER_FIELDS_BY_QUESTION_TYPE[type]

/** Every `AnswerField`, for when there's no question yet to narrow the list. */
export const ALL_ANSWER_FIELDS: readonly AnswerField[] = ANSWER_FIELDS

/** The option labels of a Choice/Score question, in declared order. */
export function optionsOf(question: QuestionDef): string[] {
  if (question.type === 'choice') return Object.keys(question.criteria)
  if (question.type === 'score')
    return question.levels.map(level => level.label)
  return []
}

export type JsonKind =
  | 'number'
  | 'string'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null'

export interface OperandTypeInfo {
  json?: JsonKind
  /** Probabilities, confidences, scores and signals: continuous numbers. */
  continuous?: boolean
  /** The values a `choice`/`level` answer can take. */
  options?: readonly string[]
  /** Accepted by the date operators (`before`/`after`/`days_since_*`). */
  date?: boolean
}

const FIELD_TYPES: Record<InputFieldType, OperandTypeInfo> = {
  string: { json: 'string' },
  enum: { json: 'string' },
  datetime: { json: 'string', date: true },
  number: { json: 'number', date: true },
  integer: { json: 'number', date: true },
  boolean: { json: 'boolean' },
  array: { json: 'array' },
  object: { json: 'object' }
}

const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

/** Whether a literal `value` reads as a date (ISO string or a finite number). */
const literalIsDate = (value: JsonValue): boolean =>
  (typeof value === 'string' && ISO_DATE.test(value)) ||
  (typeof value === 'number' && Number.isFinite(value))

function jsonKindOf(value: JsonValue): JsonKind {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value as 'number' | 'string' | 'boolean' | 'object'
}

/** What is statically known about `operand`'s value, given `definition`. */
export function operandType(
  definition: TemplateDefinition,
  operand: Operand
): OperandTypeInfo {
  if ('answer' in operand) {
    const question = definition.questions[operand.answer]
    if (!question || !answerFieldsFor(question.type).includes(operand.field)) {
      return {}
    }
    return operand.field === 'choice' || operand.field === 'level'
      ? { json: 'string', options: optionsOf(question) }
      : { json: 'number', continuous: true }
  }
  if ('signal' in operand) return { json: 'number', continuous: true }
  if ('flag' in operand) return { json: 'boolean' }
  if ('input' in operand) {
    const field = definition.input.fields.find(f => f.path === operand.input)
    return field ? FIELD_TYPES[field.type] : {}
  }
  const { value } = operand
  return { json: jsonKindOf(value), date: literalIsDate(value) }
}

const isNumeric = (type: OperandTypeInfo) =>
  type.json === undefined || type.json === 'number'
const isDateType = (type: OperandTypeInfo) =>
  type.json === undefined || type.date === true
const hasLength = (type: OperandTypeInfo) =>
  type.json === undefined || type.json === 'string' || type.json === 'array'

/**
 * The operators that make sense for `type` (mirrors the API lint's numeric/
 * date/length gates): `eq`/`neq`/`in`/`exists` always apply, the rest only
 * when the type allows them. An operand of unknown type (`{}`) allows
 * everything — the picker doesn't yet know enough to narrow it.
 */
export function operatorsFor(type: OperandTypeInfo): Operator[] {
  const allow = new Set<Operator>(['eq', 'neq', 'in', 'exists'])
  if (isNumeric(type)) {
    for (const op of ['gt', 'gte', 'lt', 'lte', 'between'] as const)
      allow.add(op)
  }
  if (hasLength(type)) {
    for (const op of ['contains', 'len_gt', 'len_lt'] as const) allow.add(op)
  }
  if (isDateType(type)) {
    for (const op of [
      'before',
      'after',
      'days_since_gt',
      'days_since_lt'
    ] as const) {
      allow.add(op)
    }
  }
  return OPERATORS.filter(op => allow.has(op))
}

/** Whether `op` takes no right-hand operand. */
export const isUnary = (op: Operator): boolean => op === 'exists'
/** Whether `op` takes a list of right-hand operands (not just one). */
export const isVariadic = (op: Operator): boolean =>
  op === 'in' || op === 'between'

// ── Path / name collection ──────────────────────────────────────────────

/** Declared input paths, in declaration order. */
export const inputPaths = (definition: TemplateDefinition): string[] =>
  definition.input.fields.map((field: InputField) => field.path)

/** Declared question ids, in declaration order. */
export const questionIds = (definition: TemplateDefinition): string[] =>
  Object.keys(definition.questions)

/** Declared signal names, in declaration order. */
export const signalNames = (definition: TemplateDefinition): string[] =>
  definition.signals.map(signal => signal.name)

/** Every flag any flag rule raises, in first-seen order (flags have no separate declaration). */
export function flagNames(definition: TemplateDefinition): string[] {
  const seen = new Set<string>()
  for (const rule of definition.flagRules) {
    for (const flag of rule.flags) seen.add(flag)
  }
  return [...seen]
}
