import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import {
  type CanonicalAnswer,
  getFakeEvaluator
} from '#modules/engine/evaluator'
import { reviewTasks } from '#modules/reviews/reviews.schemas'
import { db } from '#shared/db/config'
import { classifySupport, decideRefund } from '../fixtures/definitions'
import { json, testApi } from '../helpers/app'
import {
  addMember,
  createApiKey,
  createOrg,
  type TestOrg
} from '../helpers/factories'
import { insertTemplate } from '../helpers/templates'

const api = testApi()
const fake = getFakeEvaluator()

beforeEach(() => fake.reset())

const category = (
  picked: string,
  probabilities: Record<string, number>
): Record<string, CanonicalAnswer> => ({
  category: { type: 'choice', choice: picked, probabilities }
})

const ticket = (message: string) => ({ input: { ticket: { message } } })

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * One organization with a spread of runs, oldest first:
 * bug (live), needs_review (live), billing (test key), approve (decide),
 * failed (AUTH), and a playground run.
 */
interface Fixture {
  org: TestOrg
  liveKey: string
  classifyId: string
  classifySlug: string
  decideId: string
  runs: {
    bug: string
    review: string
    billing: string
    approve: string
    failed: string
    playground: string
  }
  reviewId: string
}

let fixture: Fixture

async function runDecision(ref: string, body: unknown, apiKey: string) {
  const response = await api.post(`/v1/decisions/${ref}/run`, {
    apiKey,
    body
  })
  const payload = await json(response)
  // Distinct createdAt values for the from/to filters.
  await sleep(5)
  return payload.id ?? payload.error.details.runId
}

/** A fresh organization with the runs of `Fixture` (each test gets its own). */
async function createFixture(): Promise<Fixture> {
  const org = await createOrg()
  const live = await createApiKey(org, 'live')
  const testKey = await createApiKey(org, 'test')
  const classify = await insertTemplate(org, {
    definition: classifySupport,
    draft: true,
    name: 'Support classifier'
  })
  const decide = await insertTemplate(org, { definition: decideRefund })
  const slug = classify.template.slug

  fake.enqueue(category('bug', { bug: 0.97, billing: 0.02, other: 0.01 }))
  const bug = await runDecision(`${slug}@1`, ticket('It crashes'), live.key)
  fake.enqueue(category('bug', { bug: 0.5, billing: 0.3, other: 0.2 }))
  const review = await runDecision(`${slug}@1`, ticket('Hmm'), live.key)
  fake.enqueue(category('billing', { bug: 0.01, billing: 0.98, other: 0.01 }))
  const billing = await runDecision(
    `${slug}@1`,
    ticket('Charged twice'),
    testKey.key
  )
  fake.enqueue({ answer: { type: 'boolean', probability: 0.99 } })
  const approve = await runDecision(
    `${decide.template.slug}@1`,
    { input: { request: 'Broken on arrival', amount: 30 } },
    live.key
  )
  fake.fail('AUTH')
  const failed = await runDecision(`${slug}@1`, ticket('Oops'), live.key)
  const playground = await json(
    await api.post(`/api/templates/${classify.template.id}/draft/test`, {
      cookie: org.owner.cookie,
      body: ticket('hi')
    })
  )

  const [task] = await db
    .select()
    .from(reviewTasks)
    .where(eq(reviewTasks.runId, review))
  if (!task) throw new Error('fixture: review task missing')

  return {
    org,
    liveKey: live.key,
    classifyId: classify.template.id,
    classifySlug: slug,
    decideId: decide.template.id,
    runs: {
      bug,
      review,
      billing,
      approve,
      failed,
      playground: playground.run.id
    },
    reviewId: task.id
  }
}

async function list(query = '', cookie = fixture.org.owner.cookie) {
  const response = await api.get(`/api/runs${query}`, { cookie })
  return { status: response.status, body: await json(response) }
}

const ids = (body: { data: { id: string }[] }) => body.data.map(run => run.id)

