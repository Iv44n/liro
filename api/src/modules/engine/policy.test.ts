import { describe, expect, test } from 'bun:test'
import {
  type Condition,
  NEEDS_REVIEW,
  type Operand,
  type Operator,
  type TemplateDefinitionInput,
  templateDefinitionSchema
} from '#modules/templates/definition'
import {
  computeFlags,
  computeSignals,
  decide,
  evaluateCondition,
  evaluatePolicy,
  evaluatePreconditions,
  type PolicyScope,
  questionsToAsk,
  resolveOperand,
  type Truth
} from './policy'
import type {
  JsonObject,
  JsonValue,
  PolicyResult,
  ResolvedAnswer,
  ResolvedAnswers
} from './types'

// ── Helpers ──────────────────────────────────────────────────────────────

const NOW = new Date('2026-09-22T12:00:00.000Z')
const DAY_MS = 86_400_000
const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS)

const define = (definition: Partial<TemplateDefinitionInput> = {}) =>
  templateDefinitionSchema.parse({
    kind: 'custom',
    input: { fields: [] },
    decisions: [],
    ...definition
  })

const scope = (overrides: Partial<PolicyScope> = {}): PolicyScope => ({
  input: {},
  answers: {},
  signals: {},
  flags: new Set(),
  now: NOW,
  ...overrides
})

const v = (value: JsonValue): Operand => ({ value })
const inp = (input: string): Operand => ({ input })
const sig = (signal: string): Operand => ({ signal })
const flag = (name: string): Operand => ({ flag: name })
const cmp = (
  op: Operator,
  left: Operand,
  right?: Operand | Operand[]
): Condition => (right === undefined ? { op, left } : { op, left, right })

/** Conditions that are true, false and unknown. */
const T = cmp('eq', v(1), v(1))
const F = cmp('eq', v(1), v(2))
const U = cmp('eq', inp('missing'), v(1))

const choice = (
  value: string,
  confidence: number | null,
  probabilities: Record<string, number> | null = null
): ResolvedAnswer => ({
  type: 'choice',
  choice: value,
  probabilities,
  confidence
})

const bool = (probability: number): ResolvedAnswer => ({
  type: 'boolean',
  probability,
  confidence: Math.abs(2 * probability - 1)
})

/** Every result must carry a review reason iff it goes to review. */
function expectConsistent(result: PolicyResult) {
  expect(result.reviewReason !== null).toBe(result.decision === NEEDS_REVIEW)
  return result
}

const context = (answers: ResolvedAnswers = {}, input: JsonObject = {}) => ({
  input,
  answers,
  now: NOW
})

// ── Operands ─────────────────────────────────────────────────────────────

describe('resolveOperand', () => {
  const answers: ResolvedAnswers = {
    category: choice('bug', 0.55, { bug: 0.7, billing: 0.2, other: 0.1 }),
    bare: choice('bug', null),
    // argmax is `high` (index 2) while round(score) would be `medium`.
    severity: {
      type: 'score',
      score: 1.4,
      scoreNorm: 0.7,
      level: 'high',
      levelIndex: 2,
      probabilities: { low: 0.1, medium: 0.4, high: 0.5 },
      confidence: 0.25
    },
    bare_score: {
      type: 'score',
      score: 1,
      scoreNorm: 0.5,
      level: 'medium',
      levelIndex: 1,
      probabilities: null,
      confidence: null
    },
    urgent: { type: 'boolean', probability: 0.8, confidence: 0.6 },
    skipped: null
  }
  const answerScope = scope({ answers })
  const read = (
    answer: string,
    field: Extract<Operand, { answer: string }>['field'],
    option?: string
  ): Operand =>
    option === undefined ? { answer, field } : { answer, field, option }

  test.each<[string, Operand, JsonValue]>([
    ['choice.choice', read('category', 'choice'), 'bug'],
    ['choice.confidence', read('category', 'confidence'), 0.55],
    ['choice.prob', read('category', 'prob', 'billing'), 0.2],
    ['choice.prob of an unknown option', read('category', 'prob', 'x'), null],
    [
      'choice.prob of a prototype key',
      read('category', 'prob', 'constructor'),
      null
    ],
    ['choice.prob without an option', read('category', 'prob'), null],
    ['choice.prob without probabilities', read('bare', 'prob', 'bug'), null],
    [
      'choice.confidence without probabilities',
      read('bare', 'confidence'),
      null
    ],
    ['choice.level', read('category', 'level'), null],
    ['choice.score', read('category', 'score'), null],
    ['choice.score_norm', read('category', 'score_norm'), null],
    ['choice.probability', read('category', 'probability'), null],
    ['score.level', read('severity', 'level'), 'high'],
    ['score.score', read('severity', 'score'), 1.4],
    ['score.score_norm', read('severity', 'score_norm'), 0.7],
    ['score.confidence', read('severity', 'confidence'), 0.25],
    ['score.prob (level label)', read('severity', 'prob', 'medium'), 0.4],
    ['score.prob of an unknown level', read('severity', 'prob', '1'), null],
    [
      'score.prob without probabilities',
      read('bare_score', 'prob', 'low'),
      null
    ],
    [
      'score.confidence without probabilities',
      read('bare_score', 'confidence'),
      null
    ],
    ['score.choice', read('severity', 'choice'), null],
    ['score.probability', read('severity', 'probability'), null],
    ['boolean.probability', read('urgent', 'probability'), 0.8],
    ['boolean.confidence', read('urgent', 'confidence'), 0.6],
    ['boolean.choice', read('urgent', 'choice'), null],
    ['boolean.level', read('urgent', 'level'), null],
    ['boolean.score', read('urgent', 'score'), null],
    ['boolean.prob', read('urgent', 'prob', 'yes'), null],
    ['a question that was not asked', read('skipped', 'confidence'), null],
    ['a question missing from the answers', read('nope', 'choice'), null],
    ['a prototype key as the question', read('constructor', 'choice'), null]
  ])('%s', (_name, operand, expected) => {
    expect(resolveOperand(operand, answerScope)).toEqual(expected)
  })

  test('an answer of an unexpected type reads as null', () => {
    const weird = { type: 'weird' } as unknown as ResolvedAnswer
    expect(
      resolveOperand(read('odd', 'choice'), scope({ answers: { odd: weird } }))
    ).toBeNull()
  })

  test('signals: computed value, null, missing and prototype keys', () => {
    const withSignals = scope({ signals: { risk: 0.4, empty: null } })
    expect(resolveOperand(sig('risk'), withSignals)).toBe(0.4)
    expect(resolveOperand(sig('empty'), withSignals)).toBeNull()
    expect(resolveOperand(sig('later'), withSignals)).toBeNull()
    expect(resolveOperand(sig('constructor'), withSignals)).toBeNull()
  })

  test('flags are true or false, never null', () => {
    const withFlags = scope({ flags: new Set(['urgent']) })
    expect(resolveOperand(flag('urgent'), withFlags)).toBe(true)
    expect(resolveOperand(flag('spam'), withFlags)).toBe(false)
  })

  test.each<[string, string, JsonValue]>([
    ['a nested path', 'ticket.subject', 'Hi'],
    ['a whole object', 'ticket.meta', { tags: ['a'] }],
    ['a missing leaf', 'ticket.missing', null],
    ['a path through a string', 'ticket.subject.length', null],
    ['a missing root', 'customer.plan', null],
    ['an explicit null', 'ticket.closed', null],
    ['zero', 'counts.zero', 0],
    ['false', 'counts.no', false],
    ['an empty string', 'counts.blank', '']
  ])('input: %s', (_name, path, expected) => {
    const input: JsonObject = {
      ticket: { subject: 'Hi', meta: { tags: ['a'] }, closed: null },
      counts: { zero: 0, no: false, blank: '' }
    }
    expect(resolveOperand(inp(path), scope({ input }))).toEqual(expected)
  })

  test.each<[JsonValue]>([['x'], [0], [false], [null], [[1, 2]], [{ a: 1 }]])(
    'value %p is returned as is',
    value => {
      expect(resolveOperand(v(value), scope())).toEqual(value)
    }
  )

  test('never returns undefined, even for a malformed value operand', () => {
    const operand = { value: undefined } as unknown as Operand
    expect(resolveOperand(operand, scope())).toBeNull()
  })
})

