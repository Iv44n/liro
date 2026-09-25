import {
  type Comparison,
  type Condition,
  type DecisionRule,
  NEEDS_REVIEW,
  type Operand,
  type SignalDef,
  type TemplateDefinition
} from '#modules/templates/definition'
import { getPath } from '#modules/templates/paths'
import type {
  JsonObject,
  JsonValue,
  PolicyContext,
  PolicyResult,
  ResolvedAnswers,
  ReviewReason
} from './types'

/**
 * The pure decision policy — the product's core. Given a definition, the run
 * input, the resolved answers and the run's time, it derives signals, flags
 * and the decision. No I/O and no clock of its own, so a stored run can be
 * replayed (or simulated against another version) and always yields the same
 * result.
 *
 * Conditions use three-valued logic (see `Condition` in `definition.ts`): a
 * comparison over a missing/null value, or over a value of the wrong type, is
 * *unknown*, and a rule only matches when its condition is exactly `true` —
 * so nothing ever fires for lack of evidence.
 */

/** A condition's outcome; `null` = unknown. */
export type Truth = boolean | null

/** Everything an operand can read during one evaluation. */
export interface PolicyScope {
  input: JsonObject
  answers: ResolvedAnswers
  signals: Record<string, number | null>
  flags: ReadonlySet<string>
  now: Date
}

/** What preconditions and question `when`s see: the input and the run's time. */
export interface InputContext {
  input: JsonObject
  now: Date
}

const DAY_MS = 86_400_000

/** Own properties only: a key such as `constructor` must not reach `Object.prototype`. */
const own = <T>(record: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(record, key) ? record[key] : undefined

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Deep JSON equality: arrays are ordered, object key order is irrelevant. */
function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => jsonEqual(item, b[index]))
    )
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false
  const keys = Object.keys(a)
  return (
    keys.length === Object.keys(b).length &&
    keys.every(key => Object.hasOwn(b, key) && jsonEqual(a[key], b[key]))
  )
}

// ── Operands ─────────────────────────────────────────────────────────────

const probabilityOf = (
  probabilities: Record<string, number> | null,
  option: string | undefined
): number | null =>
  probabilities && option !== undefined
    ? (own(probabilities, option) ?? null)
    : null

function answerField(
  operand: Extract<Operand, { answer: string }>,
  answers: ResolvedAnswers
): JsonValue {
  const answer = own(answers, operand.answer)
  if (!answer) return null
  const { field, option } = operand

  switch (answer.type) {
    case 'choice':
      if (field === 'choice') return answer.choice
      if (field === 'confidence') return answer.confidence
      if (field === 'prob') return probabilityOf(answer.probabilities, option)
      return null
    case 'score':
      if (field === 'level') return answer.level
      if (field === 'score') return answer.score
      if (field === 'score_norm') return answer.scoreNorm
      if (field === 'confidence') return answer.confidence
      if (field === 'prob') return probabilityOf(answer.probabilities, option)
      return null
    case 'boolean':
      if (field === 'probability') return answer.probability
      if (field === 'confidence') return answer.confidence
      return null
    default:
      return null
  }
}

/**
 * The value an operand reads. Never `undefined`: anything missing (a skipped
 * question, a field the answer type doesn't have, an absent input path, a
 * signal not computed yet) is `null`. Flags are always `true`/`false`.
 */
export function resolveOperand(
  operand: Operand,
  scope: PolicyScope
): JsonValue {
  if ('answer' in operand) return answerField(operand, scope.answers)
  if ('signal' in operand) return own(scope.signals, operand.signal) ?? null
  if ('flag' in operand) return scope.flags.has(operand.flag)
  if ('input' in operand) return getPath(scope.input, operand.input) ?? null
  return operand.value ?? null
}

// ── Conditions ───────────────────────────────────────────────────────────

const numeric = (
  left: JsonValue,
  right: JsonValue,
  test: (left: number, right: number) => boolean
): Truth =>
  isFiniteNumber(left) && isFiniteNumber(right) ? test(left, right) : null

const lengthOf = (value: JsonValue): number | null =>
  typeof value === 'string' || Array.isArray(value) ? value.length : null

/**
 * ISO 8601 date (`2026-01-01`) or date-time (`2026-01-01T10:00`, optional
 * seconds/fraction, optional `Z`/`±hh:mm` offset). Anything looser is not a
 * date: `Date.parse` would accept `"5"` or `"Jan 1 2026"` in the server's
 * local time zone, and a replay on another server would decide differently.
 */
const ISO_DATE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/