describe('GET /api/runs', () => {
  beforeEach(async () => {
    fixture = await createFixture()
  })

  test('lists the organization runs newest first', async () => {
    const { status, body } = await list()

    expect(status).toBe(200)
    const { runs } = fixture
    expect(ids(body)).toEqual([
      runs.playground,
      runs.failed,
      runs.approve,
      runs.billing,
      runs.review,
      runs.bug
    ])
    expect(body.nextCursor).toBeNull()
  })

  test('rows use the summary shape', async () => {
    const { body } = await list()

    const review = body.data.find(
      (run: { id: string }) => run.id === fixture.runs.review
    )
    expect(review).toEqual({
      id: fixture.runs.review,
      templateId: fixture.classifyId,
      templateSlug: fixture.classifySlug,
      templateName: 'Support classifier',
      version: '1.0',
      mode: 'live',
      source: 'api',
      status: 'succeeded',
      decision: 'needs_review',
      finalDecision: null,
      confidence: 0.25,
      flags: [],
      reviewStatus: 'pending',
      latencyMs: expect.any(Number),
      createdAt: expect.any(String)
    })
    const playground = body.data.find(
      (run: { id: string }) => run.id === fixture.runs.playground
    )
    expect(playground).toMatchObject({
      version: null,
      source: 'playground',
      mode: 'test',
      reviewStatus: null
    })
  })

  type RunName = keyof Fixture['runs']

  /** `:decide`/`:classify` stand for the fixture's template ids. */
  test.each<[string, string, RunName[]]>([
    ['templateId', 'templateId=:decide', ['approve']],
    ['decision', 'decision=needs_review', ['review']],
    ['mode', 'mode=test', ['playground', 'billing']],
    ['source', 'source=playground', ['playground']],
    ['status', 'status=failed', ['failed']],
    ['reviewStatus', 'reviewStatus=pending', ['review']],
    [
      'several filters',
      'templateId=:classify&mode=live&status=succeeded',
      ['review', 'bug']
    ]
  ])('filters by %s', async (_, query, expected) => {
    const { status, body } = await list(
      `?${query
        .replace(':decide', fixture.decideId)
        .replace(':classify', fixture.classifyId)}`
    )

    expect(status).toBe(200)
    expect(ids(body)).toEqual(expected.map(name => fixture.runs[name]))
  })

  test('from/to bound createdAt inclusively', async () => {
    const detail = async (id: string) =>
      (
        await json(
          await api.get(`/api/runs/${id}`, {
            cookie: fixture.org.owner.cookie
          })
        )
      ).run
    const billing = await detail(fixture.runs.billing)
    const approve = await detail(fixture.runs.approve)

    const window = await list(
      `?from=${encodeURIComponent(billing.createdAt)}&to=${encodeURIComponent(approve.createdAt)}`
    )
    const before = await list(
      `?to=${encodeURIComponent(billing.createdAt)}&source=api`
    )

    expect(ids(window.body)).toEqual([
      fixture.runs.approve,
      fixture.runs.billing
    ])
    expect(ids(before.body)).toEqual([
      fixture.runs.billing,
      fixture.runs.review,
      fixture.runs.bug
    ])
  })

  test('a date-only `to` includes that whole UTC day', async () => {
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10)

    const untilToday = await list(`?to=${today}`)
    const onlyToday = await list(`?from=${today}&to=${today}`)
    const untilYesterday = await list(`?to=${yesterday}`)

    expect(untilToday.status).toBe(200)
    expect(untilToday.body.data).toHaveLength(6)
    expect(onlyToday.body.data).toHaveLength(6)
    expect(untilYesterday.body.data).toEqual([])
  })

  test('paginates with a cursor', async () => {
    const pages: string[][] = []
    let cursor: string | null = null
    do {
      const query: string = `?limit=4${cursor ? `&cursor=${cursor}` : ''}`
      const { body } = await list(query)
      pages.push(ids(body))
      cursor = body.nextCursor
    } while (cursor)

    const { runs } = fixture
    expect(pages).toEqual([
      [runs.playground, runs.failed, runs.approve, runs.billing],
      [runs.review, runs.bug]
    ])
  })

  test('a page exactly as large as the remaining runs has no next cursor', async () => {
    const { body } = await list('?limit=6')

    expect(body.data).toHaveLength(6)
    expect(body.nextCursor).toBeNull()
  })

  test('members can browse runs', async () => {
    const member = await addMember(fixture.org, 'member')

    const { status, body } = await list('?limit=1', member.cookie)

    expect(status).toBe(200)
    expect(body.data).toHaveLength(1)
  })
})

