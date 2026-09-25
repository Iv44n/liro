/**
 * Web mirror of the decision template DSL (`api/src/modules/templates/
 * definition.ts`), plus the lint issue (`lint.ts`) and definition change
 * (`versioning.ts`) shapes. Types and constants only — the API validates and
 * lints; the dashboard uses these to type its editors and to pre-validate
 * forms with the same rules.
 *
 * `TemplateDefinition` is the *parsed* shape (every default applied): what
 * the API returns and what the editor sends back.
 */

// ── JSON ─────────────────────────────────────────────────────────────────

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

/** What Jev accepts for instructions and criteria: text, or structured JSON. */
export type EntryType = string | { [key: string]: JsonValue } | JsonValue[]

// ── Names ────────────────────────────────────────────────────────────────

/** The reserved decision that sends a run to human review. */
export const NEEDS_REVIEW = 'needs_review'

export const DEFINITION_LIMITS = {
  fields: 100,
  questions: 32,
  choiceOptions: { min: 2, max: 255 },
  scoreLevels: { min: 2, max: 10 },
  decisions: 255,
  rules: 200,
  signals: 50,
  signalTerms: 20,
  conditionDepth: 8,
  pathDepth: 6,
  /** Serialized size of the whole definition. */
  bytes: 256 * 1024
} as const

/** Max length of keys (question ids, signal/flag names, rule ids) and labels. */
export const NAME_MAX_LENGTH = 64

/** Question ids, signal/flag names and rule ids: `lower_snake_case`. */
export const KEY_PATTERN = /^[a-z][a-z0-9_]*$/

/** Decision labels, Choice option names and Score level labels. */
export const LABEL_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/

/** One segment of an input path (`ticket.message` has two). */
export const PATH_SEGMENT_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Max length of a whole input path. */
export const PATH_MAX_LENGTH = 256

/** Template slugs: lowercase ASCII words joined by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const SLUG_MAX_LENGTH = 64

/**
 * Names rejected everywhere a definition names a key (`constructor`,
 * `__proto__`, `toString`…), as the API does.
 */
export const RESERVED_NAMES: ReadonlySet<string> = new Set(
  Object.getOwnPropertyNames(Object.prototype)
)

const notReserved = (name: string) => !RESERVED_NAMES.has(name)

/** A valid question id / signal / flag / rule id. */
export const isKey = (value: string): boolean =>
  value.length <= NAME_MAX_LENGTH &&
  KEY_PATTERN.test(value) &&
  notReserved(value)

/** A valid decision label / option name / level label. */
export const isLabel = (value: string): boolean =>
  value.length <= NAME_MAX_LENGTH &&
  LABEL_PATTERN.test(value) &&
  notReserved(value)

/** A valid dot path into the run input, e.g. `ticket.message`. */
export function isInputPath(value: string): boolean {
  if (value.length > PATH_MAX_LENGTH) return false
  const segments = value.split('.')
  return (
    segments.length <= DEFINITION_LIMITS.pathDepth &&
    segments.every(
      segment => PATH_SEGMENT_PATTERN.test(segment) && notReserved(segment)
    )
  )
}

/** A valid template slug. */
export const isSlug = (value: string): boolean =>
  value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value)

// ── Input contract ───────────────────────────────────────────────────────

export const INPUT_FIELD_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  /** ISO-8601 date or date-time string. */
  'datetime',
  /** A string restricted to `enum`. */
  'enum',
  /** Any JSON array. */
  'array',
  /** Any JSON object. */
  'object'
] as const

export type InputFieldType = (typeof INPUT_FIELD_TYPES)[number]

export interface InputField {
  /** Leaf path; its parents are implied objects. */
  path: string
  type: InputFieldType
  required: boolean
  description?: string
  /** Allowed values (1..255, each 1..256 chars); only and always for `enum`. */
  enum?: string[]
  /** Only for `string`. */
  maxLength?: number
  /** Personal data: never stored in a run's `input`, whatever `storeInput` says. */
  pii?: boolean
}

// ── Operands and conditions ──────────────────────────────────────────────

/**
 * What an `answer` operand reads from a resolved answer:
 * - `choice`      Choice: the chosen option name.
 * - `level`       Score: the label of the most probable level.
 * - `score`       Score: expected value, in [0, levels − 1].
 * - `score_norm`  Score: `score / (levels − 1)`, in [0, 1].
 * - `confidence`  Choice/Score: `(K·p_max − 1)/(K − 1)`; boolean: `|2p − 1|`.
 * - `probability` boolean: P(true).
 * - `prob`        Choice/Score: probability of `option`.
 */
export const ANSWER_FIELDS = [
  'choice',
  'level',
  'score',
  'score_norm',
  'confidence',
  'probability',
  'prob'
] as const

export type AnswerField = (typeof ANSWER_FIELDS)[number]

export type AnswerOperand = {
  answer: string
  field: AnswerField
  /** Only (and always) for `prob`. */
  option?: string
}