// ── Three-valued logic ───────────────────────────────────────────────────

describe('evaluateCondition: three-valued logic', () => {
  test.each<[string, Condition, Truth]>([
    ['true', T, true],
    ['false', F, false],
    ['unknown', U, null],
    ['not true', { not: T }, false],
    ['not false', { not: F }, true],
    ['not unknown', { not: U }, null],
    ['not not unknown', { not: { not: U } }, null],
    ['all []', { all: [] }, true],
    ['all [T, T]', { all: [T, T] }, true],
    ['all [T, U]', { all: [T, U] }, null],
    ['all [U]', { all: [U] }, null],
    ['all [F, U]', { all: [F, U] }, false],
    ['all [U, F]', { all: [U, F] }, false],
    ['any []', { any: [] }, false],
    ['any [F, F]', { any: [F, F] }, false],
    ['any [F, U]', { any: [F, U] }, null],
    ['any [U, T]', { any: [U, T] }, true],
    ['any [T, U]', { any: [T, U] }, true],
    ['not all [T, U]', { not: { all: [T, U] } }, null],
    ['not any [F, F]', { not: { any: [F, F] } }, true],
    ['all [any [F, T], not F]', { all: [{ any: [F, T] }, { not: F }] }, true],
    ['all [any [F, T], not U]', { all: [{ any: [F, T] }, { not: U }] }, null],
    ['any [all [T, U], not T]', { any: [{ all: [T, U] }, { not: T }] }, null]
  ])('%s', (_name, condition, expected) => {
    expect(evaluateCondition(condition, scope())).toBe(expected)
  })
})

// ── Operators ────────────────────────────────────────────────────────────

