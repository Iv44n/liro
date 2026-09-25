import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import {
  type CanonicalAnswer,
  getFakeEvaluator
} from '#modules/engine/evaluator'
import { reviewTasks } from '#modules/reviews/reviews.schemas'
import { decisionRuns, usageDaily } from '#modules/runs/runs.schemas'
import type { TemplateDefinitionInput } from '#modules/templates/definition'
import { log } from '#shared/config/logger'
import { db } from '#shared/db/config'
import {
  classifySupport,
  customTriage,
  decideRefund
} from '../fixtures/definitions'
import { json, testApi } from '../helpers/app'
import { createApiKey, createOrg, type TestOrg } from '../helpers/factories'
import {
  type InsertTemplateOptions,
  insertTemplate
} from '../helpers/templates'

const api = testApi()
const fake = getFakeEvaluator()

beforeEach(() => fake.reset())

// ── Helpers ─────────────────────────────────────────────────────────────

const choice = (
  picked: string,
  probabilities: Record<string, number> | null
): CanonicalAnswer => ({ type: 'choice', choice: picked, probabilities })

const boolean = (probability: number): CanonicalAnswer => ({
  type: 'boolean',
  probability
})

const score = (
  value: number,
  probabilities: Record<string, number> | null
): CanonicalAnswer => ({ type: 'score', score: value, probabilities })

/** A confident "bug" for `classifySupport` (confidence 0.955). */
const confidentBug = {
  category: choice('bug', { bug: 0.97, billing: 0.02, other: 0.01 })
}

const ticket = {
  ticket: { subject: 'Export', message: 'The export button crashes the app' },
  customer: { plan: 'pro', email: 'jane@example.com' }
}

interface Setup {
  org: TestOrg
  key: string
  slug: string
  templateId: string
  versionIds: string[]
}

async function setup(
  definition: TemplateDefinitionInput = classifySupport,
  options: Omit<InsertTemplateOptions, 'definition'> = {}
): Promise<Setup> {
  const org = await createOrg()
  const { key } = await createApiKey(org, 'live')
  const { template, versions } = await insertTemplate(org, {
    definition,
    ...options
  })
  return {
    org,
    key,
    slug: template.slug,
    templateId: template.id,
    versionIds: versions.map(version => version.id)
  }
}

function run(
  ref: string,
  body: unknown,
  auth: { apiKey?: string; cookie?: string; headers?: Record<string, string> }
) {
  return api.post(`/v1/decisions/${ref}/run`, { body, ...auth })
}

const runsOf = (organizationId: string) =>
  db
    .select()
    .from(decisionRuns)
    .where(eq(decisionRuns.organizationId, organizationId))

const storedRun = async (id: string) => {
  const row = await db.query.decisionRuns.findFirst({ where: { id } })
  if (!row) throw new Error(`run ${id} not stored`)
  return row
}

// ── Happy paths ─────────────────────────────────────────────────────────

describe('POST /v1/decisions/:ref/run — decisions', () => {
  test('classify: a confident answer decides its label', async () => {
    const { key, slug } = await setup()
    fake.enqueue(confidentBug)

    const response = await run(
      `${slug}@1`,
      { input: ticket, metadata: { ticketId: 'T-1' } },
      { apiKey: key }
    )

    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body).toEqual({
      id: expect.any(String),
      template: slug,
      version: '1.0',
      mode: 'live',
      source: 'api',
      status: 'succeeded',
      decision: 'bug',
      finalDecision: 'bug',
      confidence: 0.955,
      suggestion: 'bug',
      flags: [],
      rule: 'classify',
      reviewReason: null,
      review: null,
      answers: {
        category: {
          type: 'choice',
          choice: 'bug',
          probabilities: { bug: 0.97, billing: 0.02, other: 0.01 },
          confidence: 0.955
        }
      },
      signals: {},
      metadata: { ticketId: 'T-1' },
      model: 'jev-fake',
      latencyMs: expect.any(Number),
      createdAt: expect.any(String),
      completedAt: expect.any(String),
      error: null
    })
    expect(body).not.toHaveProperty('provider')
    expect(response.headers.get('Warning')).toBeNull()
    expect(response.headers.get('Deprecation')).toBeNull()
    expect(response.headers.get('Idempotent-Replayed')).toBeNull()
  })

  test.each([
    ['approve', 0.95, 'approve', 0.9, 'yes'],
    ['reject', 0.03, 'reject', 0.94, 'no']
  ])(
    'decide: P(yes) far from 0.5 → %s',
    async (_, probability, decision, confidence, rule) => {
      const { key, slug } = await setup(decideRefund)
      fake.enqueue({ answer: boolean(probability) })

      const response = await run(
        `${slug}@1`,
        { input: { request: 'Arrived broken', amount: 40 } },
        { apiKey: key }
      )

      expect(response.status).toBe(200)
      expect(await json(response)).toMatchObject({
        decision,
        finalDecision: decision,
        confidence,
        rule,
        review: null,
        answers: { answer: { type: 'boolean', probability, confidence } }
      })
    }
  )

  test('custom: a weighted signal over several answers decides spam', async () => {
    const { key, slug } = await setup(customTriage)
    fake.enqueue({
      category: choice('other', { bug: 0.05, billing: 0.05, other: 0.9 }),
      spam: boolean(0.95),
      frustrated: boolean(0.1),
      severity: score(0.2, { '0': 0.85, '1': 0.1, '2': 0.05 })
    })

    const response = await run(
      `${slug}@1`,
      { input: { message: 'BUY CHEAP WATCHES' } },
      { apiKey: key }
    )

    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body).toMatchObject({
      decision: 'spam',
      finalDecision: 'spam',
      rule: 'spam',
      confidence: null,
      flags: [],
      signals: { spam_risk: 0.9333 }
    })
    expect(body.answers.severity).toEqual({
      type: 'score',
      score: 0.2,
      level: 'low',
      probabilities: { low: 0.85, medium: 0.1, high: 0.05 },
      confidence: 0.775
    })
  })

  test('custom: routes by the category answer when nothing else matches', async () => {
    const { key, slug } = await setup(customTriage)
    fake.enqueue({
      category: choice('billing', { bug: 0.05, billing: 0.9, other: 0.05 }),
      spam: boolean(0.02),
      frustrated: boolean(0.8),
      severity: score(0.5, { '0': 0.5, '1': 0.5, '2': 0 })
    })

    const response = await run(
      `${slug}@1`,
      { input: { message: 'I was charged twice' } },
      { apiKey: key }
    )

    expect(await json(response)).toMatchObject({
      decision: 'billing',
      rule: 'route',
      confidence: 0.85,
      flags: ['frustrated']
    })
  })
})

