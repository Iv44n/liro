import z from 'zod'
import type { EntryType, JsonValue } from '#modules/engine/evaluator/port'

/**
 * The decision template DSL: what a template version stores in its
 * `definition` column. It is provider-neutral (`boolean` is Jev's "noul") and
 * purely structural — semantic checks (labels exist, operands fit their
 * question type, limits worth warning about…) live in `lint.ts`, so a draft
 * can be saved while still incomplete.
 *
 * A run goes through six stages, all declared here:
 *   1. `preconditions` — rules over the input only; a match decides without calling Jev.
 *   2. `state`         — which input paths are sent to Jev, plus static context.
 *   3. `questions`     — one batched evaluation.
 *   4. `signals`       — derived numbers (weighted composites, min/max/mean).
 *   5. `flagRules`     — every matching rule adds its flags.
 *   6. `rules`         — the first matching rule decides; otherwise `fallback`.
 */

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

// ── Names ────────────────────────────────────────────────────────────────

/**
 * Names that would collide with `Object.prototype` members when used as
 * object keys (`probabilities.constructor`, `input.__proto__…`). Rejected
 * everywhere a definition names a key, so lookups can't reach the prototype.
 */
export const RESERVED_NAMES: ReadonlySet<string> = new Set(
  Object.getOwnPropertyNames(Object.prototype)
)

const notReserved = (name: string) => !RESERVED_NAMES.has(name)
const RESERVED_MESSAGE = 'This name is reserved'

/** Question ids, signal/flag names and rule ids: `lower_snake_case`. */
export const keySchema = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/, 'Use lower_snake_case (a-z, 0-9, _)')
  .refine(notReserved, RESERVED_MESSAGE)

/**
 * Decision labels, Choice option names and Score level labels. Labels are
 * part of a template's public contract (callers switch on them), and a
 * `fromAnswer` rule turns an option/level name into a decision label.
 */
export const labelSchema = z
  .string()
  .max(64)
  .regex(
    /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/,
    'Use lowercase letters and digits, separated by _ or -'
  )
  .refine(notReserved, RESERVED_MESSAGE)

/** One segment of an input path: an identifier that isn't a reserved name. */
export const PATH_SEGMENT = /^[A-Za-z_][A-Za-z0-9_]*$/

export const isPathSegment = (segment: string): boolean =>
  PATH_SEGMENT.test(segment) && notReserved(segment)

/** A dot path into the run input, e.g. `ticket.message`. */
export const pathSchema = z
  .string()
  .max(256)
  .refine(
    path =>
      path.split('.').length <= DEFINITION_LIMITS.pathDepth &&
      path.split('.').every(isPathSegment),
    'Use dot-separated identifiers, e.g. ticket.message'
  )

// ── Values ───────────────────────────────────────────────────────────────

export const jsonValueSchema = z.json() as z.ZodType<JsonValue>

/** Jev's `EntryType`: a string, or structured JSON (object/array). */
export const entrySchema: z.ZodType<EntryType> = z.union([
  z.string().min(1),
  z.record(z.string(), jsonValueSchema),
  z.array(jsonValueSchema)
])

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

export const inputFieldSchema = z
  .strictObject({
    /** Leaf path; its parents are implied objects. */
    path: pathSchema,
    type: z.enum(INPUT_FIELD_TYPES),
    required: z.boolean().default(false),
    description: z.string().max(2_000).optional(),
    /** Allowed values when `type` is `enum`. */
    enum: z.array(z.string().min(1).max(256)).min(1).max(255).optional(),
    /** Only for `string`. */
    maxLength: z.number().int().positive().optional(),
    /** Personal data: never stored in a run's `input`, whatever `storeInput` says. */
    pii: z.boolean().optional()
  })
  .superRefine((field, ctx) => {
    if (field.type === 'enum' && !field.enum) {
      ctx.addIssue({
        code: 'custom',
        path: ['enum'],
        message: 'An enum field needs its allowed values'
      })
    }
    if (field.type !== 'enum' && field.enum) {
      ctx.addIssue({
        code: 'custom',
        path: ['enum'],
        message: 'Only enum fields take allowed values'
      })
    }
    if (field.type !== 'string' && field.maxLength !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxLength'],
        message: 'Only string fields take maxLength'
      })
    }
  })

export type InputField = z.output<typeof inputFieldSchema>