describe('evaluateCondition: operators', () => {
  const input: JsonObject = {
    n: 5,
    zero: 0,
    text: 'Hello World',
    empty: '',
    yes: true,
    tags: ['vip', 'beta'],
    items: [{ id: 1 }, { id: 2 }],
    obj: { a: 1, b: [1, 2] },
    nothing: null,
    tenDaysAgo: ago(10).toISOString(),
    tenDaysAgoMs: ago(10).getTime(),
    dayAndHalfAgo: ago(1.5).toISOString(),
    dateOnly: '2026-09-21',
    inTwoDays: ago(-2).toISOString(),
    notADate: 'not a date'
  }
  const operatorScope = scope({
    input,
    signals: { infinite: Number.POSITIVE_INFINITY, nan: Number.NaN },
    answers: { skipped: null }
  })

  test.each<[string, Condition, Truth]>([
    // eq / neq: deep JSON equality, either side null → unknown.
    ['eq numbers', cmp('eq', inp('n'), v(5)), true],
    ['eq different numbers', cmp('eq', inp('n'), v(6)), false],
    ['eq strings', cmp('eq', inp('text'), v('Hello World')), true],
    ['eq is case-sensitive', cmp('eq', inp('text'), v('hello world')), false],
    ['eq number vs string', cmp('eq', v(1), v('1')), false],
    [
      'eq objects ignore key order',
      cmp('eq', inp('obj'), v({ b: [1, 2], a: 1 })),
      true
    ],
    [
      'eq objects with a missing key',
      cmp('eq', inp('obj'), v({ a: 1 })),
      false
    ],
    [
      'eq objects with an extra key',
      cmp('eq', inp('obj'), v({ a: 1, b: [1, 2], c: 3 })),
      false
    ],
    [
      'eq objects with a different key',
      cmp('eq', v({ a: 1 }), v({ b: 1 })),
      false
    ],
    ['eq arrays keep order', cmp('eq', inp('obj.b'), v([2, 1])), false],
    ['eq arrays', cmp('eq', inp('tags'), v(['vip', 'beta'])), true],
    ['eq arrays of other length', cmp('eq', inp('tags'), v(['vip'])), false],
    [
      'eq array vs object',
      cmp('eq', inp('tags'), v({ 0: 'vip', 1: 'beta' })),
      false
    ],
    ['eq object vs array', cmp('eq', v({ 0: 'vip' }), v(['vip'])), false],
    [
      'eq nested objects',
      cmp('eq', inp('items'), v([{ id: 1 }, { id: 2 }])),
      true
    ],
    ['eq flags', cmp('eq', flag('unset'), v(false)), true],
    ['eq with missing left', cmp('eq', inp('missing'), v(1)), null],
    ['eq with explicit null left', cmp('eq', inp('nothing'), v(null)), null],
    ['eq with missing right', cmp('eq', inp('n'), inp('missing')), null],
    ['eq with a list as right', cmp('eq', inp('n'), [v(5)]), null],
    ['eq without right', { op: 'eq', left: inp('n') }, null],
    ['neq different', cmp('neq', inp('n'), v(6)), true],
    ['neq equal', cmp('neq', inp('n'), v(5)), false],
    ['neq deep equal', cmp('neq', inp('obj'), v({ b: [1, 2], a: 1 })), false],
    ['neq with missing left', cmp('neq', inp('missing'), v(5)), null],
    ['neq with missing right', cmp('neq', inp('n'), inp('missing')), null],

    // gt / gte / lt / lte: finite numbers only.
    ['gt', cmp('gt', inp('n'), v(4)), true],
    ['gt equal', cmp('gt', inp('n'), v(5)), false],
    ['gte equal', cmp('gte', inp('n'), v(5)), true],
    ['gte smaller', cmp('gte', inp('n'), v(6)), false],
    ['lt', cmp('lt', inp('n'), v(6)), true],
    ['lt equal', cmp('lt', inp('n'), v(5)), false],
    ['lte equal', cmp('lte', inp('n'), v(5)), true],
    ['lte greater', cmp('lte', inp('n'), v(4)), false],
    ['gt zero', cmp('gt', inp('zero'), v(-1)), true],
    ['gt on a string', cmp('gt', inp('text'), v(1)), null],
    ['gt against a numeric string', cmp('gt', inp('n'), v('4')), null],
    ['gt on a boolean', cmp('gt', inp('yes'), v(0)), null],
    ['gt on a flag', cmp('gt', flag('unset'), v(0)), null],
    ['gt on missing', cmp('gt', inp('missing'), v(1)), null],
    ['lt against missing', cmp('lt', inp('n'), inp('missing')), null],
    ['gt on infinity', cmp('gt', sig('infinite'), v(1)), null],
    ['lte on NaN', cmp('lte', sig('nan'), v(1)), null],

    // between: inclusive [low, high] of finite numbers.
    ['between inside', cmp('between', inp('n'), [v(1), v(10)]), true],
    ['between at low', cmp('between', inp('n'), [v(5), v(10)]), true],
    ['between at high', cmp('between', inp('n'), [v(1), v(5)]), true],
    ['between below', cmp('between', inp('n'), [v(6), v(10)]), false],
    ['between above', cmp('between', inp('n'), [v(1), v(4)]), false],
    ['between inverted bounds', cmp('between', inp('n'), [v(10), v(1)]), false],
    [
      'between missing low',
      cmp('between', inp('n'), [inp('missing'), v(10)]),
      null
    ],
    ['between string high', cmp('between', inp('n'), [v(1), v('10')]), null],
    ['between string left', cmp('between', inp('text'), [v(1), v(10)]), null],
    [
      'between missing left',
      cmp('between', inp('missing'), [v(1), v(10)]),
      null
    ],
    ['between one bound', cmp('between', inp('n'), [v(1)]), null],
    [
      'between three bounds',
      cmp('between', inp('n'), [v(1), v(2), v(9)]),
      null
    ],
    ['between single operand', cmp('between', inp('n'), v([1, 10])), null],

    // in: list of operands (null items ignored) or one operand → array.
    ['in list', cmp('in', v('vip'), [v('basic'), v('vip')]), true],
    ['in list, no match', cmp('in', v('gold'), [v('basic'), v('vip')]), false],
    [
      'in list ignores null items (match)',
      cmp('in', v('vip'), [inp('missing'), v('vip')]),
      true
    ],
    [
      'in list ignores null items (no match)',
      cmp('in', v('gold'), [inp('missing'), v('vip')]),
      false
    ],
    [
      'in list whose items are all null is unknown',
      cmp('in', v('gold'), [inp('missing'), inp('nothing')]),
      null
    ],
    [
      'not in a list whose items are all null stays unknown',
      { not: cmp('in', v('gold'), [inp('missing')]) },
      null
    ],
    ['in array operand of nulls', cmp('in', v('x'), v([null])), false],
    ['in empty list', cmp('in', v('vip'), []), false],
    ['in list is deep', cmp('in', v({ id: 2 }), [v({ id: 2 })]), true],
    ['in list item that is an array', cmp('in', v([1, 2]), [v([1, 2])]), true],
    ['in list is type-strict', cmp('in', inp('n'), [v('5')]), false],
    ['in array operand', cmp('in', v('beta'), inp('tags')), true],
    ['in array operand, no match', cmp('in', v('gold'), inp('tags')), false],
    ['in array operand is deep', cmp('in', v({ id: 2 }), inp('items')), true],
    ['in array value', cmp('in', inp('n'), v([1, 5, 9])), true],
    ['in non-array operand', cmp('in', v('Hello'), inp('text')), null],
    ['in missing operand', cmp('in', v('x'), inp('missing')), null],
    [
      'in with missing left',
      cmp('in', inp('missing'), [v('x'), v(null)]),
      null
    ],
    ['in without right', { op: 'in', left: v('x') }, null],

    // exists: never unknown.
    ['exists number', cmp('exists', inp('n')), true],
    ['exists zero', cmp('exists', inp('zero')), true],
    ['exists empty string', cmp('exists', inp('empty')), true],
    ['exists missing', cmp('exists', inp('missing')), false],
    ['exists explicit null', cmp('exists', inp('nothing')), false],
    ['exists unset flag', cmp('exists', flag('unset')), true],
    ['exists null signal', cmp('exists', sig('missing')), false],
    [
      'exists skipped answer',
      cmp('exists', { answer: 'skipped', field: 'probability' }),
      false
    ],
    ['not exists missing', { not: cmp('exists', inp('missing')) }, true],

    // contains: case-insensitive substring, or deep array membership.
    [
      'contains substring, any case',
      cmp('contains', inp('text'), v('WORLD')),
      true
    ],
    [
      'contains inner substring',
      cmp('contains', inp('text'), v('lo wo')),
      true
    ],
    [
      'contains absent substring',
      cmp('contains', inp('text'), v('bye')),
      false
    ],
    ['contains empty string', cmp('contains', inp('text'), v('')), true],
    ['contains number in string', cmp('contains', inp('text'), v(5)), null],
    [
      'contains missing in string',
      cmp('contains', inp('text'), inp('missing')),
      null
    ],
    ['contains array member', cmp('contains', inp('tags'), v('vip')), true],
    [
      'contains array member is exact',
      cmp('contains', inp('tags'), v('VIP')),
      false
    ],
    [
      'contains deep array member',
      cmp('contains', inp('items'), v({ id: 2 })),
      true
    ],
    [
      'contains absent array member',
      cmp('contains', inp('items'), v({ id: 3 })),
      false
    ],
    [
      'contains null in array',
      cmp('contains', inp('tags'), inp('nothing')),
      null
    ],
    ['contains on a number', cmp('contains', inp('n'), v(5)), null],
    ['contains on an object', cmp('contains', inp('obj'), v('a')), null],
    ['contains on missing', cmp('contains', inp('missing'), v('x')), null],

    // len_gt / len_lt: string or array length vs a number.
    ['len_gt string', cmp('len_gt', inp('text'), v(10)), true],
    ['len_gt string at length', cmp('len_gt', inp('text'), v(11)), false],
    ['len_lt string', cmp('len_lt', inp('text'), v(12)), true],
    ['len_lt string at length', cmp('len_lt', inp('text'), v(11)), false],
    ['len_lt empty string', cmp('len_lt', inp('empty'), v(1)), true],
    ['len_gt array', cmp('len_gt', inp('tags'), v(1)), true],
    ['len_lt array at length', cmp('len_lt', inp('tags'), v(2)), false],
    ['len_gt number', cmp('len_gt', inp('n'), v(0)), null],
    ['len_gt object', cmp('len_gt', inp('obj'), v(0)), null],
    ['len_gt against a string', cmp('len_gt', inp('text'), v('3')), null],
    ['len_lt missing', cmp('len_lt', inp('missing'), v(3)), null],

    // before / after: ISO strings or epoch ms.
    ['before ISO', cmp('before', inp('tenDaysAgo'), v('2026-09-13')), true],
    ['after ISO', cmp('after', inp('tenDaysAgo'), v('2026-09-13')), false],
    ['after date-only', cmp('after', inp('tenDaysAgo'), v('2026-01-01')), true],
    [
      'before epoch ms vs ISO',
      cmp(
        'before',
        inp('tenDaysAgoMs'),
        v(new Date(ago(10).getTime() + 1).toISOString())
      ),
      true
    ],
    [
      'before same instant',
      cmp('before', inp('tenDaysAgo'), inp('tenDaysAgoMs')),
      false
    ],
    [
      'after same instant',
      cmp('after', inp('tenDaysAgoMs'), inp('tenDaysAgo')),
      false
    ],
    ['after epoch ms', cmp('after', v(2_000), v(1_000)), true],
    [
      'before an invalid date',
      cmp('before', inp('tenDaysAgo'), inp('notADate')),
      null
    ],
    [
      'invalid date before',
      cmp('before', inp('notADate'), inp('tenDaysAgo')),
      null
    ],
    ['boolean before', cmp('before', inp('yes'), inp('tenDaysAgo')), null],
    ['missing before', cmp('before', inp('missing'), inp('tenDaysAgo')), null],
    ['after missing', cmp('after', inp('tenDaysAgo'), inp('missing')), null],
    [
      'an offset is honored',
      cmp('before', v('2026-01-01T10:00:00+05:00'), v('2026-01-01T06:00:00Z')),
      true
    ],
    [
      'minutes without seconds, fraction digits',
      cmp('after', v('2026-01-01T00:01Z'), v('2026-01-01T00:00:59.999999Z')),
      true
    ],
    [
      'a date-time without offset is UTC (not the server time zone)',
      cmp('before', v('2026-01-01T02:00:00'), v('2026-01-01T03:00:00Z')),
      true
    ],
    [
      'a date-time without offset is UTC (after)',
      cmp('after', v('2026-01-01T04:00'), v('2026-01-01T03:59:59Z')),
      true
    ],
    ['leap day', cmp('before', v('2028-02-29'), v('2028-03-01')), true],
    [
      'non-ISO: a bare number string',
      cmp('before', v('5'), v('2026-01-01')),
      null
    ],
    ['non-ISO: a year', cmp('before', v('2025'), v('2026-01-01')), null],
    [
      'non-ISO: a human date',
      cmp('before', v('Jan 1 2025'), v('2026-01-01')),
      null
    ],
    [
      'non-ISO: space separator',
      cmp('before', v('2025-01-01 00:00:00Z'), v('2026-01-01')),
      null
    ],
    [
      'non-ISO: leading space',
      cmp('before', v(' 2025-01-01'), v('2026-01-01')),
      null
    ],
    [
      'invalid calendar day (no roll-over)',
      cmp('after', v('2026-02-30'), v('2026-03-01')),
      null
    ],
    [
      'Feb 29 outside a leap year',
      cmp('after', v('2026-02-29'), v('2026-01-01')),
      null
    ],
    ['month 13', cmp('after', v('2026-13-01'), v('2026-01-01')), null],
    ['day 0', cmp('after', v('2026-01-00'), v('2025-01-01')), null],
    ['hour 24', cmp('after', v('2026-01-01T24:00:00Z'), v('2025-01-01')), null],
    [
      'second 60',
      cmp('after', v('2026-01-01T23:59:60Z'), v('2025-01-01')),
      null
    ],

    // days_since_gt / days_since_lt: fractional days from left to `now`, strict.
    [
      'days_since_gt below',
      cmp('days_since_gt', inp('tenDaysAgo'), v(9)),
      true
    ],
    [
      'days_since_gt exact',
      cmp('days_since_gt', inp('tenDaysAgo'), v(10)),
      false
    ],
    [
      'days_since_lt exact',
      cmp('days_since_lt', inp('tenDaysAgo'), v(10)),
      false
    ],
    [
      'days_since_lt above',
      cmp('days_since_lt', inp('tenDaysAgo'), v(11)),
      true
    ],
    [
      'days_since epoch ms',
      cmp('days_since_gt', inp('tenDaysAgoMs'), v(9.99)),
      true
    ],
    [
      'days_since fractional gt',
      cmp('days_since_gt', inp('dayAndHalfAgo'), v(1)),
      true
    ],
    [
      'days_since fractional lt',
      cmp('days_since_lt', inp('dayAndHalfAgo'), v(2)),
      true
    ],
    [
      'days_since fractional exact',
      cmp('days_since_gt', inp('dayAndHalfAgo'), v(1.5)),
      false
    ],
    [
      'days_since date-only (UTC midnight)',
      cmp('days_since_gt', inp('dateOnly'), v(1.49)),
      true
    ],
    [
      'days_since future is negative',
      cmp('days_since_lt', inp('inTwoDays'), v(-1.9)),
      true
    ],
    [
      'days_since future not gt 0',
      cmp('days_since_gt', inp('inTwoDays'), v(0)),
      false
    ],
    [
      'days_since invalid date',
      cmp('days_since_gt', inp('notADate'), v(1)),
      null
    ],
    [
      'days_since against a string',
      cmp('days_since_gt', inp('tenDaysAgo'), v('3')),
      null
    ],
    ['days_since missing', cmp('days_since_lt', inp('missing'), v(3)), null]
  ])('%s', (_name, condition, expected) => {
    expect(evaluateCondition(condition, operatorScope)).toBe(expected)
  })

  test('an unknown operator is unknown, also under not/all/any', () => {
    const bogus = {
      op: 'bogus',
      left: v(1),
      right: v(1)
    } as unknown as Condition
    expect(evaluateCondition(bogus, operatorScope)).toBeNull()
    expect(evaluateCondition({ not: bogus }, operatorScope)).toBeNull()
    expect(evaluateCondition({ all: [bogus] }, operatorScope)).toBeNull()
    expect(evaluateCondition({ any: [bogus] }, operatorScope)).toBeNull()
  })

  test('date parsing does not depend on the server time zone', () => {
    const tz = process.env.TZ
    const condition = cmp(
      'before',
      v('2026-01-01T02:00:00'),
      v('2026-01-01T03:00:00Z')
    )
    try {
      for (const zone of ['UTC', 'America/Lima', 'Asia/Tokyo']) {
        process.env.TZ = zone
        expect(evaluateCondition(condition, operatorScope)).toBe(true)
      }
    } finally {
      if (tz === undefined) delete process.env.TZ
      else process.env.TZ = tz
    }
  })

  test('days_since uses the injected `now`', () => {
    const condition = cmp('days_since_gt', v('2026-01-01T00:00:00Z'), v(30))
    expect(
      evaluateCondition(condition, scope({ now: new Date('2026-01-20') }))
    ).toBe(false)
    expect(
      evaluateCondition(condition, scope({ now: new Date('2026-03-01') }))
    ).toBe(true)
    expect(
      evaluateCondition(condition, scope({ now: new Date(Number.NaN) }))
    ).toBeNull()
  })
})