// ── Review ──────────────────────────────────────────────────────────────

describe('needs_review', () => {
  test('low confidence creates exactly one review task with a suggestion', async () => {
    const { org, key, slug, templateId } = await setup()
    fake.enqueue({
      category: choice('bug', { bug: 0.5, billing: 0.3, other: 0.2 })
    })

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(200)
    const body = await json(response)
    const runId: string = body.id
    const reviewId: string = body.review?.id
    expect(body).toMatchObject({
      decision: 'needs_review',
      finalDecision: null,
      suggestion: 'bug',
      confidence: 0.25,
      reviewReason: 'low_confidence',
      rule: 'classify',
      review: {
        id: expect.any(String),
        status: 'pending',
        reason: 'low_confidence',
        resolvedDecision: null,
        resolvedAt: null
      }
    })

    const tasks = await db
      .select()
      .from(reviewTasks)
      .where(eq(reviewTasks.organizationId, org.id))
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: reviewId,
      runId,
      templateId,
      status: 'pending',
      reason: 'low_confidence',
      suggestedDecision: 'bug',
      allowedDecisions: ['bug', 'billing', 'other']
    })
  })

  test('a rule asking for review suggests the next outcome', async () => {
    const { key, slug } = await setup(customTriage)
    fake.enqueue({
      category: choice('bug', { bug: 0.9, billing: 0.05, other: 0.05 }),
      spam: boolean(0.05),
      frustrated: boolean(0.9),
      severity: score(1.9, { '0': 0.05, '1': 0.1, '2': 0.85 })
    })

    const response = await run(
      `${slug}@1`,
      { input: { message: 'Nothing works and I am furious' } },
      { apiKey: key }
    )

    expect(await json(response)).toMatchObject({
      decision: 'needs_review',
      reviewReason: 'rule',
      rule: 'escalate',
      suggestion: 'bug',
      confidence: null,
      flags: ['frustrated'],
      review: { status: 'pending', reason: 'rule' }
    })
  })

  test('without probabilities the run fails closed to review', async () => {
    const { key, slug } = await setup()
    fake.enqueue({ category: choice('billing', null) })

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(await json(response)).toMatchObject({
      decision: 'needs_review',
      suggestion: 'billing',
      confidence: null,
      reviewReason: 'low_confidence',
      review: { status: 'pending' }
    })
  })
})

// ── Preconditions ───────────────────────────────────────────────────────

describe('preconditions', () => {
  test('a matching precondition decides without calling the evaluator', async () => {
    const { org, key, slug } = await setup()

    const response = await run(
      `${slug}@1`,
      { input: { ticket: { message: 'hi' } } },
      { apiKey: key }
    )

    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body).toMatchObject({
      decision: 'other',
      finalDecision: 'other',
      rule: 'empty_message',
      confidence: null,
      answers: { category: null },
      model: null
    })
    expect(fake.calls).toHaveLength(0)

    const stored = await storedRun(body.id)
    expect(stored.provider).toBeNull()
    expect(stored.inputTokens).toBeNull()
    const [usage] = await db
      .select()
      .from(usageDaily)
      .where(eq(usageDaily.organizationId, org.id))
    expect(usage).toMatchObject({ provider: 'none', runs: 1, evaluations: 0 })
  })

  test('a precondition can send a run to review (reason rule, no suggestion)', async () => {
    const { key, slug } = await setup(decideRefund)

    const response = await run(
      `${slug}@1`,
      { input: { request: 'Refund my car', amount: 25_000 } },
      { apiKey: key }
    )

    expect(await json(response)).toMatchObject({
      decision: 'needs_review',
      reviewReason: 'rule',
      rule: 'too_expensive',
      suggestion: null,
      review: { status: 'pending', reason: 'rule' }
    })
    expect(fake.calls).toHaveLength(0)
  })
})