describe('GET /api/runs (own organizations)', () => {
  test('filters by review status after a review is resolved', async () => {
    const other = await createOrg()
    const { key } = await createApiKey(other)
    const { template } = await insertTemplate(other, {
      definition: classifySupport
    })
    fake.enqueue(category('bug', { bug: 0.5, billing: 0.3, other: 0.2 }))
    const runId = await runDecision(`${template.slug}@1`, ticket('Hmm'), key)
    await db
      .update(reviewTasks)
      .set({ status: 'resolved', resolvedDecision: 'bug' })
      .where(eq(reviewTasks.runId, runId))

    const resolved = await list('?reviewStatus=resolved', other.owner.cookie)
    const pending = await list('?reviewStatus=pending', other.owner.cookie)

    expect(ids(resolved.body)).toEqual([runId])
    expect(resolved.body.data[0].reviewStatus).toBe('resolved')
    expect(ids(pending.body)).toEqual([])
  })

  test('lists follow when runs started, not when they finished', async () => {
    const org = await createOrg()
    const { key } = await createApiKey(org)
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    const unsure = category('bug', { bug: 0.5, billing: 0.3, other: 0.2 })
    const ref = `/v1/decisions/${template.slug}@1/run`

    // A starts first but its evaluation is slow; B starts later and ends first.
    fake.enqueue(unsure, { delayMs: 400 })
    const slow = api.post(ref, { apiKey: key, body: ticket('Slow one') })
    while (fake.calls.length < 1) await sleep(5)
    await sleep(20)
    fake.enqueue(unsure)
    const fast = await json(
      await api.post(ref, { apiKey: key, body: ticket('Fast one') })
    )
    const a = await json(await slow)
    expect(new Date(a.createdAt).getTime()).toBeLessThan(
      new Date(fast.createdAt).getTime()
    )
    expect(new Date(a.completedAt).getTime()).toBeGreaterThan(
      new Date(fast.completedAt).getTime()
    )

    // Newest first = B, then A.
    const runs = await list('', org.owner.cookie)
    expect(ids(runs.body)).toEqual([fast.id, a.id])
    // Pending reviews are a work queue, oldest first = A, then B.
    const reviews = await json(
      await api.get('/api/reviews', { cookie: org.owner.cookie })
    )
    expect(
      reviews.data.map((review: { run: { id: string } }) => review.run.id)
    ).toEqual([a.id, fast.id])
    // Pagination follows the same order.
    const first = await list('?limit=1', org.owner.cookie)
    const second = await list(
      `?limit=1&cursor=${first.body.nextCursor}`,
      org.owner.cookie
    )
    expect([...ids(first.body), ...ids(second.body)]).toEqual([fast.id, a.id])
  })

  test('another organization sees none of its runs', async () => {
    const { org } = await createFixture()
    const other = await createOrg()

    const own = await list('', org.owner.cookie)
    const { body } = await list('', other.owner.cookie)

    expect(own.body.data).toHaveLength(6)
    expect(body).toEqual({ data: [], nextCursor: null })
  })

  test.each([
    ['limit=0', 'limit'],
    ['limit=101', 'limit'],
    ['limit=abc', 'limit'],
    ['mode=staging', 'mode'],
    ['source=cron', 'source'],
    ['status=done', 'status'],
    ['reviewStatus=maybe', 'reviewStatus'],
    ['from=yesterday', 'from'],
    ['to=2026-02-30', 'to'],
    // Postgres `text` can't hold NUL: 422, not a failed query (500).
    ['decision=a%00b', 'decision'],
    ['templateId=a%00b', 'templateId'],
    ['cursor=a%00b', 'cursor']
  ])('?%s is 422 VALIDATION_FAILED', async (query, path) => {
    const org = await createOrg()

    const { status, body } = await list(`?${query}`, org.owner.cookie)

    expect(status).toBe(422)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details.issues[0].path).toBe(path)
  })

  test('requires a session', async () => {
    const response = await api.get('/api/runs')

    expect(response.status).toBe(401)
  })
})

