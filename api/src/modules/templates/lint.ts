import type { JsonValue } from '#modules/engine/evaluator/port'
import { evaluateCondition, type PolicyScope } from '#modules/engine/policy'
import { toCanonicalQuestion } from '#modules/engine/questions'
import { checkTokenBudget, estimateRequestTokens } from '#modules/engine/tokens'
import {
  type AnswerField,
  type Comparison,
  type Condition,
  conditionDepth,
  DEFINITION_LIMITS,
  type DecisionRule,
  type DslPath,
  type DslSection,
  definitionOperands,
  type InputField,
  type InputFieldType,
  NEEDS_REVIEW,
  type Operand,
  policyInputPaths,
  type QuestionDef,
  type QuestionType,
  type TemplateDefinition,
  walkComparisons
} from './definition'
import { getPath, isPathPrefix } from './paths'

/**
 * Semantic checks on a template definition. The zod schema only guarantees
 * structure, so a draft can be saved half-written; publishing requires no
 * lint *errors*. Warnings flag definitions that work but probably don't do
 * what the author meant (a question nothing reads, a rule that can never run,
 * a label that always ends in review…).
 */

export type LintSeverity = 'error' | 'warning'

export interface LintIssue {
  severity: LintSeverity
  code: string
  message: string
  /** Dotted path into the definition, e.g. `rules.0.when.left`; `''` for the whole definition. */
  path: string
}

export interface LintOptions {
  /** The provider's context limit; enables the `TOKEN_BUDGET` warning. */
  maxContextTokens?: number
}

type ErrorCode =
  | 'NO_DECISIONS'
  | 'DUPLICATE_LABEL'
  | 'RESERVED_LABEL'
  | 'UNKNOWN_LABEL'
  | 'FROM_ANSWER_UNKNOWN_QUESTION'
  | 'FROM_ANSWER_BOOLEAN'
  | 'FROM_ANSWER_LABEL_MISSING'
  | 'FROM_ANSWER_IN_PRECONDITION'
  | 'CONFIDENCE_FROM_UNKNOWN_QUESTION'
  | 'INPUT_ONLY_OPERAND'
  | 'UNKNOWN_QUESTION'
  | 'UNKNOWN_SIGNAL'
  | 'SIGNAL_FORWARD_REFERENCE'
  | 'UNKNOWN_FLAG'
  | 'FLAG_IN_FLAG_RULE'
  | 'UNKNOWN_INPUT_PATH'
  | 'STATE_INCLUDE_UNKNOWN'
  | 'STATE_CONTEXT_COLLISION'
  | 'DUPLICATE_FIELD'
  | 'OVERLAPPING_FIELDS'
  | 'ANSWER_FIELD_MISMATCH'
  | 'UNKNOWN_OPTION'
  | 'OPERATOR_TYPE'
  | 'CHOICE_OPTIONS'
  | 'SCORE_LEVELS'
  | 'DUPLICATE_LEVEL'
  | 'DUPLICATE_RULE_ID'
  | 'DUPLICATE_SIGNAL'
  | 'CONDITION_TOO_DEEP'
  | 'DEFINITION_TOO_LARGE'
  | 'TOO_MANY'
  | 'INSTRUCTION_UNKNOWN_PATH'

type WarningCode =
  | 'UNUSED_QUESTION'
  | 'NUMERIC_LEVELS'
  | 'UNREACHABLE_RULE'
  | 'CONFIDENCE_SOURCE_MISSING'
  | 'PII_IN_POLICY'
  | 'ALWAYS_REVIEW'
  | 'TOKEN_BUDGET'

/**
 * Every issue of `definition`, errors first (each group in definition
 * order). Deterministic, so the editor can diff two lint runs.
 */
export function lintDefinition(
  definition: TemplateDefinition,
  options: LintOptions = {}
): LintIssue[] {
  const lint = createLint(definition)

  lintSize(lint)
  lintDecisions(lint)
  lintFields(lint)
  lintState(lint)
  lintQuestions(lint)
  lintRuleIds(lint)
  lintSignals(lint)
  lintConditions(lint)
  lintOperands(lint)
  lintDecisionTargets(lint)
  lintInstructions(lint)
  lintUnusedQuestions(lint)
  lintUnreachableRules(lint, 'preconditions')
  lintUnreachableRules(lint, 'rules')
  lintPii(lint)
  lintAlwaysReview(lint)
  if (options.maxContextTokens !== undefined) {
    lintTokenBudget(lint, options.maxContextTokens)
  }

  // `sort` is stable: each severity keeps the order issues were found in.
  return lint.issues.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity]
  )
}

/** Whether the issues block publishing. */
export function hasLintErrors(issues: readonly LintIssue[]): boolean {
  return issues.some(issue => issue.severity === 'error')
}

const severityRank: Record<LintSeverity, number> = { error: 0, warning: 1 }

// ── Context ──────────────────────────────────────────────────────────────

