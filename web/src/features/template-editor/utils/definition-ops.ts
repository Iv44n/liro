import type {
  Comparison,
  Condition,
  DecisionDef,
  DecisionRule,
  EntryType,
  FlagRule,
  InputField,
  JsonValue,
  Operand,
  QuestionDef,
  QuestionType,
  SignalDef,
  TemplateDefinition
} from '#/features/templates/types/definition'

/**
 * Immutable edits of a template definition. Renames also update what refers
 * to the renamed thing (rules, operands, instructions…), so a rename never
 * leaves the policy pointing at a name that no longer exists.
 */

// ── Names ────────────────────────────────────────────────────────────────

/** `base`, or `base_2`, `base_3`… — the first not in `taken`. */
export function uniqueName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let index = 2; ; index++) {
    const candidate = `${base}_${index}`
    if (!used.has(candidate)) return candidate
  }
}

/** Whether `ancestor` is `path` itself or one of its parents. */
export const isPathPrefix = (ancestor: string, path: string): boolean =>
  path === ancestor || path.startsWith(`${ancestor}.`)

/** `path` with its `from` prefix replaced by `to` (unchanged when it has none). */
function replacePrefix(path: string, from: string, to: string): string {
  if (path === from) return to
  if (path.startsWith(`${from}.`)) return `${to}${path.slice(from.length)}`
  return path
}

/** Renames the keys of a record, keeping their order. */
function renameKey<T>(
  record: Record<string, T>,
  from: string,
  to: string
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key === from ? to : key,
      value
    ])
  )
}

// ── Traversal ────────────────────────────────────────────────────────────

type ComparisonMapper = (comparison: Comparison) => Comparison
type OperandMapper = (operand: Operand) => Operand

export function mapCondition(
  condition: Condition,
  fn: ComparisonMapper
): Condition {
  if ('all' in condition) {
    return { all: condition.all.map(child => mapCondition(child, fn)) }
  }
  if ('any' in condition) {
    return { any: condition.any.map(child => mapCondition(child, fn)) }
  }
  if ('not' in condition) return { not: mapCondition(condition.not, fn) }
  return fn(condition)
}

const operandsOf =
  (fn: OperandMapper): ComparisonMapper =>
  comparison => {
    const next: Comparison = { ...comparison, left: fn(comparison.left) }
    if (comparison.right !== undefined) {
      next.right = Array.isArray(comparison.right)
        ? comparison.right.map(fn)
        : fn(comparison.right)
    }
    return next
  }

const mapRule = <T extends DecisionRule | FlagRule>(
  rule: T,
  fn: ComparisonMapper
): T => ({ ...rule, when: mapCondition(rule.when, fn) })

function mapSignal(signal: SignalDef, fn: OperandMapper): SignalDef {
  if (signal.kind === 'weighted') {
    return {
      ...signal,
      terms: signal.terms.map(term => ({ ...term, operand: fn(term.operand) }))
    }
  }
  return { ...signal, of: signal.of.map(fn) }
}

/** Maps every comparison of the definition (and, via `operands`, signal terms). */
function mapPolicy(
  definition: TemplateDefinition,
  comparisons: ComparisonMapper,
  operands?: OperandMapper
): TemplateDefinition {
  return {
    ...definition,
    preconditions: definition.preconditions.map(rule =>
      mapRule(rule, comparisons)
    ),
    questions: Object.fromEntries(
      Object.entries(definition.questions).map(([id, question]) => [
        id,
        question.when
          ? { ...question, when: mapCondition(question.when, comparisons) }
          : question
      ])
    ),
    signals: operands
      ? definition.signals.map(signal => mapSignal(signal, operands))
      : definition.signals,
    flagRules: definition.flagRules.map(rule => mapRule(rule, comparisons)),
    rules: definition.rules.map(rule => mapRule(rule, comparisons))
  }
}

/** Maps every operand the definition reads, wherever it appears. */
export const mapOperands = (
  definition: TemplateDefinition,
  fn: OperandMapper
): TemplateDefinition => mapPolicy(definition, operandsOf(fn), fn)