// ── Signals ──────────────────────────────────────────────────────────────

describe('computeSignals', () => {
  const answers: ResolvedAnswers = {
    spam: bool(0.9),
    tone: {
      type: 'score',
      score: 0.75,
      scoreNorm: 0.25,
      level: 'calm',
      levelIndex: 1,
      probabilities: null,
      confidence: null
    },
    skipped: null
  }
  const signalScope = { input: { word: 'x', big: 1e308 }, answers, now: NOW }
  const spam: Operand = { answer: 'spam', field: 'probability' }
  const tone: Operand = { answer: 'tone', field: 'score_norm' }
  const skipped: Operand = { answer: 'skipped', field: 'probability' }

  const compute = (signals: TemplateDefinitionInput['signals']) =>
    computeSignals(define({ signals }), signalScope)

  test('weighted: Σ(w·x)/Σ(w), with invert → 1 − x', () => {
    const { risk } = compute([
      {
        name: 'risk',
        kind: 'weighted',
        terms: [
          { operand: spam, weight: 2 },
          { operand: tone, weight: 1, invert: true }
        ]
      }
    ])
    expect(risk).toBeCloseTo((2 * 0.9 + 1 * 0.75) / 3, 10)
  })

  test('weighted: null and non-numeric terms are dropped and weights renormalized', () => {
    const { risk, lone } = compute([
      {
        name: 'risk',
        kind: 'weighted',
        terms: [
          { operand: spam, weight: 2 },
          { operand: skipped, weight: 5 },
          { operand: inp('missing'), weight: 3 },
          { operand: inp('word'), weight: 3 },
          { operand: flag('urgent'), weight: 3 },
          { operand: { answer: 'tone', field: 'confidence' }, weight: 3 },
          { operand: tone, weight: 1, invert: true }
        ]
      },
      {
        name: 'lone',
        kind: 'weighted',
        terms: [
          { operand: skipped, weight: 1 },
          { operand: spam, weight: 4, invert: true }
        ]
      }
    ])
    expect(risk).toBeCloseTo(0.85, 10)
    expect(lone).toBeCloseTo(0.1, 10)
  })

  test('weighted: no term kept → null', () => {
    expect(
      compute([
        {
          name: 'none',
          kind: 'weighted',
          terms: [
            { operand: skipped, weight: 1 },
            { operand: inp('missing'), weight: 1 }
          ]
        },
        { name: 'empty', kind: 'weighted', terms: [] }
      ])
    ).toEqual({ none: null, empty: null })
  })

  test('min / max / mean over the finite numbers among `of`', () => {
    const of = [v(0.2), inp('missing'), v('0.9'), v(0.8), v(true), skipped]
    expect(
      compute([
        { name: 'low', kind: 'min', of },
        { name: 'high', kind: 'max', of },
        { name: 'avg', kind: 'mean', of }
      ])
    ).toEqual({ low: 0.2, high: 0.8, avg: 0.5 })
  })

  test('min / max / mean with no number → null', () => {
    expect(
      compute([
        { name: 'low', kind: 'min', of: [skipped, v('x')] },
        { name: 'high', kind: 'max', of: [] },
        { name: 'avg', kind: 'mean', of: [inp('missing')] }
      ])
    ).toEqual({ low: null, high: null, avg: null })
  })

  test('a signal reads earlier signals; forward and self references are null', () => {
    expect(
      compute([
        { name: 'early', kind: 'mean', of: [sig('base')] },
        { name: 'base', kind: 'max', of: [spam, tone] },
        {
          name: 'combined',
          kind: 'weighted',
          terms: [
            { operand: sig('base'), weight: 1 },
            { operand: sig('early'), weight: 1 }
          ]
        },
        { name: 'itself', kind: 'min', of: [sig('itself')] }
      ])
    ).toEqual({ early: null, base: 0.9, combined: 0.9, itself: null })
  })

  test('non-finite results become null', () => {
    expect(
      compute([
        {
          name: 'overflow',
          kind: 'weighted',
          terms: [
            { operand: inp('big'), weight: 2 },
            { operand: inp('big'), weight: 2 }
          ]
        },
        { name: 'avg', kind: 'mean', of: [inp('big'), inp('big')] },
        { name: 'high', kind: 'max', of: [inp('big'), v(1)] }
      ])
    ).toEqual({ overflow: null, avg: null, high: 1e308 })
  })

  test('non-finite inputs are dropped', () => {
    const result = computeSignals(
      define({
        signals: [{ name: 'avg', kind: 'mean', of: [inp('inf'), v(1)] }]
      }),
      { input: { inf: Number.POSITIVE_INFINITY }, answers: {}, now: NOW }
    )
    expect(result).toEqual({ avg: 1 })
  })

  test('no signals → {}', () => {
    expect(compute([])).toEqual({})
  })
})