// ── Operands and conditions ──────────────────────────────────────────────

/**
 * What an `answer` operand reads from a resolved answer:
 * - `choice`      Choice: the chosen option name.
 * - `level`       Score: the label of the most probable level (argmax; `round(score)` without probabilities).
 * - `score`       Score: Jev's expected value, in [0, levels − 1].
 * - `score_norm`  Score: `score / (levels − 1)`, in [0, 1].
 * - `confidence`  Choice/Score: `(K·p_max − 1)/(K − 1)`; boolean: `|2p − 1|`. `null` without probabilities.
 * - `probability` boolean: P(true).
 * - `prob`        Choice/Score: probability of `option` (an option name / level label). `null` without probabilities.
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

export type Operand =
  | { answer: string; field: AnswerField; option?: string }
  | { signal: string }
  | { flag: string }
  | { input: string }
  | { value: JsonValue }

export const operandSchema: z.ZodType<Operand> = z.union([
  z
    .strictObject({
      answer: keySchema,
      field: z.enum(ANSWER_FIELDS),
      option: labelSchema.optional()
    })
    .superRefine((operand, ctx) => {
      if (operand.field === 'prob' && operand.option === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['option'],
          message: '`prob` needs the option (or level) it reads'
        })
      }
      if (operand.field !== 'prob' && operand.option !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['option'],
          message: 'Only `prob` takes an option'
        })
      }
    }),
  z.strictObject({ signal: keySchema }),
  z.strictObject({ flag: keySchema }),
  z.strictObject({ input: pathSchema }),
  z.strictObject({ value: jsonValueSchema })
])

/**
 * Comparison operators. Semantics (see `engine/policy.ts`):
 * - `eq`/`neq`: deep equality. `in`: left equals one of the right values.
 * - `gt`/`gte`/`lt`/`lte`: numbers. `between`: inclusive, `right` is `[low, high]`.
 * - `exists`: left is not null/missing (never unknown). Takes no `right`.
 * - `contains`: case-insensitive substring, or array membership.
 * - `len_gt`/`len_lt`: length of a string or array.
 * - `before`/`after`: dates (ISO strings or epoch ms).
 * - `days_since_gt`/`days_since_lt`: days elapsed (fractional, 24 h each) from left (a date) to the run's time.
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
 * Conditions use three-valued logic: a comparison involving a missing/null
 * value (a skipped question, absent probabilities, an absent input field…) is
 * *unknown*, `not unknown` is unknown, and a rule only matches when its
 * condition is *true*. So a rule can never fire for lack of evidence.
 * `{ all: [] }` is true (a catch-all); `{ any: [] }` is false.
 */
export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | Comparison

export const comparisonSchema: z.ZodType<Comparison> = z
  .strictObject({
    op: z.enum(OPERATORS),
    left: operandSchema,
    right: z.union([operandSchema, z.array(operandSchema)]).optional()
  })
  .superRefine((comparison, ctx) => {
    const { op, right } = comparison
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', path: ['right'], message })

    if (op === 'exists') {
      if (right !== undefined) issue('`exists` takes no right operand')
      return
    }
    if (right === undefined) return issue(`\`${op}\` needs a right operand`)
    if (op === 'between') {
      if (!Array.isArray(right) || right.length !== 2) {
        issue('`between` needs [low, high]')
      }
      return
    }
    if (Array.isArray(right) && op !== 'in') {
      issue(`\`${op}\` takes a single right operand`)
    }
  })

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ all: z.array(conditionSchema) }),
    z.strictObject({ any: z.array(conditionSchema) }),
    z.strictObject({ not: conditionSchema }),
    comparisonSchema
  ])
)

// ── Questions ────────────────────────────────────────────────────────────

const questionBase = {
  instructions: entrySchema,
  /** Internal note for template authors; never sent to Jev. */
  note: z.string().max(2_000).optional(),
  /** Ask only when this input-only condition holds; otherwise the answer is null. */
  when: conditionSchema.optional()
}

export const questionSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('choice'),
    ...questionBase,
    /** Option name → what it covers (`null` when the name speaks for itself). */
    criteria: z.record(labelSchema, entrySchema.nullable())
  }),
  z.strictObject({
    type: z.literal('score'),
    ...questionBase,
    /** Ordered lowest first; a level's number is its position. */
    levels: z.array(
      z.strictObject({
        label: labelSchema,
        criteria: entrySchema.nullable()
      })
    )
  }),
  z.strictObject({
    type: z.literal('boolean'),
    ...questionBase,
    criteria: z
      .strictObject({
        true: entrySchema.nullable().optional(),
        false: entrySchema.nullable().optional()
      })
      .optional()
  })
])