/** Maps every string of an instruction/criteria entry (not object keys). */
function mapEntryStrings(
  entry: JsonValue,
  fn: (text: string) => string
): JsonValue {
  if (typeof entry === 'string') return fn(entry)
  if (Array.isArray(entry)) return entry.map(item => mapEntryStrings(item, fn))
  if (entry !== null && typeof entry === 'object') {
    return Object.fromEntries(
      Object.entries(entry).map(([key, value]) => [
        key,
        mapEntryStrings(value, fn)
      ])
    )
  }
  return entry
}

const mapEntry = (
  entry: EntryType | null,
  fn: (text: string) => string
): EntryType | null =>
  entry === null ? null : (mapEntryStrings(entry, fn) as EntryType)

/** Maps every text Jev reads: instructions and criteria of every question. */
function mapQuestionTexts(
  question: QuestionDef,
  fn: (text: string) => string
): QuestionDef {
  const instructions = mapEntry(question.instructions, fn) ?? ''
  switch (question.type) {
    case 'choice':
      return {
        ...question,
        instructions,
        criteria: Object.fromEntries(
          Object.entries(question.criteria).map(([option, entry]) => [
            option,
            mapEntry(entry, fn)
          ])
        )
      }
    case 'score':
      return {
        ...question,
        instructions,
        levels: question.levels.map(level => ({
          ...level,
          criteria: mapEntry(level.criteria, fn)
        }))
      }
    case 'boolean': {
      if (!question.criteria) return { ...question, instructions }
      const criteria: NonNullable<typeof question.criteria> = {}
      for (const outcome of ['true', 'false'] as const) {
        const entry = question.criteria[outcome]
        if (entry !== undefined) criteria[outcome] = mapEntry(entry, fn)
      }
      return { ...question, instructions, criteria }
    }
  }
}

// ── Input fields ─────────────────────────────────────────────────────────

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Backticked references to `from` (or a path under it) rewritten to `to`. */
export function renameBacktickedPath(
  text: string,
  from: string,
  to: string
): string {
  const pattern = new RegExp(`\`${escapeRegExp(from)}((?:\\.[^\`.]+)*)\``, 'g')
  return text.replace(pattern, (_, rest: string) => `\`${to}${rest}\``)
}

export function addField(
  definition: TemplateDefinition,
  field?: Partial<InputField>
): TemplateDefinition {
  const path = uniqueName(
    field?.path ?? 'campo',
    definition.input.fields.map(existing => existing.path)
  )
  const next: InputField = {
    type: 'string',
    required: false,
    ...field,
    path
  }
  const include = definition.state.include
  return {
    ...definition,
    input: { fields: [...definition.input.fields, next] },
    // An explicit `include` lists what is shared: a new field joins it, so
    // adding a field never silently hides it from Jev.
    state: include
      ? { ...definition.state, include: [...include, path] }
      : definition.state
  }
}

export function updateField(
  definition: TemplateDefinition,
  index: number,
  patch: Partial<InputField>
): TemplateDefinition {
  return {
    ...definition,
    input: {
      fields: definition.input.fields.map((field, position) =>
        position === index ? normalizeField({ ...field, ...patch }) : field
      )
    }
  }
}

/**
 * Keeps a field consistent with its type: `enum` values only for enums
 * (an empty list to fill in when switching to one), `maxLength` only for
 * strings; unset optionals are dropped.
 */
export function normalizeField(field: InputField): InputField {
  const next: InputField = { ...field }
  if (next.type === 'enum') next.enum = next.enum ?? []
  else delete next.enum
  if (next.type !== 'string') delete next.maxLength
  if (next.description === undefined || next.description === '') {
    delete next.description
  }
  if (!next.pii) delete next.pii
  if (next.maxLength === undefined) delete next.maxLength
  return next
}

export function removeField(
  definition: TemplateDefinition,
  index: number
): TemplateDefinition {
  const removed = definition.input.fields[index]
  if (!removed) return definition
  const include = definition.state.include
  return {
    ...definition,
    input: {
      fields: definition.input.fields.filter(
        (_, position) => position !== index
      )
    },
    state: include
      ? {
          ...definition.state,
          include: include.filter(path => path !== removed.path)
        }
      : definition.state
  }
}