// ── Flags ────────────────────────────────────────────────────────────────

describe('computeFlags', () => {
  const definition = define({
    flagRules: [
      {
        id: 'urgent',
        when: cmp('gte', { answer: 'urgent', field: 'probability' }, v(0.7)),
        flags: ['urgent', 'escalate']
      },
      {
        id: 'priority',
        when: cmp('eq', flag('urgent'), v(true)),
        flags: ['priority', 'urgent']
      },
      {
        id: 'reads_later',
        when: cmp('eq', flag('late'), v(true)),
        flags: ['never']
      },
      { id: 'late', when: { all: [] }, flags: ['late'] },
      { id: 'unknown', when: U, flags: ['unknown'] },
      {
        id: 'risky',
        when: cmp('gte', sig('risk'), v(0.5)),
        flags: ['risky', 'late']
      }
    ]
  })
  const flagsFor = (probability: number, risk: number | null) =>
    computeFlags(definition, {
      input: {},
      answers: { urgent: bool(probability) },
      signals: { risk },
      now: NOW
    })

  test('adds every matching rule’s flags, de-duplicated in first-seen order', () => {
    expect(flagsFor(0.9, 0.6)).toEqual([
      'urgent',
      'escalate',
      'priority',
      'late',
      'risky'
    ])
  })

  test('a rule only sees flags added by earlier rules', () => {
    const flags = flagsFor(0.9, 0.6)
    expect(flags).toContain('priority')
    expect(flags).not.toContain('never')
  })

  test('non-matching and unknown conditions add nothing', () => {
    expect(flagsFor(0.2, null)).toEqual(['late'])
  })

  test('no flag rules → []', () => {
    expect(computeFlags(define(), { ...context(), signals: {} })).toEqual([])
  })
})

// ── Questions ────────────────────────────────────────────────────────────

describe('questionsToAsk', () => {
  const question = (when?: Condition) => ({
    type: 'boolean' as const,
    instructions: 'Is it?',
    ...(when ? { when } : {})
  })
  const definition = define({
    questions: {
      zeta: question(),
      pro_only: question(cmp('eq', inp('plan'), v('pro'))),
      unknown: question(cmp('eq', inp('missing'), v('x'))),
      no_coupon: question({ not: cmp('exists', inp('coupon')) }),
      recent: question(cmp('days_since_lt', inp('createdAt'), v(30))),
      reads_answer: question(
        cmp('exists', { answer: 'zeta', field: 'probability' })
      ),
      alpha: question()
    }
  })

  test('asks questions without `when` or whose `when` is true, in definition order', () => {
    expect(
      questionsToAsk(definition, {
        input: { plan: 'pro', createdAt: ago(5).toISOString() },
        now: NOW
      })
    ).toEqual(['zeta', 'pro_only', 'no_coupon', 'recent', 'alpha'])
  })

  test('false and unknown `when`s skip the question; `now` is injected', () => {
    expect(
      questionsToAsk(definition, {
        input: { plan: 'free', coupon: 'X', createdAt: ago(5).toISOString() },
        now: new Date(NOW.getTime() + 60 * DAY_MS)
      })
    ).toEqual(['zeta', 'alpha'])
  })

  test('no questions → []', () => {
    expect(questionsToAsk(define(), { input: {}, now: NOW })).toEqual([])
  })
})

// ── Preconditions ────────────────────────────────────────────────────────