describe('question `when`', () => {
  /** `tone` is only asked for English text; `urgent` always. */
  const conditional: TemplateDefinitionInput = {
    kind: 'custom',
    input: {
      fields: [
        { path: 'text', type: 'string', required: true },
        { path: 'lang', type: 'enum', enum: ['en', 'es'], required: true }
      ]
    },
    decisions: [{ label: 'escalate' }, { label: 'queue' }],
    questions: {
      tone: {
        type: 'boolean',
        instructions: 'Is `text` rude?',
        when: { op: 'eq', left: { input: 'lang' }, right: { value: 'en' } }
      },
      urgent: {
        type: 'boolean',
        instructions: 'Is `text` urgent?',
        when: { op: 'neq', left: { input: 'text' }, right: { value: 'ok' } }
      }
    },
    rules: [
      {
        id: 'urgent',
        when: {
          op: 'gte',
          left: { answer: 'urgent', field: 'probability' },
          right: { value: 0.5 }
        },
        decision: 'escalate'
      }
    ],
    fallback: { decision: 'queue' }
  }

  test('only the questions whose `when` holds are sent; the rest are null', async () => {
    const { key, slug } = await setup(conditional)
    fake.enqueue({ urgent: boolean(0.9) })

    const response = await run(
      `${slug}@1`,
      { input: { text: 'Help, it is down', lang: 'es' } },
      { apiKey: key }
    )

    expect(Object.keys(fake.calls[0]?.questions ?? {})).toEqual(['urgent'])
    expect(await json(response)).toMatchObject({
      decision: 'escalate',
      answers: { tone: null, urgent: { type: 'boolean', probability: 0.9 } }
    })
  })

  test('with no question to ask the policy runs on the input alone', async () => {
    const { org, key, slug } = await setup(conditional)

    const response = await run(
      `${slug}@1`,
      { input: { text: 'ok', lang: 'es' } },
      { apiKey: key }
    )

    expect(response.status).toBe(200)
    expect(await json(response)).toMatchObject({
      decision: 'queue',
      rule: null,
      answers: { tone: null, urgent: null },
      model: null
    })
    expect(fake.calls).toHaveLength(0)
    const [usage] = await db
      .select()
      .from(usageDaily)
      .where(eq(usageDaily.organizationId, org.id))
    expect(usage).toMatchObject({ provider: 'none', evaluations: 0 })
  })
})

// ── Validation and refs ─────────────────────────────────────────────────