interface Lint {
  definition: TemplateDefinition
  issues: LintIssue[]
  labels: ReadonlySet<string>
  /** Declared field path → its (first) declaration. */
  fields: ReadonlyMap<string, InputField>
  /** Implied parent path (`ticket` of `ticket.message`) → its first descendant field. */
  parents: ReadonlyMap<string, string>
  /** Signal name → index of its first definition. */
  signals: ReadonlyMap<string, number>
  /** Flag → index of the first flag rule that raises it. */
  flags: ReadonlyMap<string, number>
}

function createLint(definition: TemplateDefinition): Lint {
  const fields = new Map<string, InputField>()
  const parents = new Map<string, string>()
  for (const field of definition.input.fields) {
    if (!fields.has(field.path)) fields.set(field.path, field)
    const segments = field.path.split('.')
    for (let end = 1; end < segments.length; end++) {
      const parent = segments.slice(0, end).join('.')
      if (!parents.has(parent)) parents.set(parent, field.path)
    }
  }

  const signals = new Map<string, number>()
  for (const [index, signal] of definition.signals.entries()) {
    if (!signals.has(signal.name)) signals.set(signal.name, index)
  }

  const flags = new Map<string, number>()
  for (const [index, rule] of definition.flagRules.entries()) {
    for (const flag of rule.flags) if (!flags.has(flag)) flags.set(flag, index)
  }

  return {
    definition,
    issues: [],
    labels: new Set(definition.decisions.map(decision => decision.label)),
    fields,
    parents,
    signals,
    flags
  }
}

function error(lint: Lint, code: ErrorCode, path: DslPath, message: string) {
  lint.issues.push({ severity: 'error', code, message, path: path.join('.') })
}

function warn(lint: Lint, code: WarningCode, path: DslPath, message: string) {
  lint.issues.push({ severity: 'warning', code, message, path: path.join('.') })
}

function tooMany(
  lint: Lint,
  count: number,
  max: number,
  path: DslPath,
  what: string
) {
  if (count > max) {
    error(lint, 'TOO_MANY', path, `${count} ${what}; the limit is ${max}`)
  }
}

/** A declared field path, or one of the objects its path implies. */
const isDeclaredPath = (lint: Lint, path: string) =>
  lint.fields.has(path) || lint.parents.has(path)

const questionOf = (lint: Lint, id: string): QuestionDef | undefined =>
  Object.hasOwn(lint.definition.questions, id)
    ? lint.definition.questions[id]
    : undefined

/** Choice option names / Score level labels (a boolean has none). */
function optionsOf(question: QuestionDef): string[] {
  if (question.type === 'choice') return Object.keys(question.criteria)
  if (question.type === 'score') return question.levels.map(l => l.label)
  return []
}

const quoted = (items: readonly string[]) =>
  items.map(item => `\`${item}\``).join(', ')

const rootOf = (path: string) => path.split('.', 1)[0] ?? path

// ── Structure and limits ─────────────────────────────────────────────────

function lintSize(lint: Lint) {
  const bytes = new TextEncoder().encode(
    JSON.stringify(lint.definition)
  ).byteLength
  if (bytes > DEFINITION_LIMITS.bytes) {
    error(
      lint,
      'DEFINITION_TOO_LARGE',
      [],
      `The definition takes ${Math.ceil(bytes / 1024)} KiB; the limit is ${DEFINITION_LIMITS.bytes / 1024} KiB`
    )
  }
}

function lintDecisions(lint: Lint) {
  const { decisions } = lint.definition
  if (decisions.length === 0) {
    error(
      lint,
      'NO_DECISIONS',
      ['decisions'],
      'Declare at least one decision label'
    )
  }
  tooMany(
    lint,
    decisions.length,
    DEFINITION_LIMITS.decisions,
    ['decisions'],
    'decisions'
  )

  const seen = new Set<string>()
  for (const [index, { label }] of decisions.entries()) {
    const path = ['decisions', index, 'label']
    if (label === NEEDS_REVIEW) {
      error(
        lint,
        'RESERVED_LABEL',
        path,
        '`needs_review` is built in (it sends a run to human review) and cannot be declared'
      )
    } else if (seen.has(label)) {
      error(
        lint,
        'DUPLICATE_LABEL',
        path,
        `Label \`${label}\` is declared more than once`
      )
    }
    seen.add(label)
  }
}

function lintFields(lint: Lint) {
  const { fields } = lint.definition.input
  tooMany(
    lint,
    fields.length,
    DEFINITION_LIMITS.fields,
    ['input', 'fields'],
    'input fields'
  )

  const seen = new Set<string>()
  for (const [index, field] of fields.entries()) {
    const path = ['input', 'fields', index, 'path']
    if (seen.has(field.path)) {
      error(
        lint,
        'DUPLICATE_FIELD',
        path,
        `Field \`${field.path}\` is declared more than once`
      )
      continue
    }
    seen.add(field.path)
    const child = lint.parents.get(field.path)
    if (child !== undefined) {
      error(
        lint,
        'OVERLAPPING_FIELDS',
        path,
        `\`${field.path}\` is a field and also the parent of \`${child}\`: declare either the object or its fields`
      )
    }
  }
}