export function moveField(
  definition: TemplateDefinition,
  index: number,
  offset: -1 | 1
): TemplateDefinition {
  return {
    ...definition,
    input: { fields: move(definition.input.fields, index, offset) }
  }
}

/**
 * Renames a field's path everywhere: the field, `state.include`, `input`
 * operands and backticked references in instructions and criteria.
 */
export function renameInputPath(
  definition: TemplateDefinition,
  from: string,
  to: string
): TemplateDefinition {
  if (from === to) return definition
  const renamed = mapOperands(definition, operand =>
    'input' in operand
      ? { input: replacePrefix(operand.input, from, to) }
      : operand
  )
  const include = renamed.state.include
  return {
    ...renamed,
    input: {
      fields: renamed.input.fields.map(field =>
        field.path === from ? { ...field, path: to } : field
      )
    },
    state: include
      ? {
          ...renamed.state,
          include: include.map(path => replacePrefix(path, from, to))
        }
      : renamed.state,
    questions: Object.fromEntries(
      Object.entries(renamed.questions).map(([id, question]) => [
        id,
        mapQuestionTexts(question, text => renameBacktickedPath(text, from, to))
      ])
    )
  }
}

// ── State ────────────────────────────────────────────────────────────────

export interface IncludeState {
  /** Field paths sent to Jev. */
  included: Set<string>
  /** `include` entries that name no declared field (nor a parent of one). */
  extras: string[]
  /** `include` is omitted: every field is sent. */
  all: boolean
}

export function includeState(definition: TemplateDefinition): IncludeState {
  const fields = definition.input.fields.map(field => field.path)
  const include = definition.state.include
  if (include === undefined) {
    return { included: new Set(fields), extras: [], all: true }
  }
  const included = new Set<string>()
  const extras: string[] = []
  for (const path of include) {
    const covered = fields.filter(field => isPathPrefix(path, field))
    if (covered.length === 0) extras.push(path)
    for (const field of covered) included.add(field)
  }
  return { included, extras, all: false }
}

/**
 * Includes or excludes a field from what Jev receives. When every field ends
 * up included (and nothing else is), `include` is omitted — the default.
 */
export function setFieldIncluded(
  definition: TemplateDefinition,
  path: string,
  included: boolean
): TemplateDefinition {
  const state = includeState(definition)
  if (included) state.included.add(path)
  else state.included.delete(path)
  return withInclude(definition, state.included, state.extras)
}

/** Sends every field (omits `include`), or none. */
export function setAllIncluded(
  definition: TemplateDefinition,
  included: boolean
): TemplateDefinition {
  const { extras } = includeState(definition)
  const paths = included ? definition.input.fields.map(field => field.path) : []
  return withInclude(definition, new Set(paths), included ? [] : extras)
}

/** Drops an `include` entry that names no field. */
export function removeIncludeExtra(
  definition: TemplateDefinition,
  extra: string
): TemplateDefinition {
  const state = includeState(definition)
  return withInclude(
    definition,
    state.included,
    state.extras.filter(path => path !== extra)
  )
}

function withInclude(
  definition: TemplateDefinition,
  included: Set<string>,
  extras: string[]
): TemplateDefinition {
  const fields = definition.input.fields.map(field => field.path)
  const { include: _, ...rest } = definition.state
  if (extras.length === 0 && fields.every(field => included.has(field))) {
    return { ...definition, state: rest }
  }
  return {
    ...definition,
    state: {
      ...rest,
      include: [...fields.filter(field => included.has(field)), ...extras]
    }
  }
}

export function setContext(
  definition: TemplateDefinition,
  context: Record<string, JsonValue> | undefined
): TemplateDefinition {
  const { context: _, ...rest } = definition.state
  return {
    ...definition,
    state:
      context === undefined || Object.keys(context).length === 0
        ? rest
        : { ...rest, context }
  }
}

// ── Questions ────────────────────────────────────────────────────────────

export const QUESTION_DEFAULT_IDS: Record<QuestionType, string> = {
  choice: 'categoria',
  score: 'puntuacion',
  boolean: 'respuesta'
}