describe('validation', () => {
  test('input contract violations are 422 with input. paths, before any evaluation', async () => {
    const { org, key, slug } = await setup()

    const response = await run(
      `${slug}@1`,
      {
        input: {
          ticket: { subject: 5 },
          customer: { plan: 'gold' }
        }
      },
      { apiKey: key }
    )

    expect(response.status).toBe(422)
    const body = await json(response)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    const paths = body.error.details.issues.map(
      (issue: { path: string }) => issue.path
    )
    expect(paths.sort()).toEqual([
      'input.customer.plan',
      'input.ticket.message',
      'input.ticket.subject'
    ])
    expect(fake.calls).toHaveLength(0)
    expect(await runsOf(org.id)).toHaveLength(0)
  })

  test.each([
    ['no input', {}, 'input'],
    ['a non-object input', { input: 'text' }, 'input'],
    [
      'too many metadata keys',
      {
        input: ticket,
        metadata: Object.fromEntries(
          Array.from({ length: 51 }, (_, i) => [`k${i}`, i])
        )
      },
      'metadata'
    ],
    [
      'oversized metadata',
      { input: ticket, metadata: { blob: 'x'.repeat(9_000) } },
      'metadata'
    ]
  ])('rejects %s in the body', async (_, body, path) => {
    const { key, slug } = await setup()

    const response = await run(`${slug}@1`, body, { apiKey: key })

    expect(response.status).toBe(422)
    const { error } = await json(response)
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.details.issues[0].path).toBe(path)
  })

  test('unknown input keys are stripped: neither sent nor stored', async () => {
    const { key, slug } = await setup()
    fake.enqueue(confidentBug)

    const response = await run(
      `${slug}@1`,
      {
        input: {
          ...ticket,
          secret: 'drop me',
          ticket: { ...ticket.ticket, extra: 1 }
        }
      },
      { apiKey: key }
    )

    const body = await json(response)
    expect(JSON.stringify(fake.calls[0]?.state)).not.toContain('drop me')
    const stored = await storedRun(body.id)
    expect(stored.input).toEqual({
      ticket: { subject: 'Export', message: ticket.ticket.message },
      customer: { plan: 'pro' }
    })
  })

  /** `depth` nested arrays around `[]`, as raw JSON (`JSON.stringify` would overflow). */
  const nested = (depth: number) => `${'['.repeat(depth)}${']'.repeat(depth)}`

  test.each([
    [
      'a NUL in an input string',
      { input: { ticket: { message: 'The export crashes \u0000 now' } } },
      'input.ticket.message'
    ],
    [
      'a NUL in an input key the contract would strip',
      { input: { ...ticket, 'x\u0000': 1 } },
      'input'
    ],
    [
      'a NUL in a metadata value',
      { input: ticket, metadata: { a: 'x\u0000' } },
      'metadata.a'
    ],
    [
      'a NUL in a metadata key',
      { input: ticket, metadata: { 'k\u0000': 1 } },
      'metadata'
    ]
  ])('%s is 422 before any evaluation or storage', async (_, body, path) => {
    const { org, key, slug } = await setup()

    const withAndWithoutKey: Record<string, string>[] = [
      {},
      { 'Idempotency-Key': 'nul' }
    ]
    for (const headers of withAndWithoutKey) {
      const response = await run(`${slug}@1`, body, { apiKey: key, headers })

      expect(response.status).toBe(422)
      const { error } = await json(response)
      expect(error.code).toBe('VALIDATION_FAILED')
      expect(error.details.issues[0]).toEqual({
        path,
        message: expect.stringContaining('NUL'),
        code: 'custom'
      })
    }
    expect(fake.calls).toHaveLength(0)
    expect(await runsOf(org.id)).toHaveLength(0)
    expect(
      await db
        .select()
        .from(usageDaily)
        .where(eq(usageDaily.organizationId, org.id))
    ).toEqual([])
  })

  test.each([
    [
      'input, with an Idempotency-Key',
      (deep: string) =>
        `{"input":{"ticket":{"message":"The export crashes"},"extra":${deep}}}`,
      { 'Idempotency-Key': 'deep' },
      'input.extra'
    ],
    [
      'input, without a key',
      (deep: string) =>
        `{"input":{"ticket":{"message":"The export crashes"},"extra":${deep}}}`,
      {},
      'input.extra'
    ],
    [
      'metadata',
      (deep: string) =>
        `{"input":{"ticket":{"message":"The export crashes"}},"metadata":{"a":${deep}}}`,
      {},
      'metadata.a'
    ]
  ])(
    'deep nesting in %s is 422, not a stack overflow',
    async (_, body, headers, path) => {
      const { org, key, slug } = await setup()

      const response = await run(`${slug}@1`, body(nested(50_000)), {
        apiKey: key,
        headers
      })

      expect(response.status).toBe(422)
      const { error } = await json(response)
      expect(error.code).toBe('VALIDATION_FAILED')
      expect(error.details.issues).toHaveLength(1)
      expect(error.details.issues[0].path).toStartWith(path)
      expect(error.details.issues[0].message).toContain('64 levels')
      expect(fake.calls).toHaveLength(0)
      expect(await runsOf(org.id)).toHaveLength(0)
    }
  )

  test('nesting up to 64 levels is accepted', async () => {
    const { key, slug } = await setup()

    // `metadata` is level 1, so 63 arrays inside it make 64 levels.
    const ok = await run(
      `${slug}@1`,
      `{"input":{"ticket":{"message":"hi"}},"metadata":{"a":${nested(63)}}}`,
      { apiKey: key }
    )
    const tooDeep = await run(
      `${slug}@1`,
      `{"input":{"ticket":{"message":"hi"}},"metadata":{"a":${nested(64)}}}`,
      { apiKey: key }
    )

    expect(ok.status).toBe(200)
    expect(tooDeep.status).toBe(422)
  })

  test('malformed JSON is 400 INVALID_JSON', async () => {
    const { key, slug } = await setup()

    const response = await run(`${slug}@1`, '{"input": ', { apiKey: key })

    expect(response.status).toBe(400)
    expect((await json(response)).error.code).toBe('INVALID_JSON')
  })

  test('requires an API key or a session', async () => {
    const { slug } = await setup()

    const response = await run(`${slug}@1`, { input: ticket }, {})

    expect(response.status).toBe(401)
  })
})