export type QuestionDef = z.output<typeof questionSchema>
export type QuestionType = QuestionDef['type']

// ── Signals, flags and rules ─────────────────────────────────────────────

export const signalSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    name: keySchema,
    kind: z.literal('weighted'),
    /**
     * Weighted mean of the terms, each expected in [0, 1] (`1 − x` when
     * `invert`). Null terms are dropped and the remaining weights renormalized;
     * all null → null.
     */
    terms: z.array(
      z.strictObject({
        operand: operandSchema,
        weight: z.number().positive(),
        invert: z.boolean().optional()
      })
    )
  }),
  z.strictObject({
    name: keySchema,
    kind: z.enum(['min', 'max', 'mean']),
    /** Null values are ignored; all null → null. */
    of: z.array(operandSchema)
  })
])

export type SignalDef = z.output<typeof signalSchema>

/** A decision label, or `{ fromAnswer }`: the chosen option / most probable level of a question. */
export const decisionTargetSchema = z.union([
  labelSchema,
  z.strictObject({ fromAnswer: keySchema })
])

export const decisionRuleSchema = z.strictObject({
  id: keySchema,
  name: z.string().max(200).optional(),
  when: conditionSchema,
  decision: decisionTargetSchema,
  /** Question whose confidence becomes the decision's (defaults to the `fromAnswer` question). */
  confidenceFrom: keySchema.optional()
})

export type DecisionRule = z.output<typeof decisionRuleSchema>

export const flagRuleSchema = z.strictObject({
  id: keySchema,
  name: z.string().max(200).optional(),
  when: conditionSchema,
  flags: z.array(keySchema).min(1)
})

export type FlagRule = z.output<typeof flagRuleSchema>

export const decisionSchema = z.strictObject({
  label: labelSchema,
  description: z.string().max(2_000).optional(),
  /** Below this confidence (or without one) the run goes to review, suggesting this label. */
  minConfidence: z.number().min(0).max(1).optional(),
  /** Every run that lands on this label is reviewed by a human first. */
  alwaysReview: z.boolean().optional()
})

export type DecisionDef = z.output<typeof decisionSchema>

// ── Definition ───────────────────────────────────────────────────────────

export const TEMPLATE_KINDS = ['classify', 'score', 'decide', 'custom'] as const
export type TemplateKind = (typeof TEMPLATE_KINDS)[number]

export const templateDefinitionSchema = z.strictObject({
  /** The wizard that created it — a UI hint only; the engine ignores it. */
  kind: z.enum(TEMPLATE_KINDS),
  model: z
    .strictObject({
      family: z.literal('jev'),
      /** Exact model version; only honored by providers with versioned models. */
      version: z
        .string()
        .regex(/^\d+\.\d+\.\d+$/)
        .optional()
    })
    .default({ family: 'jev' }),
  input: z.strictObject({ fields: z.array(inputFieldSchema) }),
  state: z
    .strictObject({
      /** Input paths sent to Jev (default: every declared field). */
      include: z.array(pathSchema).optional(),
      /** Static JSON merged into the top level of the state. */
      context: z.record(z.string(), jsonValueSchema).optional()
    })
    .default({}),
  decisions: z.array(decisionSchema),
  preconditions: z.array(decisionRuleSchema).default([]),
  questions: z.record(keySchema, questionSchema).default({}),
  signals: z.array(signalSchema).default([]),
  flagRules: z.array(flagRuleSchema).default([]),
  rules: z.array(decisionRuleSchema).default([]),
  fallback: z
    .strictObject({ decision: labelSchema })
    .default({ decision: NEEDS_REVIEW })
})

export type TemplateDefinition = z.output<typeof templateDefinitionSchema>
/** What callers may send (defaults not yet applied). */
export type TemplateDefinitionInput = z.input<typeof templateDefinitionSchema>

// ── Traversal ────────────────────────────────────────────────────────────

export type DslPath = (string | number)[]

export function isComparison(condition: Condition): condition is Comparison {
  return 'op' in condition
}