describe('evaluatePreconditions', () => {
  const definition = define({
    decisions: [
      { label: 'other' },
      { label: 'spam', alwaysReview: true, minConfidence: 0.5 },
      { label: 'bug', minConfidence: 0.9 }
    ],
    preconditions: [
      {
        id: 'from_answer',
        when: { all: [] },
        decision: { fromAnswer: 'category' }
      },
      {
        id: 'blocked',
        when: cmp('eq', inp('sender'), v('blocked')),
        decision: NEEDS_REVIEW
      },
      {
        id: 'empty',
        when: cmp('len_lt', inp('message'), v(3)),
        decision: 'other'
      },
      {
        id: 'spammy',
        when: cmp('contains', inp('message'), v('viagra')),
        decision: 'spam'
      },
      {
        id: 'internal',
        when: cmp('eq', inp('source'), v('internal')),
        decision: 'bug'
      },
      {
        id: 'short',
        when: cmp('len_lt', inp('message'), v(10)),
        decision: 'bug'
      }
    ],
    rules: [{ id: 'always', when: { all: [] }, decision: 'other' }]
  })
  const base = {
    confidence: null,
    stage: 'precondition',
    flags: [],
    signals: {}
  }

  test.each<[string, JsonObject, Partial<PolicyResult>]>([
    [
      'a label decides (the fromAnswer precondition is skipped)',
      { message: 'hi' },
      {
        decision: 'other',
        suggestion: 'other',
        reviewReason: null,
        rule: 'empty'
      }
    ],
    [
      'first match wins; needs_review → reason rule, no suggestion',
      { message: 'hi', sender: 'blocked' },
      {
        decision: NEEDS_REVIEW,
        suggestion: null,
        reviewReason: 'rule',
        rule: 'blocked'
      }
    ],
    [
      'alwaysReview applies',
      { message: 'buy VIAGRA now' },
      {
        decision: NEEDS_REVIEW,
        suggestion: 'spam',
        reviewReason: 'always_review',
        rule: 'spammy'
      }
    ],
    [
      'minConfidence does not apply',
      { message: 'a long enough message', source: 'internal' },
      {
        decision: 'bug',
        suggestion: 'bug',
        reviewReason: null,
        rule: 'internal'
      }
    ],
    [
      'an unknown precondition does not match',
      { message: 'short msg' },
      { decision: 'bug', suggestion: 'bug', reviewReason: null, rule: 'short' }
    ]
  ])('%s', (_name, input, expected) => {
    const result = evaluatePreconditions(definition, { input, now: NOW })
    expect(result).toEqual({ ...base, ...expected } as PolicyResult)
    expectConsistent(result as PolicyResult)
  })

  test('null when none matches', () => {
    expect(
      evaluatePreconditions(definition, {
        input: { message: 'a perfectly normal message' },
        now: NOW
      })
    ).toBeNull()
    expect(
      evaluatePreconditions(definition, { input: {}, now: NOW })
    ).toBeNull()
    expect(evaluatePreconditions(define(), { input: {}, now: NOW })).toBeNull()
  })

  test('date preconditions use the injected `now`', () => {
    const stale = define({
      decisions: [{ label: 'expired' }],
      preconditions: [
        {
          id: 'stale',
          when: cmp('days_since_gt', inp('sentAt'), v(7)),
          decision: 'expired'
        }
      ]
    })
    const input = { sentAt: '2026-09-01T00:00:00Z' }
    expect(evaluatePreconditions(stale, { input, now: NOW })?.decision).toBe(
      'expired'
    )
    expect(
      evaluatePreconditions(stale, {
        input,
        now: new Date('2026-09-03T00:00:00Z')
      })
    ).toBeNull()
  })
})

// ── Policy ───────────────────────────────────────────────────────────────

describe('evaluatePolicy: fail-closed classification', () => {
  const definition = define({
    kind: 'classify',
    decisions: ['bug', 'billing', 'other'].map(label => ({
      label,
      minConfidence: 0.8
    })),
    questions: {
      category: {
        type: 'choice',
        instructions: 'Classify the ticket',
        criteria: { bug: null, billing: null, other: null }
      }
    },
    rules: [
      {
        id: 'classify',
        when: { all: [] },
        decision: { fromAnswer: 'category' }
      }
    ]
  })

  test.each<[string, ResolvedAnswer | null, Partial<PolicyResult>]>([
    [
      'confident → decided',
      choice('bug', 0.95),
      {
        decision: 'bug',
        suggestion: 'bug',
        confidence: 0.95,
        reviewReason: null,
        rule: 'classify',
        stage: 'rule'
      }
    ],
    [
      'exactly at minConfidence → decided',
      choice('billing', 0.8),
      {
        decision: 'billing',
        suggestion: 'billing',
        confidence: 0.8,
        reviewReason: null
      }
    ],
    [
      'below minConfidence → review suggesting the label',
      choice('bug', 0.5),
      {
        decision: NEEDS_REVIEW,
        suggestion: 'bug',
        confidence: 0.5,
        reviewReason: 'low_confidence',
        rule: 'classify'
      }
    ],
    [
      'no probabilities (confidence null) → never auto-decides',
      choice('bug', null),
      {
        decision: NEEDS_REVIEW,
        suggestion: 'bug',
        confidence: null,
        reviewReason: 'low_confidence',
        rule: 'classify',
        stage: 'rule'
      }
    ],
    [
      'question not asked → fromAnswer skipped → fallback',
      null,
      {
        decision: NEEDS_REVIEW,
        suggestion: null,
        confidence: null,
        reviewReason: 'fallback',
        rule: null,
        stage: 'fallback'
      }
    ]
  ])('%s', (_name, answer, expected) => {
    const result = evaluatePolicy(definition, context({ category: answer }))
    expect(result).toMatchObject(expected)
    expectConsistent(result)
  })

  test('minConfidence 0 still requires a confidence', () => {
    const lenient = define({
      decisions: [{ label: 'bug', minConfidence: 0 }],
      rules: [
        { id: 'take', when: { all: [] }, decision: { fromAnswer: 'category' } }
      ]
    })
    expect(
      evaluatePolicy(lenient, context({ category: choice('bug', 0) }))
    ).toMatchObject({
      decision: 'bug',
      reviewReason: null
    })
    expect(
      evaluatePolicy(lenient, context({ category: choice('bug', null) }))
    ).toMatchObject({
      decision: NEEDS_REVIEW,
      suggestion: 'bug',
      reviewReason: 'low_confidence'
    })
  })

  test('a non-finite confidence never passes minConfidence', () => {
    expect(
      evaluatePolicy(
        definition,
        context({ category: choice('bug', Number.NaN) })
      )
    ).toMatchObject({ decision: NEEDS_REVIEW, reviewReason: 'low_confidence' })
  })

  test.each([Number.NaN, Number.POSITIVE_INFINITY])(
    'a non-finite confidence (%p) is reported as null',
    confidence => {
      expect(
        evaluatePolicy(
          definition,
          context({ category: choice('bug', confidence) })
        ).confidence
      ).toBeNull()
    }
  )
})

describe('evaluatePolicy: boolean band', () => {
  const yesThreshold = 0.9
  const noThreshold = 0.1
  const probability: Operand = { answer: 'answer', field: 'probability' }
  const definition = define({
    kind: 'decide',
    decisions: [
      { label: 'approve', minConfidence: 2 * yesThreshold - 1 },
      { label: 'reject', minConfidence: 1 - 2 * noThreshold }
    ],
    questions: {
      answer: { type: 'boolean', instructions: 'Approve the refund?' }
    },
    rules: [
      {
        id: 'yes',
        when: cmp('gte', probability, v(0.5)),
        decision: 'approve',
        confidenceFrom: 'answer'
      },
      {
        id: 'no',
        when: { all: [] },
        decision: 'reject',
        confidenceFrom: 'answer'
      }
    ]
  })

  test.each<[number | null, string, string | null, string | null, string]>([
    [0.99, 'approve', 'approve', null, 'yes'],
    [0.9, 'approve', 'approve', null, 'yes'],
    [0.7, NEEDS_REVIEW, 'approve', 'low_confidence', 'yes'],
    [0.5, NEEDS_REVIEW, 'approve', 'low_confidence', 'yes'],
    [0.3, NEEDS_REVIEW, 'reject', 'low_confidence', 'no'],
    [0.1, 'reject', 'reject', null, 'no'],
    [0.01, 'reject', 'reject', null, 'no'],
    [null, NEEDS_REVIEW, 'reject', 'low_confidence', 'no']
  ])(
    'P(yes) = %p → %s (suggesting %s)',
    (p, decision, suggestion, reason, rule) => {
      const result = evaluatePolicy(
        definition,
        context({ answer: p === null ? null : bool(p) })
      )
      expect(result).toMatchObject({
        decision,
        suggestion,
        reviewReason: reason,
        rule,
        stage: 'rule'
      })
      if (p === null) expect(result.confidence).toBeNull()
      else expect(result.confidence).toBeCloseTo(Math.abs(2 * p - 1), 10)
      expectConsistent(result)
    }
  )
})