describe('GET /api/runs/:id', () => {
  beforeEach(async () => {
    fixture = await createFixture()
  })

  test('returns the detail view', async () => {
    const response = await api.get(`/api/runs/${fixture.runs.review}`, {
      cookie: fixture.org.owner.cookie
    })

    expect(response.status).toBe(200)
    const { run } = await json(response)
    expect(run).toEqual({
      id: fixture.runs.review,
      template: fixture.classifySlug,
      version: '1.0',
      mode: 'live',
      source: 'api',
      status: 'succeeded',
      decision: 'needs_review',
      finalDecision: null,
      confidence: 0.25,
      suggestion: 'bug',
      flags: [],
      rule: 'classify',
      reviewReason: 'low_confidence',
      review: {
        id: fixture.reviewId,
        status: 'pending',
        reason: 'low_confidence',
        resolvedDecision: null,
        resolvedAt: null
      },
      answers: {
        category: {
          type: 'choice',
          choice: 'bug',
          probabilities: { bug: 0.5, billing: 0.3, other: 0.2 },
          confidence: 0.25
        }
      },
      signals: {},
      metadata: null,
      model: 'jev-fake',
      latencyMs: expect.any(Number),
      createdAt: expect.any(String),
      completedAt: expect.any(String),
      error: null,
      templateId: fixture.classifyId,
      templateName: 'Support classifier',
      versionId: expect.any(String),
      input: { ticket: { message: 'Hmm' } },
      policyInput: { ticket: { message: 'Hmm' } },
      provider: 'fake',
      modelRequested: 'jev-fake',
      modelResolved: 'jev-fake',
      providerRequestId: expect.stringMatching(/^fake_/),
      inputTokens: expect.any(Number),
      outputTokens: 0,
      evaluatorLatencyMs: expect.any(Number),
      apiKeyId: expect.any(String),
      userId: null,
      definitionHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      engineVersion: '1',
      evaluatorError: null
    })
  })

  test('a failed run carries its error', async () => {
    const response = await api.get(`/api/runs/${fixture.runs.failed}`, {
      cookie: fixture.org.owner.cookie
    })

    expect((await json(response)).run).toMatchObject({
      status: 'failed',
      decision: null,
      answers: null,
      signals: null,
      // As `/v1` shows it; the evaluator's own code is for diagnosis.
      error: {
        code: 'EVALUATOR_ERROR',
        message: 'The evaluation failed; the error was logged'
      },
      evaluatorError: { code: 'AUTH', message: 'Fake evaluator: AUTH' },
      provider: 'fake'
    })
  })

  test("is 404 for another organization's run and for unknown ids", async () => {
    const other = await createOrg()

    const crossOrg = await api.get(`/api/runs/${fixture.runs.bug}`, {
      cookie: other.owner.cookie
    })
    const unknown = await api.get(
      '/api/runs/01900000-0000-7000-8000-000000000000',
      {
        cookie: fixture.org.owner.cookie
      }
    )

    // A NUL can't be queried in Postgres: a 404 too, not a 500.
    const nul = await api.get('/api/runs/a%00b', {
      cookie: fixture.org.owner.cookie
    })

    for (const response of [crossOrg, unknown, nul]) {
      expect(response.status).toBe(404)
      expect((await json(response)).error.code).toBe('NOT_FOUND')
    }
  })
})