export type Operand =
  | AnswerOperand
  | { signal: string }
  | { flag: string }
  | { input: string }
  | { value: JsonValue }

/**
 * - `eq`/`neq`: deep equality. `in`: left equals one of the right values.
 * - `gt`/`gte`/`lt`/`lte`: numbers. `between`: inclusive, `right` is `[low, high]`.
 * - `exists`: left is not null/missing. Takes no `right`.
 * - `contains`: case-insensitive substring, or array membership.
 * - `len_gt`/`len_lt`: length of a string or array.
 * - `before`/`after`: dates (ISO strings or epoch ms).
 * - `days_since_gt`/`days_since_lt`: days elapsed from left (a date) to the run's time.
 */
export const OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'between',
  'exists',
  'contains',
  'len_gt',
  'len_lt',
  'before',
  'after',
  'days_since_gt',
  'days_since_lt'
] as const

export type Operator = (typeof OPERATORS)[number]

export type Comparison = {
  op: Operator
  left: Operand
  /** An operand, or a list of them for `in` and `between`. Omitted for `exists`. */
  right?: Operand | Operand[]
}

/**
 * Three-valued logic: a comparison involving a missing value is *unknown*,
 * and a rule only matches when its condition is *true*. `{ all: [] }` is
 * true (a catch-all); `{ any: [] }` is false.
 */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | Comparison

export function isComparison(condition: Condition): condition is Comparison {
  return 'op' in condition
}

// ── Questions ────────────────────────────────────────────────────────────

export const QUESTION_TYPES = ['choice', 'score', 'boolean'] as const
export type QuestionType = (typeof QUESTION_TYPES)[number]

interface QuestionBase {
  instructions: EntryType
  /** Internal note for template authors; never sent to Jev. */
  note?: string
  /** Ask only when this input-only condition holds; otherwise the answer is null. */
  when?: Condition
}

export interface ChoiceQuestion extends QuestionBase {
  type: 'choice'
  /** Option name → what it covers (`null` when the name speaks for itself). */
  criteria: Record<string, EntryType | null>
}

export interface ScoreLevel {
  label: string
  criteria: EntryType | null
}

export interface ScoreQuestion extends QuestionBase {
  type: 'score'
  /** Ordered lowest first; a level's number is its position. */
  levels: ScoreLevel[]
}

export interface BooleanQuestion extends QuestionBase {
  type: 'boolean'
  criteria?: { true?: EntryType | null; false?: EntryType | null }
}

export type QuestionDef = ChoiceQuestion | ScoreQuestion | BooleanQuestion

// ── Signals, flags and rules ─────────────────────────────────────────────

export interface WeightedSignal {
  name: string
  kind: 'weighted'
  /** Weighted mean of the terms (each in [0, 1]; `1 − x` when `invert`). */
  terms: { operand: Operand; weight: number; invert?: boolean }[]
}

export interface AggregateSignal {
  name: string
  kind: 'min' | 'max' | 'mean'
  /** Null values are ignored; all null → null. */
  of: Operand[]
}

export type SignalDef = WeightedSignal | AggregateSignal
export const SIGNAL_KINDS = ['weighted', 'min', 'max', 'mean'] as const
export type SignalKind = SignalDef['kind']

/** A decision label, or the chosen option / most probable level of a question. */
export type DecisionTarget = string | { fromAnswer: string }

export interface DecisionRule {
  id: string
  name?: string
  when: Condition
  decision: DecisionTarget
  /** Question whose confidence becomes the decision's (defaults to the `fromAnswer` question). */
  confidenceFrom?: string
}

export interface FlagRule {
  id: string
  name?: string
  when: Condition
  flags: string[]
}

export interface DecisionDef {
  label: string
  description?: string
  /** Below this confidence (or without one) the run goes to review, suggesting this label. */
  minConfidence?: number
  /** Every run that lands on this label is reviewed by a human first. */
  alwaysReview?: boolean
}

// ── Definition ───────────────────────────────────────────────────────────

export const TEMPLATE_KINDS = ['classify', 'score', 'decide', 'custom'] as const
export type TemplateKind = (typeof TEMPLATE_KINDS)[number]

export interface ModelRef {
  family: 'jev'
  /** Exact model version (`1.2.3`); only honored by providers with versioned models. */
  version?: string
}

export interface TemplateDefinition {
  /** The wizard that created it — a UI hint only; the engine ignores it. */
  kind: TemplateKind
  model: ModelRef
  input: { fields: InputField[] }
  state: {
    /** Input paths sent to Jev (default: every declared field). */
    include?: string[]
    /** Static JSON merged into the top level of the state. */
    context?: Record<string, JsonValue>
  }
  decisions: DecisionDef[]
  preconditions: DecisionRule[]
  questions: Record<string, QuestionDef>
  signals: SignalDef[]
  flagRules: FlagRule[]
  rules: DecisionRule[]
  fallback: { decision: string }
}