function lintState(lint: Lint) {
  const { include, context } = lint.definition.state
  for (const [index, path] of (include ?? []).entries()) {
    if (!isDeclaredPath(lint, path)) {
      error(
        lint,
        'STATE_INCLUDE_UNKNOWN',
        ['state', 'include', index],
        `\`${path}\` is not a declared input field`
      )
    }
  }
  if (!context) return

  const sentRoots = new Set((include ?? [...lint.fields.keys()]).map(rootOf))
  for (const key of Object.keys(context)) {
    if (sentRoots.has(key)) {
      error(
        lint,
        'STATE_CONTEXT_COLLISION',
        ['state', 'context', key],
        `Context key \`${key}\` would replace the input's \`${key}\` in the state sent to Jev`
      )
    }
  }
}

type ScoreLevels = Extract<QuestionDef, { type: 'score' }>['levels']

function lintQuestions(lint: Lint) {
  const entries = Object.entries(lint.definition.questions)
  tooMany(
    lint,
    entries.length,
    DEFINITION_LIMITS.questions,
    ['questions'],
    'questions'
  )

  for (const [id, question] of entries) {
    if (question.type === 'choice') {
      const count = Object.keys(question.criteria).length
      const { min, max } = DEFINITION_LIMITS.choiceOptions
      if (count < min || count > max) {
        error(
          lint,
          'CHOICE_OPTIONS',
          ['questions', id, 'criteria'],
          `A choice needs ${min} to ${max} options (\`${id}\` has ${count})`
        )
      }
    } else if (question.type === 'score') {
      lintLevels(lint, id, question.levels)
    }
  }
}

function lintLevels(lint: Lint, id: string, levels: ScoreLevels) {
  const { min, max } = DEFINITION_LIMITS.scoreLevels
  if (levels.length < min || levels.length > max) {
    error(
      lint,
      'SCORE_LEVELS',
      ['questions', id, 'levels'],
      `A score needs ${min} to ${max} levels (\`${id}\` has ${levels.length})`
    )
  }

  const seen = new Set<string>()
  for (const [index, { label }] of levels.entries()) {
    if (seen.has(label)) {
      error(
        lint,
        'DUPLICATE_LEVEL',
        ['questions', id, 'levels', index, 'label'],
        `Level \`${label}\` appears more than once in \`${id}\``
      )
    }
    seen.add(label)
  }

  const numeric = levels
    .filter(level => /^\d+$/.test(level.label) && level.criteria === null)
    .map(level => level.label)
  if (numeric.length > 0) {
    warn(
      lint,
      'NUMERIC_LEVELS',
      ['questions', id, 'levels'],
      `Levels ${quoted(numeric)} of \`${id}\` are bare numbers without criteria; Jev scores better when every level says what it means`
    )
  }
}

function lintRuleIds(lint: Lint) {
  const { preconditions, rules, flagRules } = lint.definition
  const sections: [DslSection, readonly { id: string }[], string][] = [
    ['preconditions', preconditions, 'preconditions'],
    ['rules', rules, 'rules'],
    ['flagRules', flagRules, 'flag rules']
  ]

  const seen = new Set<string>()
  for (const [section, list, what] of sections) {
    tooMany(lint, list.length, DEFINITION_LIMITS.rules, [section], what)
    for (const [index, { id }] of list.entries()) {
      if (seen.has(id)) {
        error(
          lint,
          'DUPLICATE_RULE_ID',
          [section, index, 'id'],
          `Id \`${id}\` is already used; ids are unique across preconditions, rules and flag rules`
        )
      }
      seen.add(id)
    }
  }
}

function lintSignals(lint: Lint) {
  const { signals } = lint.definition
  tooMany(
    lint,
    signals.length,
    DEFINITION_LIMITS.signals,
    ['signals'],
    'signals'
  )

  for (const [index, signal] of signals.entries()) {
    if (lint.signals.get(signal.name) !== index) {
      error(
        lint,
        'DUPLICATE_SIGNAL',
        ['signals', index, 'name'],
        `Signal \`${signal.name}\` is defined more than once`
      )
    }
    const [key, count] =
      signal.kind === 'weighted'
        ? ['terms', signal.terms.length]
        : ['of', signal.of.length]
    tooMany(
      lint,
      count,
      DEFINITION_LIMITS.signalTerms,
      ['signals', index, key],
      `terms in \`${signal.name}\``
    )
  }
}

// ── Conditions and operands ──────────────────────────────────────────────

/** Every condition of the definition, with its path. */
function* conditions(
  definition: TemplateDefinition
): Generator<{ condition: Condition; path: DslPath }> {
  for (const [index, rule] of definition.preconditions.entries()) {
    yield { condition: rule.when, path: ['preconditions', index, 'when'] }
  }
  for (const [id, question] of Object.entries(definition.questions)) {
    if (question.when) {
      yield { condition: question.when, path: ['questions', id, 'when'] }
    }
  }
  for (const [index, rule] of definition.flagRules.entries()) {
    yield { condition: rule.when, path: ['flagRules', index, 'when'] }
  }
  for (const [index, rule] of definition.rules.entries()) {
    yield { condition: rule.when, path: ['rules', index, 'when'] }
  }
}