/** Every comparison in `condition`, with its path (relative to `path`) and nesting depth. */
export function* walkComparisons(
  condition: Condition,
  path: DslPath = [],
  depth = 1
): Generator<{ comparison: Comparison; path: DslPath; depth: number }> {
  if ('all' in condition) {
    for (const [index, child] of condition.all.entries()) {
      yield* walkComparisons(child, [...path, 'all', index], depth + 1)
    }
  } else if ('any' in condition) {
    for (const [index, child] of condition.any.entries()) {
      yield* walkComparisons(child, [...path, 'any', index], depth + 1)
    }
  } else if ('not' in condition) {
    yield* walkComparisons(condition.not, [...path, 'not'], depth + 1)
  } else {
    yield { comparison: condition, path, depth }
  }
}

/** Maximum nesting depth of a condition (a bare comparison is 1). */
export function conditionDepth(condition: Condition): number {
  if ('all' in condition)
    return 1 + Math.max(0, ...condition.all.map(conditionDepth))
  if ('any' in condition)
    return 1 + Math.max(0, ...condition.any.map(conditionDepth))
  if ('not' in condition) return 1 + conditionDepth(condition.not)
  return 1
}

export type DslSection =
  | 'preconditions'
  | 'questions'
  | 'signals'
  | 'flagRules'
  | 'rules'

export interface OperandLocation {
  operand: Operand
  section: DslSection
  /** Full path inside the definition, e.g. `['rules', 0, 'when', 'all', 1, 'left']`. */
  path: DslPath
}

function* comparisonOperands(
  comparison: Comparison,
  path: DslPath
): Generator<{ operand: Operand; path: DslPath }> {
  yield { operand: comparison.left, path: [...path, 'left'] }
  const { right } = comparison
  if (right === undefined) return
  if (Array.isArray(right)) {
    for (const [index, operand] of right.entries()) {
      yield { operand, path: [...path, 'right', index] }
    }
  } else {
    yield { operand: right, path: [...path, 'right'] }
  }
}

function* conditionOperands(
  condition: Condition,
  section: DslSection,
  path: DslPath
): Generator<OperandLocation> {
  for (const { comparison, path: at } of walkComparisons(condition, path)) {
    for (const { operand, path: operandPath } of comparisonOperands(
      comparison,
      at
    )) {
      yield { operand, section, path: operandPath }
    }
  }
}

/** Every operand the definition reads, wherever it appears. */
export function* definitionOperands(
  definition: TemplateDefinition
): Generator<OperandLocation> {
  for (const [index, rule] of definition.preconditions.entries()) {
    yield* conditionOperands(rule.when, 'preconditions', [
      'preconditions',
      index,
      'when'
    ])
  }
  for (const [id, question] of Object.entries(definition.questions)) {
    if (question.when) {
      yield* conditionOperands(question.when, 'questions', [
        'questions',
        id,
        'when'
      ])
    }
  }
  for (const [index, signal] of definition.signals.entries()) {
    if (signal.kind === 'weighted') {
      for (const [term, { operand }] of signal.terms.entries()) {
        yield {
          operand,
          section: 'signals',
          path: ['signals', index, 'terms', term, 'operand']
        }
      }
    } else {
      for (const [position, operand] of signal.of.entries()) {
        yield {
          operand,
          section: 'signals',
          path: ['signals', index, 'of', position]
        }
      }
    }
  }
  for (const [index, rule] of definition.flagRules.entries()) {
    yield* conditionOperands(rule.when, 'flagRules', [
      'flagRules',
      index,
      'when'
    ])
  }
  for (const [index, rule] of definition.rules.entries()) {
    yield* conditionOperands(rule.when, 'rules', ['rules', index, 'when'])
  }
}

/**
 * Input paths the policy reads (preconditions, question `when`s, signals,
 * flag rules and rules). A run always stores these as `policyInput`, so it
 * can be replayed against another policy even after its full input is purged.
 */
export function policyInputPaths(definition: TemplateDefinition): string[] {
  const paths = new Set<string>()
  for (const { operand } of definitionOperands(definition)) {
    if ('input' in operand) paths.add(operand.input)
  }
  return [...paths].sort()
}

/** The decision labels a run of this definition can end with, `needs_review` excluded. */
export function decisionLabels(definition: TemplateDefinition): string[] {
  return definition.decisions.map(decision => decision.label)
}