/** A new, empty question body of `type` (instructions still to write). */
export function emptyQuestion(type: QuestionType): QuestionDef {
  switch (type) {
    case 'choice':
      return {
        type,
        instructions: '',
        criteria: { opcion_a: null, opcion_b: null }
      }
    case 'score':
      return {
        type,
        instructions: '',
        levels: [
          { label: 'bajo', criteria: null },
          { label: 'medio', criteria: null },
          { label: 'alto', criteria: null }
        ]
      }
    case 'boolean':
      return { type, instructions: '' }
  }
}

export function addQuestion(
  definition: TemplateDefinition,
  id: string,
  type: QuestionType
): TemplateDefinition {
  return {
    ...definition,
    questions: { ...definition.questions, [id]: emptyQuestion(type) }
  }
}

export function setQuestion(
  definition: TemplateDefinition,
  id: string,
  question: QuestionDef
): TemplateDefinition {
  return {
    ...definition,
    questions: Object.fromEntries(
      Object.entries(definition.questions).map(([key, value]) => [
        key,
        key === id ? question : value
      ])
    )
  }
}

export function removeQuestion(
  definition: TemplateDefinition,
  id: string
): TemplateDefinition {
  return {
    ...definition,
    questions: Object.fromEntries(
      Object.entries(definition.questions).filter(([key]) => key !== id)
    )
  }
}

export function moveQuestion(
  definition: TemplateDefinition,
  id: string,
  offset: -1 | 1
): TemplateDefinition {
  const entries = Object.entries(definition.questions)
  const index = entries.findIndex(([key]) => key === id)
  return {
    ...definition,
    questions: Object.fromEntries(move(entries, index, offset))
  }
}

/** Whether anything in the policy reads question `id`. */
export function isQuestionReferenced(
  definition: TemplateDefinition,
  id: string
): boolean {
  let found = false
  mapOperands(definition, operand => {
    if ('answer' in operand && operand.answer === id) found = true
    return operand
  })
  return (
    found ||
    [...definition.rules, ...definition.preconditions].some(
      rule =>
        (typeof rule.decision !== 'string' &&
          rule.decision.fromAnswer === id) ||
        rule.confidenceFrom === id
    )
  )
}

/** Renames a question id everywhere: its key, answer operands, `fromAnswer` and `confidenceFrom`. */
export function renameQuestion(
  definition: TemplateDefinition,
  from: string,
  to: string
): TemplateDefinition {
  if (from === to) return definition
  const renamed = mapOperands(definition, operand =>
    'answer' in operand && operand.answer === from
      ? { ...operand, answer: to }
      : operand
  )
  const renameRule = (rule: DecisionRule): DecisionRule => {
    const next: DecisionRule = { ...rule }
    if (
      typeof rule.decision !== 'string' &&
      rule.decision.fromAnswer === from
    ) {
      next.decision = { fromAnswer: to }
    }
    if (rule.confidenceFrom === from) next.confidenceFrom = to
    return next
  }
  return {
    ...renamed,
    questions: renameKey(renamed.questions, from, to),
    preconditions: renamed.preconditions.map(renameRule),
    rules: renamed.rules.map(renameRule)
  }
}

/** The option names / level labels a question answers with. */
export function questionOptions(question: QuestionDef): string[] {
  if (question.type === 'choice') return Object.keys(question.criteria)
  if (question.type === 'score')
    return question.levels.map(level => level.label)
  return []
}

/**
 * The question converted to another type, keeping what carries over:
 * instructions, note and `when` always; Choice options ↔ Score levels
 * (with their criteria); a boolean's true/false criteria become two options.
 */