describe('GET /v1/decisions', () => {
  test('lists active templates with a runnable version, latest version each', async () => {
    const org = await createOrg()
    const { key } = await createApiKey(org)
    await insertTemplate(org, {
      definition: classifySupport,
      slug: 'a-classifier',
      name: 'Classifier',
      versions: [
        { major: 1, minor: 0 },
        { major: 1, minor: 1 },
        { major: 2, minor: 0, status: 'deprecated' }
      ]
    })
    await insertTemplate(org, {
      definition: decideRefund,
      slug: 'b-refunds',
      versions: [{ major: 1, minor: 0, status: 'deprecated' }]
    })
    // Not listed: archived, draft-only, only an unavailable model.
    await insertTemplate(org, {
      definition: classifySupport,
      slug: 'c-archived',
      status: 'archived'
    })
    await insertTemplate(org, {
      definition: classifySupport,
      slug: 'd-draft-only',
      versions: [],
      draft: true
    })
    await insertTemplate(org, {
      definition: classifySupport,
      slug: 'e-unavailable',
      versions: [{ major: 1, minor: 0, status: 'model_unavailable' }]
    })

    const response = await api.get('/v1/decisions', { apiKey: key })

    expect(response.status).toBe(200)
    const { data } = await json(response)
    expect(data.map((decision: { slug: string }) => decision.slug)).toEqual([
      'a-classifier',
      'b-refunds'
    ])
    expect(data[0]).toEqual({
      slug: 'a-classifier',
      name: 'Classifier',
      description: null,
      kind: 'classify',
      version: '1.1',
      labels: ['bug', 'billing', 'other'],
      inputSchema: expect.objectContaining({
        type: 'object',
        required: ['ticket']
      }),
      deprecated: false,
      ref: 'a-classifier@1'
    })
    expect(data[1]).toMatchObject({
      version: '1.0',
      kind: 'decide',
      labels: ['approve', 'reject'],
      deprecated: true,
      ref: 'b-refunds@1'
    })
  })

  test("an all-deprecated template's listed ref runs it (a bare slug can't)", async () => {
    const org = await createOrg()
    const { key } = await createApiKey(org)
    await insertTemplate(org, {
      definition: classifySupport,
      slug: 'retired',
      versions: [
        { major: 1, minor: 0, status: 'deprecated' },
        { major: 1, minor: 1, status: 'deprecated' }
      ]
    })
    const [listed] = (
      await json(await api.get('/v1/decisions', { apiKey: key }))
    ).data
    expect(listed).toMatchObject({
      version: '1.1',
      deprecated: true,
      ref: 'retired@1'
    })
    const body = { input: { ticket: { message: 'hi' } } }

    const pinned = await api.post(`/v1/decisions/${listed.ref}/run`, {
      apiKey: key,
      body
    })
    expect(pinned.status).toBe(200)
    expect((await json(pinned)).version).toBe('1.1')
    expect(pinned.headers.get('Deprecation')).toBe('true')

    // The bare slug says which ref to call instead.
    for (const response of [
      await api.get('/v1/decisions/retired', { apiKey: key }),
      await api.post('/v1/decisions/retired/run', { apiKey: key, body })
    ]) {
      expect(response.status).toBe(404)
      const { error } = await json(response)
      expect(error.code).toBe('VERSION_NOT_FOUND')
      expect(error.details).toEqual({
        ref: 'retired',
        suggestedRef: 'retired@1'
      })
    }
  })

  test('only lists the caller organization decisions', async () => {
    const org = await createOrg()
    await insertTemplate(org, { definition: classifySupport })
    const other = await createOrg()
    const { key } = await createApiKey(other)

    const response = await api.get('/v1/decisions', { apiKey: key })

    expect(await json(response)).toEqual({ data: [] })
  })
})

describe('GET /v1/decisions/:ref', () => {
  test('describes the version a ref resolves to', async () => {
    const org = await createOrg()
    const { key } = await createApiKey(org)
    const { template } = await insertTemplate(org, {
      definition: classifySupport,
      versions: [
        { major: 1, minor: 0 },
        { major: 1, minor: 1, status: 'deprecated' }
      ]
    })

    const pinned = await api.get(`/v1/decisions/${template.slug}@1`, {
      apiKey: key
    })
    expect(pinned.status).toBe(200)
    expect(pinned.headers.get('Warning')).toBeNull()
    expect(await json(pinned)).toEqual({
      slug: template.slug,
      name: template.name,
      description: null,
      kind: 'classify',
      version: '1.0',
      labels: ['bug', 'billing', 'other'],
      decisions: [
        { label: 'bug', description: 'Something is broken' },
        { label: 'billing', description: 'Money matters' },
        { label: 'other', description: null }
      ],
      inputSchema: expect.objectContaining({ type: 'object' }),
      deprecated: false
    })

    const deprecated = await api.get(`/v1/decisions/${template.slug}@1.1`, {
      apiKey: key
    })
    expect(deprecated.headers.get('Deprecation')).toBe('true')
    expect((await json(deprecated)).deprecated).toBe(true)

    const bare = await api.get(`/v1/decisions/${template.slug}`, {
      apiKey: key
    })
    expect(bare.headers.get('Warning')).toContain(`${template.slug}@1`)
  })

  test.each([
    ['BAD REF', 400, 'INVALID_REF'],
    ['nothing-here', 404, 'TEMPLATE_NOT_FOUND']
  ])('%s → %i %s', async (ref, status, code) => {
    const org = await createOrg()
    const { key } = await createApiKey(org)

    const response = await api.get(`/v1/decisions/${encodeURIComponent(ref)}`, {
      apiKey: key
    })

    expect(response.status).toBe(status)
    expect((await json(response)).error.code).toBe(code)
  })
})