describe('decision refs', () => {
  test.each([
    ['Not_A_Slug', 400, 'INVALID_REF'],
    ['tpl@1.2.3', 400, 'INVALID_REF'],
    ['tpl@01', 400, 'INVALID_REF'],
    ['missing-template', 404, 'TEMPLATE_NOT_FOUND'],
    ['SLUG@9', 404, 'VERSION_NOT_FOUND'],
    ['SLUG@1.5', 404, 'VERSION_NOT_FOUND']
  ])('%s → %i %s', async (ref, status, code) => {
    const { key, slug } = await setup()

    const response = await run(
      ref.replace('SLUG', slug),
      { input: ticket },
      { apiKey: key }
    )

    expect(response.status).toBe(status)
    expect((await json(response)).error.code).toBe(code)
    expect(fake.calls).toHaveLength(0)
  })

  test('an archived template is 410 TEMPLATE_ARCHIVED', async () => {
    const { key, slug } = await setup(classifySupport, { status: 'archived' })

    const response = await run(slug, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(410)
    expect((await json(response)).error.code).toBe('TEMPLATE_ARCHIVED')
  })

  test('a template with only a draft has no runnable version', async () => {
    const { key, slug } = await setup(classifySupport, {
      versions: [],
      draft: true
    })

    const response = await run(slug, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(404)
    expect((await json(response)).error.code).toBe('VERSION_NOT_FOUND')
  })

  test('slug, slug@M and slug@M.m pick versions, with Warning/Deprecation headers', async () => {
    const { key, slug } = await setup(classifySupport, {
      versions: [
        { major: 1, minor: 0 },
        { major: 1, minor: 1, status: 'deprecated' },
        { major: 2, minor: 0 }
      ]
    })
    const call = (ref: string) =>
      run(ref, { input: { ticket: { message: 'hi' } } }, { apiKey: key })

    const bare = await call(slug)
    expect((await json(bare)).version).toBe('2.0')
    expect(bare.headers.get('Warning')).toBe(
      `299 - "Unpinned decision reference; pin a major version, e.g. ${slug}@2"`
    )
    expect(bare.headers.get('Deprecation')).toBeNull()

    const major = await call(`${slug}@1`)
    expect((await json(major)).version).toBe('1.0')
    expect(major.headers.get('Warning')).toBeNull()
    expect(major.headers.get('Deprecation')).toBeNull()

    const exact = await call(`${slug}@1.0`)
    expect((await json(exact)).version).toBe('1.0')

    const deprecated = await call(`${slug}@1.1`)
    expect(deprecated.status).toBe(200)
    expect((await json(deprecated)).version).toBe('1.1')
    expect(deprecated.headers.get('Deprecation')).toBe('true')
    expect(deprecated.headers.get('Warning')).toBeNull()
  })

  test('slug@M falls back to a deprecated M.x when none is published', async () => {
    const { key, slug } = await setup(classifySupport, {
      versions: [
        { major: 1, minor: 0, status: 'deprecated' },
        { major: 2, minor: 0 }
      ]
    })

    const response = await run(
      `${slug}@1`,
      { input: { ticket: { message: 'hi' } } },
      { apiKey: key }
    )

    expect(response.status).toBe(200)
    expect((await json(response)).version).toBe('1.0')
    expect(response.headers.get('Deprecation')).toBe('true')
  })

  test("another organization's template is not found, even by the same slug", async () => {
    const owner = await setup()
    const other = await createOrg()
    const { key } = await createApiKey(other)

    const response = await run(owner.slug, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(404)
    expect((await json(response)).error.code).toBe('TEMPLATE_NOT_FOUND')
  })
})

// ── Evaluator failures ──────────────────────────────────────────────────

describe('evaluator failures', () => {
  test('provider RATE_LIMITED → 503 JEV_UNAVAILABLE with Retry-After, failed run stored', async () => {
    const { org, key, slug } = await setup()
    // Past the 20 s deadline, so the retry decorator gives up at once.
    fake.fail('RATE_LIMITED', { retryAfterMs: 30_000 })

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('30')
    const { error } = await json(response)
    expect(error.code).toBe('JEV_UNAVAILABLE')

    const runs = await runsOf(org.id)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      id: error.details.runId,
      status: 'failed',
      errorCode: 'RATE_LIMITED',
      provider: 'fake',
      decision: null,
      finalDecision: null
    })
  })

  test('organization quota → 429 RATE_LIMITED with Retry-After, and no run stored', async () => {
    const { org, key, slug } = await setup()
    fake.fail('RATE_LIMITED', { scope: 'organization', retryAfterMs: 2_500 })

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3')
    const { error } = await json(response)
    expect(error.code).toBe('RATE_LIMITED')
    expect(error.details).toBeUndefined()
    expect(await runsOf(org.id)).toHaveLength(0)
    expect(fake.calls).toHaveLength(1)
  })

  test('platform quota → 503 and no run stored', async () => {
    const { org, key, slug } = await setup()
    fake.fail('RATE_LIMITED', { scope: 'platform', retryAfterMs: 1_000 })

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('1')
    expect(await runsOf(org.id)).toHaveLength(0)
  })

  test('timeout → 504 JEV_TIMEOUT and a failed run, visible on GET /v1/runs/:id', async () => {
    const { key, slug } = await setup()
    // The sync retry policy retries a timeout once.
    fake.fail('TIMEOUT').fail('TIMEOUT')

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(504)
    const { error } = await json(response)
    expect(error.code).toBe('JEV_TIMEOUT')
    expect(fake.calls).toHaveLength(2)

    const stored = await api.get(`/v1/runs/${error.details.runId}`, {
      apiKey: key
    })
    expect(stored.status).toBe(200)
    expect(await json(stored)).toMatchObject({
      status: 'failed',
      decision: null,
      answers: null,
      // The code the run request answered with, not the evaluator's own.
      error: {
        code: 'JEV_TIMEOUT',
        message: 'The evaluation did not finish in time; retry later'
      }
    })
  })

  test("a failed run on /v1 shows the public error, never the provider's message", async () => {
    const { org, key, slug } = await setup()
    const secret =
      'Vercel AI Gateway: invalid API key for provider openai (team liro-prod)'
    fake.fail('AUTH', { message: secret })

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })
    const { error } = await json(response)
    const runId: string = error.details.runId

    const publicRun = await api.get(`/v1/runs/${runId}`, { apiKey: key })
    const body = await json(publicRun)
    expect(body.error).toEqual({
      code: 'EVALUATOR_ERROR',
      message: 'The evaluation failed; the error was logged'
    })
    expect(JSON.stringify(body)).not.toContain('liro-prod')
    expect(JSON.stringify(body)).not.toContain('AUTH')

    // The dashboard keeps the evaluator's own code and message for diagnosis.
    const detail = await api.get(`/api/runs/${runId}`, {
      cookie: org.owner.cookie
    })
    expect((await json(detail)).run).toMatchObject({
      error: { code: 'EVALUATOR_ERROR' },
      evaluatorError: { code: 'AUTH', message: secret }
    })
  })

  test('OVERLOADED twice → 503 without Retry-After', async () => {
    const { key, slug } = await setup()
    fake.fail('OVERLOADED').fail('OVERLOADED')

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBeNull()
  })

  test('a transient failure is retried once within the deadline', async () => {
    const { key, slug } = await setup()
    fake.fail('UNAVAILABLE', { retryAfterMs: 10 }).enqueue(confidentBug)

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(200)
    expect((await json(response)).decision).toBe('bug')
    expect(fake.calls).toHaveLength(2)
  })

  test.each([
    ['INVALID_REQUEST', 422, 'TEMPLATE_INVALID'],
    ['INPUT_TOO_LARGE', 422, 'INPUT_TOO_LARGE'],
    ['AUTH', 500, 'EVALUATOR_ERROR']
  ] as const)(
    '%s → %i %s, failed run stored',
    async (code, status, apiCode) => {
      const { org, key, slug } = await setup()
      fake.fail(code)

      const response = await run(
        `${slug}@1`,
        { input: ticket },
        { apiKey: key }
      )

      expect(response.status).toBe(status)
      expect((await json(response)).error.code).toBe(apiCode)
      const runs = await runsOf(org.id)
      expect(runs.map(row => [row.status, row.errorCode])).toEqual([
        ['failed', code]
      ])
    }
  )

  test('a failed run whose evaluator answered still meters its evaluation and tokens', async () => {
    const { org, key, slug, templateId } = await setup()
    fake.enqueue({ category: choice('refund', { refund: 1 }) })

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(500)
    const stored = await storedRun((await json(response)).error.details.runId)
    expect(stored.inputTokens ?? 0).toBeGreaterThan(0)
    const rows = await db
      .select()
      .from(usageDaily)
      .where(eq(usageDaily.organizationId, org.id))
    // Not a billable run, but the provider spend survives run purges.
    expect(rows).toEqual([
      {
        organizationId: org.id,
        day: new Date().toISOString().slice(0, 10),
        templateId,
        source: 'api',
        mode: 'live',
        provider: 'fake',
        runs: 0,
        evaluations: 1,
        inputTokens: stored.inputTokens ?? -1,
        outputTokens: 0
      }
    ])
  })

  test('a failure without an answer (timeout) adds no usage', async () => {
    const { org, key, slug } = await setup()
    fake.fail('TIMEOUT').fail('TIMEOUT')

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(504)
    const rows = await db
      .select()
      .from(usageDaily)
      .where(eq(usageDaily.organizationId, org.id))
    expect(rows).toEqual([])
  })

  test('an answer that does not fit its question is BAD_RESPONSE → 500, with provider data kept', async () => {
    const { key, slug } = await setup()
    fake.enqueue({ category: choice('refund', { refund: 1 }) })

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(500)
    const { error } = await json(response)
    expect(error.code).toBe('EVALUATOR_ERROR')
    expect(await storedRun(error.details.runId)).toMatchObject({
      status: 'failed',
      errorCode: 'BAD_RESPONSE',
      provider: 'fake',
      modelResolved: 'jev-fake',
      providerRequestId: expect.stringMatching(/^fake_/),
      answers: null
    })
  })

  test('MODEL_NOT_FOUND on a pinned model marks the version model_unavailable', async () => {
    const { key, slug, versionIds } = await setup({
      ...classifySupport,
      model: { family: 'jev', version: '1.13.0' }
    })
    fake.fail('MODEL_NOT_FOUND')

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(500)
    expect((await json(response)).error.code).toBe('MODEL_UNAVAILABLE')
    const version = await db.query.decisionTemplateVersions.findFirst({
      where: { id: versionIds[0] }
    })
    expect(version?.status).toBe('model_unavailable')

    const exact = await run(`${slug}@1.0`, { input: ticket }, { apiKey: key })
    expect(exact.status).toBe(409)
    expect((await json(exact)).error).toMatchObject({
      code: 'VERSION_UNAVAILABLE',
      details: { reason: 'model_unavailable' }
    })
    const floating = await run(`${slug}@1`, { input: ticket }, { apiKey: key })
    expect(floating.status).toBe(404)
    expect(fake.calls).toHaveLength(1)
  })

  test('MODEL_NOT_FOUND without a pinned model leaves the version published', async () => {
    const { key, slug, versionIds } = await setup()
    fake.fail('MODEL_NOT_FOUND')

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(response.status).toBe(500)
    const version = await db.query.decisionTemplateVersions.findFirst({
      where: { id: versionIds[0] }
    })
    expect(version?.status).toBe('published')
  })

  test('INPUT_TOO_LARGE is decided locally, without calling the evaluator', async () => {
    const { org, key, slug } = await setup()

    const response = await run(
      `${slug}@1`,
      { input: { ticket: { message: 'x'.repeat(400_000) } } },
      { apiKey: key }
    )

    expect(response.status).toBe(422)
    const { error } = await json(response)
    expect(error.code).toBe('INPUT_TOO_LARGE')
    expect(error.details).toEqual({
      estimatedTokens: expect.any(Number),
      maxContextTokens: 64_000
    })
    expect(error.details.estimatedTokens).toBeGreaterThan(64_000 * 1.2)
    expect(fake.calls).toHaveLength(0)
    expect(await runsOf(org.id)).toHaveLength(0)
  })
})