describe('evaluatePolicy: rules', () => {
  const answers: ResolvedAnswers = {
    category: choice('billing', 0.55),
    severity: {
      type: 'score',
      score: 1.4,
      scoreNorm: 0.7,
      level: 'high',
      levelIndex: 2,
      probabilities: { low: 0.1, medium: 0.4, high: 0.5 },
      confidence: 0.25
    },
    urgent: bool(0.8),
    skipped: null
  }

  test('Score `level` (argmax, not round(score)) via fromAnswer', () => {
    const definition = define({
      decisions: [{ label: 'low' }, { label: 'medium' }, { label: 'high' }],
      questions: {
        severity: {
          type: 'score',
          instructions: 'How severe is it?',
          levels: [
            { label: 'low', criteria: null },
            { label: 'medium', criteria: null },
            { label: 'high', criteria: null }
          ]
        }
      },
      rules: [
        { id: 'level', when: { all: [] }, decision: { fromAnswer: 'severity' } }
      ]
    })
    expect(evaluatePolicy(definition, context(answers))).toEqual({
      decision: 'high',
      suggestion: 'high',
      confidence: 0.25,
      rule: 'level',
      stage: 'rule',
      reviewReason: null,
      flags: [],
      signals: {}
    })
  })

  test('first match wins, in order; false and unknown rules are passed over', () => {
    const definition = define({
      decisions: [
        { label: 'a' },
        { label: 'b' },
        { label: 'c' },
        { label: 'd' }
      ],
      rules: [
        { id: 'false', when: F, decision: 'a' },
        { id: 'unknown', when: U, decision: 'b' },
        { id: 'not_unknown', when: { not: U }, decision: 'b' },
        { id: 'first', when: T, decision: 'c' },
        { id: 'second', when: T, decision: 'd' }
      ]
    })
    expect(evaluatePolicy(definition, context())).toMatchObject({
      decision: 'c',
      rule: 'first'
    })
  })

  test('a fromAnswer that does not resolve is skipped and evaluation continues', () => {
    const definition = define({
      decisions: [{ label: 'other' }],
      rules: [
        {
          id: 'not_asked',
          when: { all: [] },
          decision: { fromAnswer: 'skipped' }
        },
        {
          id: 'boolean',
          when: { all: [] },
          decision: { fromAnswer: 'urgent' }
        },
        { id: 'missing', when: { all: [] }, decision: { fromAnswer: 'nope' } },
        {
          id: 'prototype',
          when: { all: [] },
          decision: { fromAnswer: 'category' }
        },
        { id: 'label', when: { all: [] }, decision: 'other' }
      ]
    })
    // The schema rejects `constructor` as a key, so it is injected after
    // parsing: the lookup itself must still not reach `Object.prototype`.
    const prototype = definition.rules.find(rule => rule.id === 'prototype')
    if (!prototype) throw new Error('No prototype rule')
    prototype.decision = { fromAnswer: 'constructor' }
    expect(evaluatePolicy(definition, context(answers))).toMatchObject({
      decision: 'other',
      rule: 'label',
      confidence: null
    })
  })

  test.each<[string, Record<string, unknown>, number | null]>([
    [
      'a label rule without a source has no confidence',
      { decision: 'x' },
      null
    ],
    ['fromAnswer supplies it', { decision: { fromAnswer: 'category' } }, 0.55],
    [
      'confidenceFrom on a label rule',
      { decision: 'x', confidenceFrom: 'urgent' },
      0.8 * 2 - 1
    ],
    [
      'confidenceFrom overrides fromAnswer',
      { decision: { fromAnswer: 'category' }, confidenceFrom: 'severity' },
      0.25
    ],
    [
      'confidenceFrom a question that was not asked',
      { decision: 'x', confidenceFrom: 'skipped' },
      null
    ],
    [
      'confidenceFrom an unknown question',
      { decision: 'x', confidenceFrom: 'nope' },
      null
    ]
  ])('confidence: %s', (_name, rule, expected) => {
    const definition = define({
      rules: [
        { id: 'rule', when: { all: [] }, ...rule } as NonNullable<
          TemplateDefinitionInput['rules']
        >[number]
      ]
    })
    const result = evaluatePolicy(definition, context(answers))
    if (expected === null) expect(result.confidence).toBeNull()
    else expect(result.confidence).toBeCloseTo(expected, 10)
  })

  test('confidence: confidenceFrom a prototype key', () => {
    const definition = define({
      rules: [
        {
          id: 'rule',
          when: { all: [] },
          decision: 'x',
          confidenceFrom: 'urgent'
        }
      ]
    })
    // The schema rejects `constructor` as a key, so it is injected after
    // parsing: the lookup itself must still not reach `Object.prototype`.
    const [rule] = definition.rules
    if (!rule) throw new Error('No rule')
    rule.confidenceFrom = 'constructor'
    expect(evaluatePolicy(definition, context(answers)).confidence).toBeNull()
  })

  test('alwaysReview wins over minConfidence and keeps the confidence', () => {
    const definition = define({
      decisions: [
        { label: 'refund', alwaysReview: true, minConfidence: 0.1 },
        { label: 'keep', alwaysReview: false }
      ],
      rules: [
        {
          id: 'refund',
          when: cmp('eq', inp('ask'), v('refund')),
          decision: 'refund',
          confidenceFrom: 'urgent'
        },
        {
          id: 'keep',
          when: { all: [] },
          decision: 'keep',
          confidenceFrom: 'urgent'
        }
      ]
    })
    const reviewed = evaluatePolicy(
      definition,
      context(answers, { ask: 'refund' })
    )
    expect(reviewed).toMatchObject({
      decision: NEEDS_REVIEW,
      suggestion: 'refund',
      reviewReason: 'always_review',
      rule: 'refund',
      stage: 'rule'
    })
    expect(reviewed.confidence).toBeCloseTo(0.6, 10)
    expect(evaluatePolicy(definition, context(answers))).toMatchObject({
      decision: 'keep',
      reviewReason: null
    })
  })

  test('an undeclared label has no policy and is decided', () => {
    const definition = define({
      rules: [
        { id: 'rule', when: { all: [] }, decision: { fromAnswer: 'category' } }
      ]
    })
    expect(evaluatePolicy(definition, context(answers))).toMatchObject({
      decision: 'billing',
      suggestion: 'billing',
      reviewReason: null
    })
  })

  test('does not run preconditions', () => {
    const definition = define({
      decisions: [{ label: 'early' }, { label: 'late' }],
      preconditions: [{ id: 'pre', when: { all: [] }, decision: 'early' }],
      rules: [{ id: 'rule', when: { all: [] }, decision: 'late' }]
    })
    expect(evaluatePolicy(definition, context())).toMatchObject({
      decision: 'late',
      stage: 'rule'
    })
  })

  test('rules read signals and flags; both are returned', () => {
    const definition = define({
      decisions: [{ label: 'escalate' }, { label: 'normal' }],
      signals: [
        {
          name: 'risk',
          kind: 'weighted',
          terms: [
            { operand: { answer: 'urgent', field: 'probability' }, weight: 1 },
            { operand: { answer: 'skipped', field: 'probability' }, weight: 1 }
          ]
        },
        { name: 'nothing', kind: 'max', of: [inp('missing')] }
      ],
      flagRules: [
        {
          id: 'hot',
          when: cmp('gte', sig('risk'), v(0.7)),
          flags: ['hot', 'watch']
        },
        { id: 'watch', when: cmp('eq', flag('hot'), v(true)), flags: ['watch'] }
      ],
      rules: [
        {
          id: 'escalate',
          when: {
            all: [
              cmp('eq', flag('hot'), v(true)),
              cmp('gt', sig('risk'), v(0.75))
            ]
          },
          decision: 'escalate'
        },
        { id: 'normal', when: { all: [] }, decision: 'normal' }
      ]
    })
    expect(evaluatePolicy(definition, context(answers))).toEqual({
      decision: 'escalate',
      suggestion: 'escalate',
      confidence: null,
      rule: 'escalate',
      stage: 'rule',
      reviewReason: null,
      flags: ['hot', 'watch'],
      signals: { risk: 0.8, nothing: null }
    })
    expect(
      evaluatePolicy(definition, context({ ...answers, urgent: bool(0.3) }))
    ).toMatchObject({
      decision: 'normal',
      flags: [],
      signals: { risk: 0.3, nothing: null }
    })
  })
})