function lintConditions(lint: Lint) {
  const max = DEFINITION_LIMITS.conditionDepth
  for (const { condition, path } of conditions(lint.definition)) {
    const depth = conditionDepth(condition)
    if (depth > max) {
      error(
        lint,
        'CONDITION_TOO_DEEP',
        path,
        `Conditions nest at most ${max} levels (this one has ${depth})`
      )
    }
    for (const { comparison, path: at } of walkComparisons(condition, path)) {
      lintComparison(lint, comparison, at)
    }
  }
}

const ANSWER_FIELDS_BY_TYPE: Record<QuestionType, readonly AnswerField[]> = {
  choice: ['choice', 'confidence', 'prob'],
  score: ['level', 'score', 'score_norm', 'confidence', 'prob'],
  boolean: ['probability', 'confidence']
}

function lintOperands(lint: Lint) {
  for (const { operand, section, path } of definitionOperands(
    lint.definition
  )) {
    if (
      (section === 'preconditions' || section === 'questions') &&
      !('input' in operand || 'value' in operand)
    ) {
      const what =
        section === 'preconditions'
          ? 'Preconditions run'
          : "A question's `when` is evaluated"
      error(
        lint,
        'INPUT_ONLY_OPERAND',
        path,
        `${what} before Jev is called: use only \`input\` and \`value\` operands`
      )
      continue
    }
    lintReference(lint, operand, section, path)
    if (section === 'signals') {
      const type = operandType(lint, operand)
      if (!isNumeric(type)) {
        error(
          lint,
          'OPERATOR_TYPE',
          path,
          `Signals combine numbers; ${describe(operand)} is ${noun(type)}`
        )
      }
    }
  }
}

/** Whether what `operand` names exists, and is visible from `section`. */
function lintReference(
  lint: Lint,
  operand: Operand,
  section: DslSection,
  path: DslPath
) {
  // Signals and flag rules are evaluated in order: `path[1]` is this one's index.
  const position = path[1] as number

  if ('answer' in operand) {
    const question = questionOf(lint, operand.answer)
    if (!question) {
      return error(
        lint,
        'UNKNOWN_QUESTION',
        path,
        `No question \`${operand.answer}\``
      )
    }
    const fields = ANSWER_FIELDS_BY_TYPE[question.type]
    if (!fields.includes(operand.field)) {
      return error(
        lint,
        'ANSWER_FIELD_MISMATCH',
        path,
        `A ${question.type} answer has no \`${operand.field}\` (use ${quoted(fields)})`
      )
    }
    const { option } = operand
    if (option !== undefined && !optionsOf(question).includes(option)) {
      error(
        lint,
        'UNKNOWN_OPTION',
        [...path, 'option'],
        `\`${operand.answer}\` has no option \`${option}\` (options: ${quoted(optionsOf(question))})`
      )
    }
  } else if ('signal' in operand) {
    const index = lint.signals.get(operand.signal)
    if (index === undefined) {
      error(lint, 'UNKNOWN_SIGNAL', path, `No signal \`${operand.signal}\``)
    } else if (section === 'signals' && index >= position) {
      error(
        lint,
        'SIGNAL_FORWARD_REFERENCE',
        path,
        `Signal \`${operand.signal}\` is not computed yet here: a signal only sees the signals defined before it`
      )
    }
  } else if ('flag' in operand) {
    const index = lint.flags.get(operand.flag)
    if (index === undefined) {
      error(
        lint,
        'UNKNOWN_FLAG',
        path,
        `No flag rule raises \`${operand.flag}\``
      )
    } else if (section === 'flagRules' && index >= position) {
      error(
        lint,
        'FLAG_IN_FLAG_RULE',
        path,
        `Flag \`${operand.flag}\` is only raised by this or a later flag rule, so it is always false here: a flag rule only sees the flags raised before it`
      )
    }
  } else if ('input' in operand && !isDeclaredPath(lint, operand.input)) {
    error(
      lint,
      'UNKNOWN_INPUT_PATH',
      path,
      `\`${operand.input}\` is not a declared input field`
    )
  }
}

type JsonType = 'number' | 'string' | 'boolean' | 'array' | 'object' | 'null'

/**
 * What lint knows statically about an operand's value. Unknown references
 * (already reported) infer nothing, so they never cascade into type errors.
 */
interface OperandType {
  json?: JsonType
  /** Probabilities, confidences, scores and signals: compare them with gte/lte, never eq. */
  continuous?: boolean
  /** The values a `choice`/`level` operand can take. */
  options?: readonly string[]
  /** Accepted by date operators: datetime and numeric (epoch ms) inputs, ISO or epoch-ms values. */
  date?: boolean
  /** A `value` operand's literal. */
  literal?: { value: JsonValue }
}