// ── What is sent and stored ─────────────────────────────────────────────

describe('what is sent and stored', () => {
  test('the evaluator receives the state and questions from the definition', async () => {
    const { org, key, slug } = await setup()
    fake.enqueue(confidentBug)

    await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(fake.calls).toHaveLength(1)
    const [call] = fake.calls
    expect(call?.state).toEqual({
      ticket: { subject: 'Export', message: ticket.ticket.message },
      customer: { plan: 'pro' }
    })
    expect(call?.questions).toEqual({
      category: {
        type: 'choice',
        instructions: 'What is `ticket.message` about?',
        criteria: {
          bug: 'Something in the product is broken',
          billing: 'Charges, invoices, refunds or payment methods',
          other: null
        }
      }
    })
    expect(call).toMatchObject({
      model: { family: 'jev' },
      organizationId: org.id,
      priority: 'live'
    })
    // The pii field is outside state.include: never sent.
    expect(JSON.stringify(call)).not.toContain('jane@example.com')
  })

  test('a pii field listed in state.include is sent, but still never stored', async () => {
    const { key, slug } = await setup({
      ...classifySupport,
      state: { include: ['ticket.message', 'customer.email'] }
    })
    fake.enqueue(confidentBug)

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    expect(fake.calls[0]?.state).toEqual({
      ticket: { message: ticket.ticket.message },
      customer: { email: 'jane@example.com' }
    })
    const stored = await storedRun((await json(response)).id)
    expect(JSON.stringify(stored)).not.toContain('jane@example.com')
  })

  test('the run stores provider, models, request id, tokens and latencies', async () => {
    const { key, slug, templateId, versionIds } = await setup()
    fake.enqueue(confidentBug)

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    const stored = await storedRun((await json(response)).id)
    // Checked first: Bun's toMatchObject writes its matchers into `stored`.
    expect(stored.inputTokens ?? 0).toBeGreaterThan(0)
    expect(stored.definitionHash).toMatch(/^[0-9a-f]{64}$/)
    expect(stored).toMatchObject({
      templateId,
      versionId: versionIds[0],
      status: 'succeeded',
      provider: 'fake',
      modelRequested: 'jev-fake',
      modelResolved: 'jev-fake',
      providerRequestId: expect.stringMatching(/^fake_\d+$/),
      inputTokens: expect.any(Number),
      outputTokens: 0,
      latencyMs: expect.any(Number),
      evaluatorLatencyMs: expect.any(Number),
      engineVersion: '1',
      definition: null,
      completedAt: expect.any(Date)
    })
  })

  test('usage_daily adds up runs, evaluations and tokens', async () => {
    const { org, key, slug, templateId } = await setup()
    fake.enqueue(confidentBug).enqueue(confidentBug)

    const first = await json(
      await run(`${slug}@1`, { input: ticket }, { apiKey: key })
    )
    const second = await json(
      await run(`${slug}@1`, { input: ticket }, { apiKey: key })
    )

    const tokens =
      ((await storedRun(first.id)).inputTokens ?? 0) +
      ((await storedRun(second.id)).inputTokens ?? 0)
    const rows = await db
      .select()
      .from(usageDaily)
      .where(eq(usageDaily.organizationId, org.id))
    expect(rows).toEqual([
      {
        organizationId: org.id,
        day: new Date().toISOString().slice(0, 10),
        templateId,
        source: 'api',
        mode: 'live',
        provider: 'fake',
        runs: 2,
        evaluations: 2,
        inputTokens: tokens,
        outputTokens: 0
      }
    ])
  })

  test.each([
    [
      'full',
      {
        ticket: { subject: 'Export', message: ticket.ticket.message },
        customer: { plan: 'pro' }
      }
    ],
    ['policy', { ticket: { message: ticket.ticket.message } }],
    ['none', null]
  ] as const)(
    'storeInput %s keeps its part of the input, never pii',
    async (mode, expected) => {
      const { key, slug } = await setup(classifySupport, { storeInput: mode })
      fake.enqueue(confidentBug)

      const response = await run(
        `${slug}@1`,
        { input: ticket },
        { apiKey: key }
      )

      const stored = await storedRun((await json(response)).id)
      expect(stored.input).toEqual(expected)
      expect(stored.policyInput).toEqual({
        ticket: { message: ticket.ticket.message }
      })
      expect(JSON.stringify(stored)).not.toContain('jane@example.com')
    }
  )

  test('failed runs follow storeInput too', async () => {
    const { key, slug } = await setup(classifySupport, { storeInput: 'none' })
    fake.fail('AUTH')

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    const stored = await storedRun((await json(response)).error.details.runId)
    expect(stored.input).toBeNull()
    expect(stored.policyInput).toEqual({
      ticket: { message: ticket.ticket.message }
    })
  })
})