describe('evaluatePolicy: suggestions when a rule asks for review', () => {
  const rules = [
    {
      id: 'vip',
      when: cmp('eq', inp('plan'), v('enterprise')),
      decision: NEEDS_REVIEW,
      confidenceFrom: 'category'
    },
    {
      id: 'escalate',
      when: cmp('eq', inp('plan'), v('enterprise')),
      decision: NEEDS_REVIEW
    },
    {
      id: 'reserved',
      when: cmp('eq', inp('plan'), v('enterprise')),
      decision: { fromAnswer: 'meta' }
    },
    {
      id: 'invoice',
      when: cmp('contains', inp('text'), v('invoice')),
      decision: 'billing'
    },
    {
      id: 'classify',
      when: cmp('gte', { answer: 'category', field: 'confidence' }, v(0.5)),
      decision: { fromAnswer: 'category' }
    }
  ]
  const decisions = [
    { label: 'bug', minConfidence: 0.99 },
    { label: 'billing', alwaysReview: true },
    { label: 'other' }
  ]
  const answers = (confidence: number | null): ResolvedAnswers => ({
    category: choice('bug', confidence),
    // An option that happens to be named like the reserved label is never a suggestion.
    meta: choice(NEEDS_REVIEW, 1)
  })

  test.each<[string, string, JsonObject, number | null, string | null]>([
    [
      'the next matching rule (label policy not applied)',
      'other',
      { plan: 'enterprise', text: 'app crashes' },
      0.9,
      'bug'
    ],
    [
      'a later label rule (alwaysReview not applied)',
      'other',
      { plan: 'enterprise', text: 'my Invoice' },
      0.9,
      'billing'
    ],
    [
      'the fallback label when no other rule matches',
      'other',
      { plan: 'enterprise', text: 'hello' },
      0.3,
      'other'
    ],
    [
      'null when the fallback is needs_review too',
      NEEDS_REVIEW,
      { plan: 'enterprise', text: 'hello' },
      null,
      null
    ]
  ])('suggests %s', (_name, fallback, input, confidence, suggestion) => {
    const definition = define({
      decisions,
      rules,
      fallback: { decision: fallback }
    })
    const result = evaluatePolicy(
      definition,
      context(answers(confidence), input)
    )
    expect(result).toEqual({
      decision: NEEDS_REVIEW,
      suggestion,
      confidence,
      rule: 'vip',
      stage: 'rule',
      reviewReason: 'rule',
      flags: [],
      signals: {}
    })
  })

  test('a fromAnswer resolving to needs_review decides review with reason rule', () => {
    const definition = define({
      decisions,
      rules: [
        { id: 'reserved', when: { all: [] }, decision: { fromAnswer: 'meta' } }
      ],
      fallback: { decision: 'other' }
    })
    expect(evaluatePolicy(definition, context(answers(0.9)))).toMatchObject({
      decision: NEEDS_REVIEW,
      suggestion: 'other',
      confidence: 1,
      rule: 'reserved',
      reviewReason: 'rule'
    })
  })
})

describe('evaluatePolicy: fallback', () => {
  const rules = [{ id: 'never', when: F, decision: 'bug' }]

  test.each<[string, Partial<TemplateDefinitionInput>, Partial<PolicyResult>]>([
    [
      'a plain label is decided',
      { decisions: [{ label: 'other' }], fallback: { decision: 'other' } },
      { decision: 'other', suggestion: 'other', reviewReason: null }
    ],
    [
      'a label with minConfidence goes to review (no confidence)',
      {
        decisions: [{ label: 'other', minConfidence: 0.5 }],
        fallback: { decision: 'other' }
      },
      {
        decision: NEEDS_REVIEW,
        suggestion: 'other',
        reviewReason: 'low_confidence'
      }
    ],
    [
      'a label with alwaysReview goes to review',
      {
        decisions: [{ label: 'other', alwaysReview: true }],
        fallback: { decision: 'other' }
      },
      {
        decision: NEEDS_REVIEW,
        suggestion: 'other',
        reviewReason: 'always_review'
      }
    ],
    [
      'needs_review (the default) → reason fallback, no suggestion',
      { decisions: [{ label: 'bug' }] },
      { decision: NEEDS_REVIEW, suggestion: null, reviewReason: 'fallback' }
    ]
  ])('%s', (_name, partial, expected) => {
    const result = evaluatePolicy(define({ ...partial, rules }), context())
    expect(result).toEqual({
      confidence: null,
      rule: null,
      stage: 'fallback',
      flags: [],
      signals: {},
      ...expected
    } as PolicyResult)
    expectConsistent(result)
  })

  test('no rules at all → fallback', () => {
    expect(evaluatePolicy(define(), context())).toMatchObject({
      decision: NEEDS_REVIEW,
      reviewReason: 'fallback',
      stage: 'fallback'
    })
  })
})

// ── decide ───────────────────────────────────────────────────────────────

describe('decide', () => {
  const definition = define({
    decisions: [{ label: 'other' }, { label: 'bug' }],
    preconditions: [
      {
        id: 'empty',
        when: cmp('len_lt', inp('message'), v(3)),
        decision: 'other'
      }
    ],
    signals: [{ name: 'one', kind: 'max', of: [v(1)] }],
    flagRules: [{ id: 'always', when: { all: [] }, flags: ['seen'] }],
    rules: [{ id: 'bug', when: { all: [] }, decision: 'bug' }]
  })

  test('a matching precondition short-circuits: no answers needed, no signals or flags', () => {
    expect(decide(definition, context({}, { message: '' }))).toEqual({
      decision: 'other',
      suggestion: 'other',
      confidence: null,
      rule: 'empty',
      stage: 'precondition',
      reviewReason: null,
      flags: [],
      signals: {}
    })
  })

  test('otherwise it is evaluatePolicy', () => {
    const run = context({}, { message: 'the app crashes' })
    expect(decide(definition, run)).toEqual(evaluatePolicy(definition, run))
    expect(decide(definition, run)).toMatchObject({
      decision: 'bug',
      stage: 'rule',
      flags: ['seen'],
      signals: { one: 1 }
    })
  })
})