export function convertQuestion(
  question: QuestionDef,
  type: QuestionType
): QuestionDef {
  if (question.type === type) return question
  const base = {
    instructions: question.instructions,
    ...(question.note === undefined ? {} : { note: question.note }),
    ...(question.when === undefined ? {} : { when: question.when })
  }

  let pairs: [string, EntryType | null][]
  if (question.type === 'choice') pairs = Object.entries(question.criteria)
  else if (question.type === 'score') {
    pairs = question.levels.map(level => [level.label, level.criteria])
  } else {
    pairs = [
      ['si', question.criteria?.true ?? null],
      ['no', question.criteria?.false ?? null]
    ]
  }

  switch (type) {
    case 'choice':
      return {
        type,
        ...base,
        criteria: Object.fromEntries(
          pairs.length > 0 ? pairs : Object.entries(emptyCriteria())
        )
      }
    case 'score':
      return {
        type,
        ...base,
        levels:
          pairs.length > 0
            ? pairs.map(([label, criteria]) => ({ label, criteria }))
            : (
                emptyQuestion('score') as Extract<
                  QuestionDef,
                  { type: 'score' }
                >
              ).levels
      }
    case 'boolean':
      return { type, ...base }
  }
}

const emptyCriteria = (): Record<string, EntryType | null> => ({
  opcion_a: null,
  opcion_b: null
})

// ── Options and levels ───────────────────────────────────────────────────

/** Whether an operand reads the option name / level label of question `id`. */
const readsOptionOf = (operand: Operand, id: string): boolean =>
  'answer' in operand &&
  operand.answer === id &&
  (operand.field === 'choice' || operand.field === 'level')

/**
 * Rewrites the option name `from` of question `id` to `to` wherever the
 * policy reads it: `prob` operands, and literal values compared with the
 * question's `choice` / `level`.
 */
function renameOptionReferences(
  definition: TemplateDefinition,
  id: string,
  from: string,
  to: string
): TemplateDefinition {
  const renameValue = (operand: Operand): Operand =>
    'value' in operand && operand.value === from ? { value: to } : operand

  const renameProb = (operand: Operand): Operand =>
    'answer' in operand &&
    operand.answer === id &&
    operand.field === 'prob' &&
    operand.option === from
      ? { ...operand, option: to }
      : operand

  const comparisons: ComparisonMapper = comparison => {
    const next = operandsOf(renameProb)(comparison)
    const { left, right } = next
    if (right === undefined) return next
    if (readsOptionOf(left, id)) {
      next.right = Array.isArray(right)
        ? right.map(renameValue)
        : renameValue(right)
    } else if (!Array.isArray(right) && readsOptionOf(right, id)) {
      next.left = renameValue(left)
    }
    return next
  }

  return mapPolicy(definition, comparisons, renameProb)
}

/** Renames a Choice option (keeping its order and criteria) and its references. */
export function renameOption(
  definition: TemplateDefinition,
  id: string,
  from: string,
  to: string
): TemplateDefinition {
  const question = definition.questions[id]
  if (from === to || question?.type !== 'choice') return definition
  return renameOptionReferences(
    setQuestion(definition, id, {
      ...question,
      criteria: renameKey(question.criteria, from, to)
    }),
    id,
    from,
    to
  )
}

/** Renames a Score level and its references. */
export function renameLevel(
  definition: TemplateDefinition,
  id: string,
  index: number,
  to: string
): TemplateDefinition {
  const question = definition.questions[id]
  if (question?.type !== 'score') return definition
  const from = question.levels[index]?.label
  if (from === undefined || from === to) return definition
  return renameOptionReferences(
    setQuestion(definition, id, {
      ...question,
      levels: question.levels.map((level, position) =>
        position === index ? { ...level, label: to } : level
      )
    }),
    id,
    from,
    to
  )
}

// ── Decisions ────────────────────────────────────────────────────────────

export function addDecision(
  definition: TemplateDefinition,
  decision: DecisionDef
): TemplateDefinition {
  return { ...definition, decisions: [...definition.decisions, decision] }
}

export function updateDecision(
  definition: TemplateDefinition,
  index: number,
  patch: Partial<DecisionDef>
): TemplateDefinition {
  return {
    ...definition,
    decisions: definition.decisions.map((decision, position) => {
      if (position !== index) return decision
      const next: DecisionDef = { ...decision, ...patch }
      if (!next.description) delete next.description
      if (next.minConfidence === undefined) delete next.minConfidence
      if (!next.alwaysReview) delete next.alwaysReview
      return next
    })
  }
}

export function removeDecision(
  definition: TemplateDefinition,
  index: number
): TemplateDefinition {
  return {
    ...definition,
    decisions: definition.decisions.filter((_, position) => position !== index)
  }
}