// ── Callers ─────────────────────────────────────────────────────────────

describe('callers', () => {
  test('a test key runs in test mode (and still gets a review)', async () => {
    const { org, slug } = await setup()
    const { key, id } = await createApiKey(org, 'test')
    fake.enqueue({
      category: choice('bug', { bug: 0.4, billing: 0.3, other: 0.3 })
    })

    const response = await run(`${slug}@1`, { input: ticket }, { apiKey: key })

    const body = await json(response)
    expect(body).toMatchObject({
      mode: 'test',
      decision: 'needs_review',
      review: { status: 'pending' }
    })
    expect(await storedRun(body.id)).toMatchObject({
      mode: 'test',
      apiKeyId: id,
      userId: null
    })
    const [usage] = await db
      .select()
      .from(usageDaily)
      .where(eq(usageDaily.organizationId, org.id))
    expect(usage?.mode).toBe('test')
  })

  test('a dashboard session can run decisions on /v1 (live mode)', async () => {
    const { org, slug } = await setup()
    fake.enqueue(confidentBug)

    const response = await run(
      `${slug}@1`,
      { input: ticket },
      { cookie: org.owner.cookie }
    )

    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body.mode).toBe('live')
    expect(await storedRun(body.id)).toMatchObject({
      userId: org.owner.id,
      apiKeyId: null
    })
  })

  test('Authorization: Bearer works too', async () => {
    const { key, slug } = await setup()

    const response = await api.post(`/v1/decisions/${slug}@1/run`, {
      bearer: key,
      body: { input: { ticket: { message: 'hi' } } }
    })

    expect(response.status).toBe(200)
  })
})