const FIELD_TYPES: Record<InputFieldType, OperandType> = {
  string: { json: 'string' },
  enum: { json: 'string' },
  datetime: { json: 'string', date: true },
  number: { json: 'number', date: true },
  integer: { json: 'number', date: true },
  boolean: { json: 'boolean' },
  array: { json: 'array' },
  object: { json: 'object' }
}

function jsonType(value: JsonValue): JsonType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value as 'number' | 'string' | 'boolean' | 'object'
}

const EMPTY_SCOPE: PolicyScope = {
  input: {},
  answers: {},
  signals: {},
  flags: new Set(),
  now: new Date(0)
}

/**
 * Whether the policy reads `value` as a date. Asked of the runtime itself
 * (`after` is unknown unless both sides are dates), so lint accepts exactly
 * what the policy does: strict ISO strings or epoch ms — not everything
 * `Date.parse` understands (`"5"`, `"Jan 1 2030"`), which would silently
 * leave the comparison unknown on every run.
 */
function isDateValue(value: JsonValue): boolean {
  const probe: Condition = {
    op: 'after',
    left: { value },
    right: { value: 0 }
  }
  return evaluateCondition(probe, EMPTY_SCOPE) !== null
}

function operandType(lint: Lint, operand: Operand): OperandType {
  if ('answer' in operand) {
    const question = questionOf(lint, operand.answer)
    if (
      !question ||
      !ANSWER_FIELDS_BY_TYPE[question.type].includes(operand.field)
    ) {
      return {}
    }
    return operand.field === 'choice' || operand.field === 'level'
      ? { json: 'string', options: optionsOf(question) }
      : { json: 'number', continuous: true }
  }
  if ('signal' in operand) return { json: 'number', continuous: true }
  if ('flag' in operand) return { json: 'boolean' }
  if ('input' in operand) {
    const field = lint.fields.get(operand.input)
    if (field) return FIELD_TYPES[field.type]
    return lint.parents.has(operand.input) ? { json: 'object' } : {}
  }
  const { value } = operand
  return { json: jsonType(value), date: isDateValue(value), literal: { value } }
}

const isNumeric = (type: OperandType) =>
  type.json === undefined || type.json === 'number'
const isDate = (type: OperandType) =>
  type.json === undefined || type.date === true
const hasLength = (type: OperandType) =>
  type.json === undefined || type.json === 'string' || type.json === 'array'
const isNullLiteral = (type: OperandType) => type.literal?.value === null

function noun(type: OperandType): string {
  if (type.options) return 'an option label'
  if (type.continuous) return 'a continuous number'
  if (type.json === 'string' && type.date) return 'a date string'
  return type.json ? JSON_NOUNS[type.json] : 'of unknown type'
}

const JSON_NOUNS: Record<JsonType, string> = {
  number: 'a number',
  string: 'a string',
  boolean: 'a boolean',
  array: 'an array',
  object: 'an object',
  null: 'null'
}

function describe(operand: Operand): string {
  if ('answer' in operand) {
    return operand.field === 'prob'
      ? `\`${operand.answer}.prob(${operand.option})\``
      : `\`${operand.answer}.${operand.field}\``
  }
  if ('signal' in operand) return `signal \`${operand.signal}\``
  if ('flag' in operand) return `flag \`${operand.flag}\``
  if ('input' in operand) return `input \`${operand.input}\``
  const json = JSON.stringify(operand.value)
  return `\`${json.length > 40 ? `${json.slice(0, 37)}...` : json}\``
}

interface Side {
  operand: Operand
  type: OperandType
  path: DslPath
}