/** The decision labels a run of this definition can end with, `needs_review` excluded. */
export const decisionLabels = (definition: TemplateDefinition): string[] =>
  definition.decisions.map(decision => decision.label)

// ── Lint ─────────────────────────────────────────────────────────────────

export type LintSeverity = 'error' | 'warning'

export interface LintIssue {
  severity: LintSeverity
  /** E.g. `UNKNOWN_LABEL`, `UNUSED_QUESTION`, `TOKEN_BUDGET`. */
  code: string
  /** English, from the API. */
  message: string
  /** Dotted path into the definition, e.g. `rules.0.when.left`; `''` for the whole definition. */
  path: string
}

export const LINT_ERROR_CODES = [
  'NO_DECISIONS',
  'DUPLICATE_LABEL',
  'RESERVED_LABEL',
  'UNKNOWN_LABEL',
  'FROM_ANSWER_UNKNOWN_QUESTION',
  'FROM_ANSWER_BOOLEAN',
  'FROM_ANSWER_LABEL_MISSING',
  'FROM_ANSWER_IN_PRECONDITION',
  'CONFIDENCE_FROM_UNKNOWN_QUESTION',
  'INPUT_ONLY_OPERAND',
  'UNKNOWN_QUESTION',
  'UNKNOWN_SIGNAL',
  'SIGNAL_FORWARD_REFERENCE',
  'UNKNOWN_FLAG',
  'FLAG_IN_FLAG_RULE',
  'UNKNOWN_INPUT_PATH',
  'STATE_INCLUDE_UNKNOWN',
  'STATE_CONTEXT_COLLISION',
  'DUPLICATE_FIELD',
  'OVERLAPPING_FIELDS',
  'ANSWER_FIELD_MISMATCH',
  'UNKNOWN_OPTION',
  'OPERATOR_TYPE',
  'CHOICE_OPTIONS',
  'SCORE_LEVELS',
  'DUPLICATE_LEVEL',
  'DUPLICATE_RULE_ID',
  'DUPLICATE_SIGNAL',
  'CONDITION_TOO_DEEP',
  'DEFINITION_TOO_LARGE',
  'TOO_MANY',
  'INSTRUCTION_UNKNOWN_PATH'
] as const

export const LINT_WARNING_CODES = [
  'UNUSED_QUESTION',
  'NUMERIC_LEVELS',
  'UNREACHABLE_RULE',
  'CONFIDENCE_SOURCE_MISSING',
  'PII_IN_POLICY',
  'ALWAYS_REVIEW',
  'TOKEN_BUDGET'
] as const

export type LintErrorCode = (typeof LINT_ERROR_CODES)[number]
export type LintWarningCode = (typeof LINT_WARNING_CODES)[number]

/** Whether the issues block publishing. */
export const hasLintErrors = (issues: readonly LintIssue[]): boolean =>
  issues.some(issue => issue.severity === 'error')

// ── Versioning ───────────────────────────────────────────────────────────

/**
 * - `breaking`: callers may break (labels, stricter input); requires a new major.
 * - `behavior`: same contract, decisions may change; allowed in a minor.
 * - `compatible`: a looser input contract or documentation only.
 */
export type ChangeSeverity = 'breaking' | 'behavior' | 'compatible'

export const CHANGE_SEVERITIES = ['breaking', 'behavior', 'compatible'] as const

/** Every change code with its (fixed) severity. */
export const CHANGE_SEVERITY = {
  LABEL_ADDED: 'breaking',
  LABEL_REMOVED: 'breaking',
  REQUIRED_FIELD_ADDED: 'breaking',
  FIELD_REMOVED: 'breaking',
  FIELD_TYPE_CHANGED: 'breaking',
  FIELD_MADE_REQUIRED: 'breaking',
  ENUM_VALUE_REMOVED: 'breaking',
  FIELD_CONSTRAINT_TIGHTENED: 'breaking',
  MODEL_CHANGED: 'behavior',
  QUESTIONS_CHANGED: 'behavior',
  POLICY_CHANGED: 'behavior',
  STATE_CHANGED: 'behavior',
  OPTIONAL_FIELD_ADDED: 'compatible',
  FIELD_MADE_OPTIONAL: 'compatible',
  ENUM_VALUE_ADDED: 'compatible',
  FIELD_CONSTRAINT_RELAXED: 'compatible',
  DESCRIPTION_CHANGED: 'compatible'
} as const satisfies Record<string, ChangeSeverity>

export type ChangeCode = keyof typeof CHANGE_SEVERITY

export interface DefinitionChange {
  code: ChangeCode
  severity: ChangeSeverity
  /** English, from the API. */
  message: string
  /**
   * The changed element by identity: `decisions.<label>`,
   * `input.fields.<path>`, `questions.<id>`, `rules.<id>`, or a section
   * (`model`, `rules`, `fallback`, `state.include`, `state.context`…).
   */
  path?: string
}