describe('GET /v1/runs/:id', () => {
  test('returns the run in the public shape', async () => {
    const { key, slug } = await setup()
    fake.enqueue(confidentBug)
    const created = await json(
      await run(`${slug}@1`, { input: ticket }, { apiKey: key })
    )

    const response = await api.get(`/v1/runs/${created.id}`, { apiKey: key })

    expect(response.status).toBe(200)
    expect(await json(response)).toEqual(created)
  })

  test("is scoped to the caller's organization", async () => {
    const { key, slug } = await setup()
    const created = await json(
      await run(
        `${slug}@1`,
        { input: { ticket: { message: 'hi' } } },
        { apiKey: key }
      )
    )
    const other = await createOrg()
    const { key: otherKey } = await createApiKey(other)

    for (const auth of [{ apiKey: otherKey }, { cookie: other.owner.cookie }]) {
      const response = await api.get(`/v1/runs/${created.id}`, auth)
      expect(response.status).toBe(404)
      expect((await json(response)).error.code).toBe('NOT_FOUND')
    }
    const missing = await api.get('/v1/runs/not-a-run', { apiKey: key })
    expect(missing.status).toBe(404)
    // A NUL can't be queried in Postgres: still a 404, not a 500.
    const nul = await api.get('/v1/runs/a%00b', { apiKey: key })
    expect(nul.status).toBe(404)
    expect((await json(nul)).error.code).toBe('NOT_FOUND')
  })
})

// ── Logging ─────────────────────────────────────────────────────────────

describe('logging evaluator failures', () => {
  /** Spies on the logger's error/warn for one test (restored after it). */
  function spyLogs() {
    const error = spyOn(log.logger, 'error')
    const warn = spyOn(log.logger, 'warn')
    /** The executor's own lines (the evaluator's telemetry also warns on failures). */
    const executorLines = (spy: typeof error) =>
      spy.mock.calls.filter(call => String(call[0]).startsWith('[executor]'))
    return {
      error: () => executorLines(error),
      warn: () => executorLines(warn),
      /** Every logged argument at either level, serialized, for "is it anywhere?" checks. */
      everything: () => JSON.stringify([error.mock.calls, warn.mock.calls]),
      restore() {
        error.mockRestore()
        warn.mockRestore()
      }
    }
  }

  let logs: ReturnType<typeof spyLogs> | undefined
  afterEach(() => {
    logs?.restore()
    logs = undefined
  })

  const privateInput = {
    ticket: {
      subject: 'Invoice 4411-secret',
      message: 'The account of jane@example.com was charged 3 times'
    },
    customer: { plan: 'pro', email: 'jane@example.com' }
  }

  test.each([
    ['AUTH', 'provider auth failed (marker-auth)'],
    ['BAD_RESPONSE', 'provider sent garbage (marker-bad)']
  ] as const)(
    '%s is logged at error level with its context, never the input or state',
    async (code, message) => {
      const { key, slug } = await setup(classifySupport, {
        storeInput: 'full'
      })
      fake.fail(code, { message })
      logs = spyLogs()

      const response = await run(
        `${slug}@1`,
        { input: privateInput },
        { apiKey: key }
      )

      expect(response.status).toBe(500)
      const failures = logs.error()
      expect(failures.map(call => call[0])).toEqual([
        '[executor] evaluation failed'
      ])
      const context = failures[0]?.[1]
      expect(context).toMatchObject({ code, provider: 'fake', message })
      expect(context).not.toHaveProperty('input')
      expect(context).not.toHaveProperty('state')
      expect(logs.warn()).toEqual([])
      const everything = logs.everything()
      expect(everything).toContain(message)
      for (const value of ['jane@example.com', '4411-secret', 'charged 3']) {
        expect(everything).not.toContain(value)
      }
    }
  )

  test('an organization quota rejection is a warning, not an error', async () => {
    const { key, slug } = await setup()
    fake.fail('RATE_LIMITED', { scope: 'organization', retryAfterMs: 1_000 })
    logs = spyLogs()

    const response = await run(
      `${slug}@1`,
      { input: privateInput },
      { apiKey: key }
    )

    expect(response.status).toBe(429)
    expect(logs.error()).toEqual([])
    const warnings = logs.warn()
    expect(warnings.map(call => call[0])).toEqual([
      '[executor] evaluation quota exceeded'
    ])
    expect(warnings[0]?.[1]).not.toHaveProperty('input')
    expect(logs.everything()).not.toContain('jane@example.com')
  })
})