function lintComparison(lint: Lint, comparison: Comparison, path: DslPath) {
  const { op, right } = comparison
  if (op === 'exists' || right === undefined) return

  const side = (operand: Operand, at: DslPath): Side => ({
    operand,
    type: operandType(lint, operand),
    path: at
  })
  const left = side(comparison.left, [...path, 'left'])
  const rights = Array.isArray(right)
    ? right.map((operand, index) => side(operand, [...path, 'right', index]))
    : [side(right, [...path, 'right'])]
  const mismatch = (at: Side, expected: string) =>
    error(
      lint,
      'OPERATOR_TYPE',
      at.path,
      `\`${op}\` ${expected}; ${describe(at.operand)} is ${noun(at.type)}`
    )

  switch (op) {
    case 'eq':
    case 'neq':
      return lintEquality(lint, op, left, rights)
    case 'in': {
      if (!Array.isArray(right)) {
        return lintInArray(lint, left, rights[0] as Side, mismatch)
      }
      // Null items are ignored at runtime; a list of only nulls is always unknown.
      const items = rights.filter(at => !isNullLiteral(at.type))
      if (rights.length > 0 && items.length === 0) {
        error(
          lint,
          'OPERATOR_TYPE',
          [...path, 'right'],
          '`in` with only null values is always unknown: use `exists`'
        )
      }
      return lintEquality(lint, op, left, items)
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
    case 'between':
      for (const at of [left, ...rights]) {
        if (!isNumeric(at.type)) mismatch(at, 'compares numbers')
      }
      return
    case 'contains':
      if (!hasLength(left.type)) {
        return mismatch(left, 'searches a string or an array')
      }
      if (left.type.json === 'string') {
        for (const at of rights) {
          if (at.type.json !== undefined && at.type.json !== 'string') {
            mismatch(at, 'looks for a substring')
          }
        }
      }
      return
    case 'len_gt':
    case 'len_lt':
      if (!hasLength(left.type)) mismatch(left, 'measures a string or an array')
      for (const at of rights) {
        if (!isNumeric(at.type))
          mismatch(at, 'compares the length with a number')
      }
      return
    case 'before':
    case 'after':
      for (const at of [left, ...rights]) {
        if (!isDate(at.type))
          mismatch(at, 'compares dates (ISO strings or epoch ms)')
      }
      return
    case 'days_since_gt':
    case 'days_since_lt':
      if (!isDate(left.type)) {
        mismatch(left, 'needs a date (ISO string or epoch ms)')
      }
      for (const at of rights) {
        if (!isNumeric(at.type))
          mismatch(at, 'compares elapsed days with a number')
      }
  }
}

/** `in` against one operand: it must be an array; a literal one is checked item by item. */
function lintInArray(
  lint: Lint,
  left: Side,
  list: Side,
  mismatch: (at: Side, expected: string) => void
) {
  if (list.type.json !== undefined && list.type.json !== 'array') {
    return mismatch(list, 'needs a list of operands or an array')
  }
  const value = list.type.literal?.value
  const items: Side[] = []
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      if (item === null) continue
      const operand: Operand = { value: item }
      items.push({
        operand,
        type: operandType(lint, operand),
        path: [...list.path, 'value', index]
      })
    }
  }
  lintEquality(lint, 'in', left, items)
}

/** `eq`/`neq`/`in`: deep equality between `left` and each of `rights`. */
function lintEquality(
  lint: Lint,
  op: 'eq' | 'neq' | 'in',
  left: Side,
  rights: readonly Side[]
) {
  for (const at of [left, ...rights]) {
    if (at.type.continuous) {
      error(
        lint,
        'OPERATOR_TYPE',
        at.path,
        `\`${op}\` on ${describe(at.operand)} (a continuous value) almost never matches exactly: use gte/lte`
      )
    } else if (isNullLiteral(at.type)) {
      error(
        lint,
        'OPERATOR_TYPE',
        at.path,
        `\`${op}\` with null is always unknown: use \`exists\``
      )
    }
  }

  for (const right of rights) {
    const skip = [left, right].some(
      at => at.type.continuous || isNullLiteral(at.type)
    )
    if (
      skip ||
      unknownOption(lint, left, right) ||
      unknownOption(lint, right, left)
    ) {
      continue
    }
    const [a, b] = [left.type.json, right.type.json]
    if (a !== undefined && b !== undefined && a !== b) {
      error(
        lint,
        'OPERATOR_TYPE',
        right.path,
        `\`${op}\` compares ${describe(left.operand)} (${noun(left.type)}) with ${describe(right.operand)} (${noun(right.type)}): they are never equal`
      )
    }
  }
}

/** Reports (and returns true for) a literal compared with a choice/level it can never take. */
function unknownOption(lint: Lint, labelled: Side, literal: Side): boolean {
  const { options } = labelled.type
  const value = literal.type.literal?.value
  if (!options || typeof value !== 'string' || options.includes(value)) {
    return false
  }
  error(
    lint,
    'UNKNOWN_OPTION',
    literal.path,
    `${describe(labelled.operand)} is never \`${value}\` (options: ${quoted(options)})`
  )
  return true
}

// ── Decisions ────────────────────────────────────────────────────────────

function lintDecisionTargets(lint: Lint) {
  const { preconditions, rules, fallback } = lint.definition

  for (const [index, rule] of preconditions.entries()) {
    const path = ['preconditions', index]
    if (typeof rule.decision === 'string') {
      lintLabel(lint, rule.decision, [...path, 'decision'])
    } else {
      error(
        lint,
        'FROM_ANSWER_IN_PRECONDITION',
        [...path, 'decision'],
        'Preconditions run before Jev is called, so they cannot decide `fromAnswer`'
      )
    }
    lintConfidenceFrom(lint, rule, path)
  }

  for (const [index, rule] of rules.entries()) {
    const path = ['rules', index]
    if (typeof rule.decision === 'string') {
      lintLabel(lint, rule.decision, [...path, 'decision'])
      if (rule.confidenceFrom === undefined) {
        lintConfidenceSource(
          lint,
          rule.decision,
          [...path, 'decision'],
          `Rule \`${rule.id}\` has no confidence (set \`confidenceFrom\`)`
        )
      }
    } else {
      lintFromAnswer(lint, rule.decision.fromAnswer, [
        ...path,
        'decision',
        'fromAnswer'
      ])
    }
    lintConfidenceFrom(lint, rule, path)
  }

  lintLabel(lint, fallback.decision, ['fallback', 'decision'])
  lintConfidenceSource(
    lint,
    fallback.decision,
    ['fallback', 'decision'],
    'The fallback has no confidence'
  )
}