const isLeapYear = (year: number) =>
  (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** Epoch ms of an ISO date/date-time string (UTC unless it has an offset) or an epoch-ms number. */
function epochMs(value: JsonValue): number | null {
  if (isFiniteNumber(value)) return value
  if (typeof value !== 'string') return null
  const match = ISO_DATE.exec(value)
  if (!match) return null
  const [, year, month, day, hour, minute, second, offset] = match
  const monthDays =
    Number(month) === 2 && isLeapYear(Number(year))
      ? 29
      : DAYS_IN_MONTH[Number(month) - 1]
  if (
    monthDays === undefined ||
    Number(day) < 1 ||
    Number(day) > monthDays ||
    Number(hour ?? 0) > 23 ||
    Number(minute ?? 0) > 59 ||
    Number(second ?? 0) > 59
  ) {
    return null
  }
  // A date-time without an offset is read as UTC, like a date-only string.
  const utc = hour !== undefined && offset === undefined ? `${value}Z` : value
  const ms = Date.parse(utc)
  return Number.isFinite(ms) ? ms : null
}

function dates(
  left: JsonValue,
  right: JsonValue,
  test: (left: number, right: number) => boolean
): Truth {
  const from = epochMs(left)
  const to = epochMs(right)
  return from === null || to === null ? null : test(from, to)
}

function daysSince(
  left: JsonValue,
  right: JsonValue,
  now: Date,
  test: (days: number, limit: number) => boolean
): Truth {
  const from = epochMs(left)
  const nowMs = now.getTime()
  if (from === null || !Number.isFinite(nowMs) || !isFiniteNumber(right)) {
    return null
  }
  return test((nowMs - from) / DAY_MS, right)
}

function contains(left: JsonValue, right: JsonValue): Truth {
  if (typeof left === 'string') {
    return typeof right === 'string'
      ? left.toLowerCase().includes(right.toLowerCase())
      : null
  }
  if (Array.isArray(left)) return left.some(item => jsonEqual(item, right))
  return null
}

/**
 * `in`: a list of operands (null items are ignored — but when every item is
 * null there is nothing to compare against, so the result is unknown rather
 * than a `false` that `not` would turn into a match), or one operand that
 * must resolve to an array. `in: []` is false.
 */
function memberOf(
  left: JsonValue,
  right: Comparison['right'],
  scope: PolicyScope
): Truth {
  if (right === undefined) return null
  if (Array.isArray(right)) {
    const candidates = right
      .map(operand => resolveOperand(operand, scope))
      .filter(candidate => candidate !== null)
    if (candidates.length === 0 && right.length > 0) return null
    return candidates.some(candidate => jsonEqual(left, candidate))
  }
  const candidates = resolveOperand(right, scope)
  if (!Array.isArray(candidates)) return null
  return candidates.some(candidate => jsonEqual(left, candidate))
}

function between(
  left: JsonValue,
  right: Comparison['right'],
  scope: PolicyScope
): Truth {
  if (!Array.isArray(right) || right.length !== 2) return null
  const [low, high] = right.map(operand => resolveOperand(operand, scope))
  if (!isFiniteNumber(left) || !isFiniteNumber(low) || !isFiniteNumber(high)) {
    return null
  }
  return left >= low && left <= high
}

function compare(comparison: Comparison, scope: PolicyScope): Truth {
  const { op, right } = comparison
  const left = resolveOperand(comparison.left, scope)
  if (op === 'exists') return left !== null
  if (left === null) return null
  if (op === 'in') return memberOf(left, right, scope)
  if (op === 'between') return between(left, right, scope)

  if (right === undefined || Array.isArray(right)) return null
  const value = resolveOperand(right, scope)
  if (value === null) return null

  switch (op) {
    case 'eq':
      return jsonEqual(left, value)
    case 'neq':
      return !jsonEqual(left, value)
    case 'gt':
      return numeric(left, value, (a, b) => a > b)
    case 'gte':
      return numeric(left, value, (a, b) => a >= b)
    case 'lt':
      return numeric(left, value, (a, b) => a < b)
    case 'lte':
      return numeric(left, value, (a, b) => a <= b)
    case 'contains':
      return contains(left, value)
    case 'len_gt':
      return numeric(lengthOf(left), value, (a, b) => a > b)
    case 'len_lt':
      return numeric(lengthOf(left), value, (a, b) => a < b)
    case 'before':
      return dates(left, value, (a, b) => a < b)
    case 'after':
      return dates(left, value, (a, b) => a > b)
    case 'days_since_gt':
      return daysSince(left, value, scope.now, (days, limit) => days > limit)
    case 'days_since_lt':
      return daysSince(left, value, scope.now, (days, limit) => days < limit)
    default:
      // An operator this engine doesn't know (a definition that skipped the
      // schema): unknown, never `undefined` — `not undefined` would be true.
      return null
  }
}

/**
 * Three-valued evaluation. `all` is false if any child is false, else unknown
 * if any is unknown (`all: []` is true); `any` is true if any child is true,
 * else unknown if any is unknown (`any: []` is false); `not` keeps unknown.
 */
export function evaluateCondition(
  condition: Condition,
  scope: PolicyScope
): Truth {
  if ('all' in condition) {
    let unknown = false
    for (const child of condition.all) {
      const truth = evaluateCondition(child, scope)
      if (truth === false) return false
      if (truth === null) unknown = true
    }
    return unknown ? null : true
  }
  if ('any' in condition) {
    let unknown = false
    for (const child of condition.any) {
      const truth = evaluateCondition(child, scope)
      if (truth === true) return true
      if (truth === null) unknown = true
    }
    return unknown ? null : false
  }
  if ('not' in condition) {
    const truth = evaluateCondition(condition.not, scope)
    return truth === true ? false : truth === false ? true : null
  }
  return compare(condition, scope)
}

// ── Signals and flags ────────────────────────────────────────────────────

const finiteOrNull = (value: number): number | null =>
  Number.isFinite(value) ? value : null

function computeSignal(signal: SignalDef, scope: PolicyScope): number | null {
  if (signal.kind === 'weighted') {
    let total = 0
    let weights = 0
    for (const term of signal.terms) {
      const value = resolveOperand(term.operand, scope)
      if (!isFiniteNumber(value)) continue
      total += term.weight * (term.invert ? 1 - value : value)
      weights += term.weight
    }
    return weights > 0 ? finiteOrNull(total / weights) : null
  }

  const values = signal.of
    .map(operand => resolveOperand(operand, scope))
    .filter(isFiniteNumber)
  if (values.length === 0) return null
  if (signal.kind === 'min') return Math.min(...values)
  if (signal.kind === 'max') return Math.max(...values)
  return finiteOrNull(
    values.reduce((sum, value) => sum + value, 0) / values.length
  )
}

/**
 * Signals in array order. Each one reads the signals defined before it (a
 * forward or self reference is `null`); non-numeric and null values are
 * dropped, and a weighted signal renormalizes over the weights it kept.
 * Flags are computed later, so a flag operand here always reads `false`.
 */
export function computeSignals(
  definition: Pick<TemplateDefinition, 'signals'>,
  scope: Omit<PolicyScope, 'signals' | 'flags'>
): Record<string, number | null> {
  const signals: Record<string, number | null> = {}
  const reading: PolicyScope = { ...scope, signals, flags: new Set() }
  for (const signal of definition.signals) {
    signals[signal.name] = computeSignal(signal, reading)
  }
  return signals
}

/**
 * Flag rules in order; every matching rule adds its flags, and each rule
 * sees the flags added by the rules before it. De-duplicated, first-seen order.
 */
export function computeFlags(
  definition: Pick<TemplateDefinition, 'flagRules'>,
  scope: Omit<PolicyScope, 'flags'>
): string[] {
  const flags = new Set<string>()
  const reading: PolicyScope = { ...scope, flags }
  for (const rule of definition.flagRules) {
    if (evaluateCondition(rule.when, reading) !== true) continue
    for (const flag of rule.flags) flags.add(flag)
  }
  return [...flags]
}

// ── Decisions ────────────────────────────────────────────────────────────

type Outcome = Pick<PolicyResult, 'decision' | 'suggestion' | 'reviewReason'>

const inputScope = ({ input, now }: InputContext): PolicyScope => ({
  input,
  now,
  answers: {},
  signals: {},
  flags: new Set()
})

const review = (
  reviewReason: ReviewReason,
  suggestion: string | null
): Outcome => ({ decision: NEEDS_REVIEW, suggestion, reviewReason })

/** A label, or the chosen option / most probable level; `null` when a `fromAnswer` can't resolve. */
function resolveDecision(
  target: DecisionRule['decision'],
  answers: ResolvedAnswers
): string | null {
  if (typeof target === 'string') return target
  const answer = own(answers, target.fromAnswer)
  if (answer?.type === 'choice') return answer.choice
  if (answer?.type === 'score') return answer.level
  return null
}

function ruleConfidence(
  rule: DecisionRule,
  answers: ResolvedAnswers
): number | null {
  const source =
    rule.confidenceFrom ??
    (typeof rule.decision === 'string' ? undefined : rule.decision.fromAnswer)
  if (source === undefined) return null
  // A non-finite confidence is no evidence: `null`, like a missing one.
  const confidence = own(answers, source)?.confidence
  return isFiniteNumber(confidence) ? confidence : null
}

/**
 * The first rule whose condition is exactly true and whose decision resolves.
 * With `skipReview`, rules resolving to `needs_review` are passed over (used
 * to find what to suggest to the reviewer).
 */
function firstMatch(
  rules: readonly DecisionRule[],
  scope: PolicyScope,
  skipReview = false
): { rule: DecisionRule; label: string } | null {
  for (const rule of rules) {
    if (skipReview && rule.decision === NEEDS_REVIEW) continue
    if (evaluateCondition(rule.when, scope) !== true) continue
    const label = resolveDecision(rule.decision, scope.answers)
    if (label === null || (skipReview && label === NEEDS_REVIEW)) continue
    return { rule, label }
  }
  return null
}

/**
 * A declared label's policy: `alwaysReview` sends it to review; so does a
 * `minConfidence` that isn't met — or can't be checked because there is no
 * confidence (fail-closed). Either way the label becomes the suggestion.
 */
function labelPolicy(
  definition: Pick<TemplateDefinition, 'decisions'>,
  label: string,
  confidence: number | null,
  gateConfidence: boolean
): Outcome {
  const policy = definition.decisions.find(d => d.label === label)
  if (policy?.alwaysReview) return review('always_review', label)
  const minConfidence = policy?.minConfidence
  if (
    gateConfidence &&
    minConfidence !== undefined &&
    (!isFiniteNumber(confidence) || confidence < minConfidence)
  ) {
    return review('low_confidence', label)
  }
  return { decision: label, suggestion: label, reviewReason: null }
}

/**
 * What to offer the reviewer when a rule or the fallback asked for review:
 * the first other rule that matches with a real label (no label policy), else
 * the fallback label, else nothing.
 */
function reviewSuggestion(
  definition: Pick<TemplateDefinition, 'rules' | 'fallback'>,
  scope: PolicyScope
): string | null {
  const match = firstMatch(definition.rules, scope, true)
  if (match) return match.label
  const fallback = definition.fallback.decision
  return fallback === NEEDS_REVIEW ? null : fallback
}

/**
 * Question ids to send to the evaluator, in definition order: those without a
 * `when`, or whose `when` is exactly true (unknown means not asked).
 */
export function questionsToAsk(
  definition: Pick<TemplateDefinition, 'questions'>,
  context: InputContext
): string[] {
  const scope = inputScope(context)
  return Object.entries(definition.questions)
    .filter(
      ([, question]) =>
        !question.when || evaluateCondition(question.when, scope) === true
    )
    .map(([id]) => id)
}

/**
 * The first matching precondition decides without calling the evaluator;
 * `null` when none matches. Preconditions read only the input (answers are
 * all null, so a `fromAnswer` precondition never resolves and is skipped).
 * They are deterministic business rules: their confidence is `null` and only
 * `alwaysReview` applies to their label — `minConfidence` does not.
 */
export function evaluatePreconditions(
  definition: Pick<TemplateDefinition, 'preconditions' | 'decisions'>,
  context: InputContext
): PolicyResult | null {
  const match = firstMatch(definition.preconditions, inputScope(context))
  if (!match) return null
  const { rule, label } = match
  const outcome =
    label === NEEDS_REVIEW
      ? review('rule', null)
      : labelPolicy(definition, label, null, false)
  return {
    ...outcome,
    confidence: null,
    rule: rule.id,
    stage: 'precondition',
    flags: [],
    signals: {}
  }
}

/**
 * Signals → flags → rules → fallback, for a run whose questions were answered.
 * Preconditions are not evaluated here (see `decide`).
 */
export function evaluatePolicy(
  definition: TemplateDefinition,
  context: PolicyContext
): PolicyResult {
  const { input, answers, now } = context
  const signals = computeSignals(definition, { input, answers, now })
  const flags = computeFlags(definition, { input, answers, now, signals })
  const scope: PolicyScope = {
    input,
    answers,
    now,
    signals,
    flags: new Set(flags)
  }

  const match = firstMatch(definition.rules, scope)
  if (match) {
    const { rule, label } = match
    const confidence = ruleConfidence(rule, answers)
    const outcome =
      label === NEEDS_REVIEW
        ? review('rule', reviewSuggestion(definition, scope))
        : labelPolicy(definition, label, confidence, true)
    return {
      ...outcome,
      confidence,
      rule: rule.id,
      stage: 'rule',
      flags,
      signals
    }
  }

  const label = definition.fallback.decision
  const outcome =
    label === NEEDS_REVIEW
      ? review('fallback', reviewSuggestion(definition, scope))
      : labelPolicy(definition, label, null, true)
  return {
    ...outcome,
    confidence: null,
    rule: null,
    stage: 'fallback',
    flags,
    signals
  }
}

/** Preconditions, then the policy: the whole decision for replay and simulation. */
export function decide(
  definition: TemplateDefinition,
  context: PolicyContext
): PolicyResult {
  return (
    evaluatePreconditions(definition, context) ??
    evaluatePolicy(definition, context)
  )
}