export function moveDecision(
  definition: TemplateDefinition,
  index: number,
  offset: -1 | 1
): TemplateDefinition {
  return {
    ...definition,
    decisions: move(definition.decisions, index, offset)
  }
}

/**
 * Renames a decision label everywhere a rule decides it: its declaration,
 * rule and precondition decisions, and the fallback.
 */
export function renameLabel(
  definition: TemplateDefinition,
  from: string,
  to: string
): TemplateDefinition {
  if (from === to) return definition
  const renameRule = (rule: DecisionRule): DecisionRule =>
    rule.decision === from ? { ...rule, decision: to } : rule
  return {
    ...definition,
    decisions: definition.decisions.map(decision =>
      decision.label === from ? { ...decision, label: to } : decision
    ),
    preconditions: definition.preconditions.map(renameRule),
    rules: definition.rules.map(renameRule),
    fallback:
      definition.fallback.decision === from
        ? { decision: to }
        : definition.fallback
  }
}

// ── Classify: options and labels move together ───────────────────────────

/**
 * In a Classify definition the linked Choice question's options *are* the
 * labels: these keep both in sync (rename, add, remove). `questionId` is the
 * linked question (see `linkedChoiceQuestion`).
 */
export function renameClassifyLabel(
  definition: TemplateDefinition,
  questionId: string,
  from: string,
  to: string
): TemplateDefinition {
  const question = definition.questions[questionId]
  const withOption =
    question?.type === 'choice' && Object.hasOwn(question.criteria, from)
      ? renameOption(definition, questionId, from, to)
      : definition
  return definition.decisions.some(decision => decision.label === from)
    ? renameLabel(withOption, from, to)
    : withOption
}

export function addClassifyLabel(
  definition: TemplateDefinition,
  questionId: string,
  name?: string
): TemplateDefinition {
  const question = definition.questions[questionId]
  if (question?.type !== 'choice') return definition
  const label = uniqueName(name ?? 'opcion', [
    ...Object.keys(question.criteria),
    ...definition.decisions.map(decision => decision.label)
  ])
  const [first] = definition.decisions
  const shared = first?.minConfidence
  const sameThreshold = definition.decisions.every(
    decision => decision.minConfidence === shared
  )
  const withOption = setQuestion(definition, questionId, {
    ...question,
    criteria: { ...question.criteria, [label]: null }
  })
  return addDecision(withOption, {
    label,
    ...(sameThreshold && shared !== undefined ? { minConfidence: shared } : {})
  })
}

export function removeClassifyLabel(
  definition: TemplateDefinition,
  questionId: string,
  label: string
): TemplateDefinition {
  const question = definition.questions[questionId]
  const withoutOption =
    question?.type === 'choice'
      ? setQuestion(definition, questionId, {
          ...question,
          criteria: Object.fromEntries(
            Object.entries(question.criteria).filter(([key]) => key !== label)
          )
        })
      : definition
  return {
    ...withoutOption,
    decisions: withoutOption.decisions.filter(
      decision => decision.label !== label
    )
  }
}

// ── Policy ───────────────────────────────────────────────────────────────

export type PolicySectionsValue = Pick<
  TemplateDefinition,
  'preconditions' | 'signals' | 'flagRules' | 'rules' | 'fallback'
>

export const policySections = (
  definition: TemplateDefinition
): PolicySectionsValue => ({
  preconditions: definition.preconditions,
  signals: definition.signals,
  flagRules: definition.flagRules,
  rules: definition.rules,
  fallback: definition.fallback
})

export const setPolicySections = (
  definition: TemplateDefinition,
  sections: PolicySectionsValue
): TemplateDefinition => ({ ...definition, ...sections })

// ── Lists ────────────────────────────────────────────────────────────────

/** `items` with the one at `index` moved by `offset` (unchanged at the ends). */
export function move<T>(
  items: readonly T[],
  index: number,
  offset: -1 | 1
): T[] {
  const target = index + offset
  if (
    index < 0 ||
    index >= items.length ||
    target < 0 ||
    target >= items.length
  ) {
    return [...items]
  }
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item as T)
  return next
}