function lintLabel(lint: Lint, label: string, path: DslPath) {
  if (label !== NEEDS_REVIEW && !lint.labels.has(label)) {
    error(
      lint,
      'UNKNOWN_LABEL',
      path,
      `\`${label}\` is not a declared decision`
    )
  }
}

/**
 * A `fromAnswer` decision turns the chosen option / most probable level into
 * the decision, so each of them must be a declared label (`needs_review` is
 * allowed: an "unsure" option may route to review on purpose).
 */
function lintFromAnswer(lint: Lint, id: string, path: DslPath) {
  const question = questionOf(lint, id)
  if (!question) {
    return error(
      lint,
      'FROM_ANSWER_UNKNOWN_QUESTION',
      path,
      `No question \`${id}\``
    )
  }
  if (question.type === 'boolean') {
    return error(
      lint,
      'FROM_ANSWER_BOOLEAN',
      path,
      `\`${id}\` is a boolean question with no label to decide: write rules on its \`probability\``
    )
  }
  const missing = [...new Set(optionsOf(question))].filter(
    option => option !== NEEDS_REVIEW && !lint.labels.has(option)
  )
  if (missing.length > 0) {
    error(
      lint,
      'FROM_ANSWER_LABEL_MISSING',
      path,
      `\`${id}\` can answer ${quoted(missing)}, not declared as ${missing.length === 1 ? 'a decision' : 'decisions'}`
    )
  }
}

function lintConfidenceFrom(lint: Lint, rule: DecisionRule, path: DslPath) {
  const { confidenceFrom } = rule
  if (confidenceFrom !== undefined && !questionOf(lint, confidenceFrom)) {
    error(
      lint,
      'CONFIDENCE_FROM_UNKNOWN_QUESTION',
      [...path, 'confidenceFrom'],
      `No question \`${confidenceFrom}\``
    )
  }
}

/**
 * A label gated by `minConfidence` reached without any confidence always goes
 * to review (fail-closed). Intentional with `alwaysReview`, so not reported.
 */
function lintConfidenceSource(
  lint: Lint,
  label: string,
  path: DslPath,
  why: string
) {
  const policy = lint.definition.decisions.find(d => d.label === label)
  if (policy?.minConfidence === undefined || policy.alwaysReview) return
  warn(
    lint,
    'CONFIDENCE_SOURCE_MISSING',
    path,
    `${why}, but \`${label}\` needs ${policy.minConfidence}: it always goes to review`
  )
}

// ── Instructions ─────────────────────────────────────────────────────────

const BACKTICKED = /`([^`]+)`/g
const PATH_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Backticked tokens shaped like a dot path (`ticket.message`). Single words
 * are not checked: authors backtick option names and keywords too.
 */
function backtickedPaths(text: string): string[] {
  return [...text.matchAll(BACKTICKED)]
    .map(match => match[1] ?? '')
    .filter(token => {
      const segments = token.split('.')
      return (
        segments.length > 1 &&
        segments.every(segment => PATH_SEGMENT.test(segment))
      )
    })
}

function isKnownReference(lint: Lint, token: string): boolean {
  if (isDeclaredPath(lint, token)) return true
  const { context } = lint.definition.state
  return (
    context !== undefined &&
    (Object.hasOwn(context, token) || getPath(context, token) !== undefined)
  )
}

function lintInstructions(lint: Lint) {
  for (const [id, question] of Object.entries(lint.definition.questions)) {
    const base = ['questions', id]
    lintEntry(lint, question.instructions, [...base, 'instructions'])
    if (question.type === 'choice') {
      for (const [option, entry] of Object.entries(question.criteria)) {
        lintEntry(lint, entry, [...base, 'criteria', option])
      }
    } else if (question.type === 'score') {
      for (const [index, level] of question.levels.entries()) {
        lintEntry(lint, level.criteria, [...base, 'levels', index, 'criteria'])
      }
    } else {
      for (const outcome of ['true', 'false'] as const) {
        lintEntry(lint, question.criteria?.[outcome], [
          ...base,
          'criteria',
          outcome
        ])
      }
    }
  }
}

/** Checks every string inside an instruction/criteria entry (object keys included). */
function lintEntry(lint: Lint, entry: JsonValue | undefined, path: DslPath) {
  if (typeof entry === 'string') {
    for (const token of backtickedPaths(entry)) {
      if (!isKnownReference(lint, token)) {
        error(
          lint,
          'INSTRUCTION_UNKNOWN_PATH',
          path,
          `\`${token}\` is neither a declared input field nor a state context key`
        )
      }
    }
  } else if (Array.isArray(entry)) {
    for (const [index, item] of entry.entries()) {
      lintEntry(lint, item, [...path, index])
    }
  } else if (entry !== null && typeof entry === 'object') {
    for (const [key, item] of Object.entries(entry)) {
      lintEntry(lint, key, path)
      lintEntry(lint, item, [...path, key])
    }
  }
}

// ── Warnings ─────────────────────────────────────────────────────────────

function lintUnusedQuestions(lint: Lint) {
  const used = new Set<string>()
  for (const { operand } of definitionOperands(lint.definition)) {
    if ('answer' in operand) used.add(operand.answer)
  }
  for (const rule of lint.definition.rules) {
    if (typeof rule.decision !== 'string') used.add(rule.decision.fromAnswer)
    if (rule.confidenceFrom !== undefined) used.add(rule.confidenceFrom)
  }
  for (const id of Object.keys(lint.definition.questions)) {
    if (!used.has(id)) {
      warn(
        lint,
        'UNUSED_QUESTION',
        ['questions', id],
        `Nothing reads \`${id}\`, yet it is asked on every run`
      )
    }
  }
}

/** True whatever the data: `{ all: [] }` and its equivalents. */
function alwaysTrue(condition: Condition): boolean {
  if ('all' in condition) return condition.all.every(alwaysTrue)
  if ('any' in condition) return condition.any.some(alwaysTrue)
  if ('not' in condition) return alwaysFalse(condition.not)
  return false
}

function alwaysFalse(condition: Condition): boolean {
  if ('all' in condition) return condition.all.some(alwaysFalse)
  if ('any' in condition) return condition.any.every(alwaysFalse)
  if ('not' in condition) return alwaysTrue(condition.not)
  return false
}

const isCatchAll = (rule: DecisionRule) =>
  typeof rule.decision === 'string' && alwaysTrue(rule.when)

/**
 * Rules after a catch-all with a label decision never run. (A catch-all
 * `fromAnswer` rule is skipped when its answer is null, so it doesn't count.)
 * Among `rules`, a catch-all `needs_review` still lets the later rules pick
 * the reviewer's suggestion (that scan skips literal `needs_review` rules), so
 * until a catch-all with a real label, only those `needs_review` rules are dead.
 */
function lintUnreachableRules(lint: Lint, section: 'preconditions' | 'rules') {
  const list = lint.definition[section]
  const decider = list.findIndex(isCatchAll)
  if (decider === -1) return
  const suggester =
    section === 'rules'
      ? list.findIndex(
          rule => isCatchAll(rule) && rule.decision !== NEEDS_REVIEW
        )
      : decider
  const winner = (list[decider] as DecisionRule).id
  for (const [index, rule] of list.entries()) {
    if (index <= decider) continue
    const suggests =
      (suggester === -1 || index <= suggester) && rule.decision !== NEEDS_REVIEW
    if (suggests) continue
    warn(
      lint,
      'UNREACHABLE_RULE',
      [section, index],
      `\`${rule.id}\` never runs: \`${winner}\` always matches before it`
    )
  }
}

/** `policyInput` is stored with every run whatever `storeInput` says, pii included. */
function lintPii(lint: Lint) {
  const read = policyInputPaths(lint.definition)
  for (const [index, field] of lint.definition.input.fields.entries()) {
    if (!field.pii) continue
    const reader = read.find(
      path => isPathPrefix(path, field.path) || isPathPrefix(field.path, path)
    )
    if (reader !== undefined) {
      warn(
        lint,
        'PII_IN_POLICY',
        ['input', 'fields', index],
        `\`${field.path}\` is personal data, but the policy reads \`${reader}\`, so it is kept in every run's policyInput`
      )
    }
  }
}

function lintAlwaysReview(lint: Lint) {
  const { rules, preconditions, fallback } = lint.definition
  if (
    rules.length === 0 &&
    preconditions.length === 0 &&
    fallback.decision === NEEDS_REVIEW
  ) {
    warn(
      lint,
      'ALWAYS_REVIEW',
      [],
      'No rule or precondition can decide, and the fallback is `needs_review`: every run goes to review'
    )
  }
}

/**
 * Only the static part of the state (`state.context`) is known here; the
 * run's input comes on top, so crossing 80% already leaves little room.
 */
function lintTokenBudget(lint: Lint, maxContextTokens: number) {
  const questions = Object.fromEntries(
    Object.entries(lint.definition.questions).map(([id, question]) => [
      id,
      toCanonicalQuestion(question)
    ])
  )
  const estimate = estimateRequestTokens(
    lint.definition.state.context ?? {},
    questions
  )
  if (checkTokenBudget(estimate.total, maxContextTokens) === 'ok') return
  const percent = Math.round((estimate.total / maxContextTokens) * 100)
  warn(
    lint,
    'TOKEN_BUDGET',
    [],
    `The state context and the longest question take ~${estimate.total} tokens (${percent}% of the ${maxContextTokens}-token limit) before any input is added`
  )
}
