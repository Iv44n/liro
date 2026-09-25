import { beforeEach, describe, expect, test } from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { members } from '#modules/auth/auth.schemas'
import {
  type CanonicalAnswer,
  getFakeEvaluator
} from '#modules/engine/evaluator'
import { reviewTasks } from '#modules/reviews/reviews.schemas'
import { decisionRuns } from '#modules/runs/runs.schemas'
import type { TemplateDefinitionInput } from '#modules/templates/definition'
import { db } from '#shared/db/config'
import {
  classifySupport,
  customTriage,
  decideRefund
} from '../fixtures/definitions'
import { json, testApi } from '../helpers/app'
import {
  addMember,
  createApiKey,
  createOrg,
  type TestOrg,
  type TestUser
} from '../helpers/factories'
import {
  type InsertedTemplate,
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

/** A hesitant "bug" for `classifySupport`: confidence 0.25 < 0.8 → review. */
const hesitantBug = {
  category: choice('bug', { bug: 0.5, billing: 0.3, other: 0.2 })
}

const ticket = {
  ticket: { subject: 'Export', message: 'The export button crashes the app' },
  customer: { plan: 'pro', email: 'jane@example.com' }
}

interface Setup {
  org: TestOrg
  key: string
  inserted: InsertedTemplate
  slug: string
  templateId: string
}

async function setup(
  definition: TemplateDefinitionInput = classifySupport,
  options: Omit<InsertTemplateOptions, 'definition'> = {}
): Promise<Setup> {
  const org = await createOrg()
  const { key } = await createApiKey(org, 'live')
  const inserted = await insertTemplate(org, { definition, ...options })
  return {
    org,
    key,
    inserted,
    slug: inserted.template.slug,
    templateId: inserted.template.id
  }
}

interface Reviewed {
  runId: string
  reviewId: string
  /** The `/v1` run response. */
  run: Record<string, unknown>
}

/** Runs `ref` through `/v1` and expects it to end in review. */
async function runToReview(
  apiKey: string,
  ref: string,
  options: {
    input?: unknown
    answers?: Record<string, CanonicalAnswer> | null
    headers?: Record<string, string>
  } = {}
): Promise<Reviewed> {
  const answers = options.answers === undefined ? hesitantBug : options.answers
  if (answers) fake.enqueue(answers)
  const response = await api.post(`/v1/decisions/${ref}/run`, {
    apiKey,
    body: { input: options.input ?? ticket },
    ...(options.headers ? { headers: options.headers } : {})
  })
  const run = await json(response)
  if (response.status !== 200 || run.decision !== 'needs_review') {
    throw new Error(
      `expected a needs_review run, got ${response.status} ${JSON.stringify(run)}`
    )
  }
  return { runId: run.id, reviewId: run.review.id, run }
}

const resolve = (cookie: string, id: string, body: unknown) =>
  api.post(`/api/reviews/${id}/resolve`, { cookie, body })

const dismiss = (cookie: string, id: string, body?: unknown) =>
  api.post(`/api/reviews/${id}/dismiss`, {
    cookie,
    ...(body === undefined ? {} : { body })
  })

const list = async (cookie: string, query = '') => {
  const response = await api.get(`/api/reviews${query}`, { cookie })
  expect(response.status).toBe(200)
  return json(response)
}

const idsOf = (page: { data: { id: string }[] }) =>
  page.data.map(review => review.id)

const stats = async (cookie: string) =>
  json(await api.get('/api/reviews/stats', { cookie }))

const storedRun = async (id: string) => {
  const row = await db.query.decisionRuns.findFirst({ where: { id } })
  if (!row) throw new Error(`run ${id} not stored`)
  return row
}

const storedReview = async (id: string) => {
  const row = await db.query.reviewTasks.findFirst({ where: { id } })
  if (!row) throw new Error(`review ${id} not stored`)
  return row
}

const unknownId = () => Bun.randomUUIDv7()

// ── The inbox ───────────────────────────────────────────────────────────

describe('review tasks', () => {
  test('a low-confidence run lands in the inbox with everything a reviewer needs', async () => {
    const { org, key, slug, templateId, inserted } = await setup(
      classifySupport,
      { name: 'Support triage' }
    )
    const { runId, reviewId } = await runToReview(key, `${slug}@1`)

    const page = await list(org.owner.cookie)
    expect(page).toEqual({
      data: [
        {
          id: reviewId,
          status: 'pending',
          reason: 'low_confidence',
          suggestedDecision: 'bug',
          allowedDecisions: ['bug', 'billing', 'other'],
          resolvedDecision: null,
          resolvedBy: null,
          resolvedAt: null,
          comment: null,
          createdAt: expect.any(String),
          template: { id: templateId, slug, name: 'Support triage' },
          run: {
            id: runId,
            mode: 'live',
            version: '1.0',
            decision: 'needs_review',
            confidence: 0.25,
            flags: [],
            rule: 'classify',
            answers: {
              category: {
                type: 'choice',
                choice: 'bug',
                probabilities: { bug: 0.5, billing: 0.3, other: 0.2 },
                confidence: 0.25
              }
            },
            signals: {},
            // storeInput `full`, minus the pii email.
            input: {
              ticket: {
                subject: 'Export',
                message: 'The export button crashes the app'
              },
              customer: { plan: 'pro' }
            },
            createdAt: expect.any(String)
          },
          decisions: [
            { label: 'bug', description: 'Something is broken' },
            { label: 'billing', description: 'Money matters' },
            { label: 'other', description: null }
          ]
        }
      ],
      nextCursor: null
    })
    expect(JSON.stringify(page)).not.toContain('jane@example.com')

    const [task] = page.data
    const run = await storedRun(runId)
    expect(new Date(task.createdAt).getTime()).toBe(run.createdAt.getTime())
    expect(new Date(task.run.createdAt).getTime()).toBe(run.createdAt.getTime())
    expect(inserted.versions[0]?.id).toBe(run.versionId)

    const single = await api.get(`/api/reviews/${reviewId}`, {
      cookie: org.owner.cookie
    })
    expect(single.status).toBe(200)
    expect(await json(single)).toEqual({ review: task })

    expect(await stats(org.owner.cookie)).toEqual({ pending: 1 })
  })

  test("the buttons are the run's version decisions, not the latest version's", async () => {
    const withFeature: TemplateDefinitionInput = {
      ...classifySupport,
      decisions: [
        ...classifySupport.decisions,
        { label: 'feature', description: 'Asks for something new' }
      ],
      questions: {
        category: {
          type: 'choice',
          instructions: 'What is `ticket.message` about?',
          criteria: {
            bug: 'Something in the product is broken',
            billing: 'Charges, invoices, refunds or payment methods',
            feature: 'Asks for something new',
            other: null
          }
        }
      }
    }
    const { org, key, slug } = await setup(classifySupport, {
      versions: [
        { major: 1, minor: 0 },
        { major: 2, minor: 0, definition: withFeature }
      ]
    })
    const v1 = await runToReview(key, `${slug}@1`)
    const v2 = await runToReview(key, `${slug}@2`, {
      answers: {
        category: choice('bug', {
          bug: 0.4,
          billing: 0.3,
          feature: 0.2,
          other: 0.1
        })
      }
    })

    const first = await json(
      await api.get(`/api/reviews/${v1.reviewId}`, { cookie: org.owner.cookie })
    )
    const second = await json(
      await api.get(`/api/reviews/${v2.reviewId}`, { cookie: org.owner.cookie })
    )
    expect(first.review.run.version).toBe('1.0')
    expect(first.review.allowedDecisions).toEqual(['bug', 'billing', 'other'])
    expect(
      first.review.decisions.map((d: { label: string }) => d.label)
    ).toEqual(['bug', 'billing', 'other'])
    expect(second.review.run.version).toBe('2.0')
    expect(second.review.allowedDecisions).toEqual([
      'bug',
      'billing',
      'other',
      'feature'
    ])
    expect(second.review.decisions).toContainEqual({
      label: 'feature',
      description: 'Asks for something new'
    })

    // 1.0 never had `feature`.
    const rejected = await resolve(org.owner.cookie, v1.reviewId, {
      decision: 'feature'
    })
    expect(rejected.status).toBe(422)
    expect((await json(rejected)).error.code).toBe('INVALID_DECISION')
    const accepted = await resolve(org.owner.cookie, v2.reviewId, {
      decision: 'feature'
    })
    expect(accepted.status).toBe(200)
    expect((await storedRun(v2.runId)).finalDecision).toBe('feature')
  })

  test('a precondition review has no suggestion and no answers', async () => {
    const { org, key, slug } = await setup(decideRefund)
    const { reviewId, runId } = await runToReview(key, `${slug}@1`, {
      input: { request: 'Refund my car', amount: 25_000 },
      answers: null
    })
    expect(fake.calls).toHaveLength(0)

    const { review } = await json(
      await api.get(`/api/reviews/${reviewId}`, { cookie: org.owner.cookie })
    )
    expect(review).toMatchObject({
      reason: 'rule',
      suggestedDecision: null,
      allowedDecisions: ['approve', 'reject'],
      decisions: [
        { label: 'approve', description: null },
        { label: 'reject', description: null }
      ],
      run: {
        decision: 'needs_review',
        confidence: null,
        rule: 'too_expensive',
        answers: { answer: null },
        input: { request: 'Refund my car', amount: 25_000 }
      }
    })

    const resolved = await resolve(org.owner.cookie, reviewId, {
      decision: 'approve'
    })
    expect(resolved.status).toBe(200)
    expect((await storedRun(runId)).finalDecision).toBe('approve')
  })

  test("a rule-driven review carries the run's flags and signals", async () => {
    const { org, key, slug } = await setup(customTriage)
    const { reviewId } = await runToReview(key, `${slug}@1`, {
      input: { message: 'Nothing works and I am furious' },
      answers: {
        category: choice('bug', { bug: 0.9, billing: 0.05, other: 0.05 }),
        spam: boolean(0.05),
        frustrated: boolean(0.9),
        severity: score(1.9, { '0': 0.05, '1': 0.1, '2': 0.85 })
      }
    })

    const { review } = await json(
      await api.get(`/api/reviews/${reviewId}`, { cookie: org.owner.cookie })
    )
    expect(review).toMatchObject({
      reason: 'rule',
      suggestedDecision: 'bug',
      allowedDecisions: ['bug', 'billing', 'other', 'spam'],
      run: {
        rule: 'escalate',
        flags: ['frustrated'],
        // (2 × 0.05 + 1 × 0.05) / 3
        signals: { spam_risk: 0.05 },
        answers: {
          severity: { type: 'score', level: 'high' },
          frustrated: { type: 'boolean', probability: 0.9, confidence: 0.8 }
        }
      }
    })
  })

  test.each([
    ['full', { ticket: ticket.ticket, customer: { plan: 'pro' } }],
    ['policy', { ticket: { message: ticket.ticket.message } }],
    ['none', null]
  ] as const)(
    'storeInput %s decides what the reviewer sees of the input',
    async (storeInput, expected) => {
      const { org, key, slug } = await setup(classifySupport, { storeInput })
      const { reviewId } = await runToReview(key, `${slug}@1`)

      const { review } = await json(
        await api.get(`/api/reviews/${reviewId}`, { cookie: org.owner.cookie })
      )
      expect(review.run.input).toEqual(expected)
    }
  )

  test('test-mode runs are reviewed too, and say so', async () => {
    const { org, slug } = await setup()
    const { key } = await createApiKey(org, 'test')
    const { reviewId } = await runToReview(key, `${slug}@1`)

    const { review } = await json(
      await api.get(`/api/reviews/${reviewId}`, { cookie: org.owner.cookie })
    )
    expect(review.run.mode).toBe('test')
    expect(idsOf(await list(org.owner.cookie))).toEqual([reviewId])
  })

  test('confident runs and playground runs create no review', async () => {
    const { org, key, slug, templateId } = await setup(classifySupport, {
      draft: true
    })
    fake.enqueue({
      category: choice('bug', { bug: 0.97, billing: 0.02, other: 0.01 })
    })
    const decided = await api.post(`/v1/decisions/${slug}@1/run`, {
      apiKey: key,
      body: { input: ticket }
    })
    expect((await json(decided)).decision).toBe('bug')

    fake.enqueue(hesitantBug)
    const playground = await api.post(
      `/api/templates/${templateId}/draft/test`,
      { cookie: org.owner.cookie, body: { input: ticket } }
    )
    expect(playground.status).toBe(200)
    expect((await json(playground)).run.decision).toBe('needs_review')

    expect(await list(org.owner.cookie, '?status=all')).toEqual({
      data: [],
      nextCursor: null
    })
    expect(await stats(org.owner.cookie)).toEqual({ pending: 0 })
  })
})

// ── Listing ─────────────────────────────────────────────────────────────

describe('GET /api/reviews', () => {
  test('pending is oldest first; the other statuses newest first', async () => {
    const { org, key, slug } = await setup()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      ids.push((await runToReview(key, `${slug}@1`)).reviewId)
    }
    const [r1, r2, r3, r4, r5] = ids as [string, string, string, string, string]
    const cookie = org.owner.cookie
    expect((await resolve(cookie, r1, { decision: 'bug' })).status).toBe(200)
    expect((await dismiss(cookie, r2)).status).toBe(200)
    expect((await resolve(cookie, r3, { decision: 'other' })).status).toBe(200)

    expect(idsOf(await list(cookie))).toEqual([r4, r5])
    expect(idsOf(await list(cookie, '?status=pending'))).toEqual([r4, r5])
    expect(idsOf(await list(cookie, '?status=resolved'))).toEqual([r3, r1])
    expect(idsOf(await list(cookie, '?status=dismissed'))).toEqual([r2])
    expect(idsOf(await list(cookie, '?status=expired'))).toEqual([])
    expect(idsOf(await list(cookie, '?status=all'))).toEqual([
      r5,
      r4,
      r3,
      r2,
      r1
    ])

    const statuses = (await list(cookie, '?status=all')).data.map(
      (review: { status: string }) => review.status
    )
    expect(statuses).toEqual([
      'pending',
      'pending',
      'resolved',
      'dismissed',
      'resolved'
    ])
    expect(await stats(cookie)).toEqual({ pending: 2 })
  })

  test('expired reviews are listed under expired and cannot be resolved', async () => {
    const { org, key, slug } = await setup()
    const { reviewId, runId } = await runToReview(key, `${slug}@1`)
    await db
      .update(reviewTasks)
      .set({ status: 'expired' })
      .where(eq(reviewTasks.id, reviewId))

    expect(idsOf(await list(org.owner.cookie, '?status=expired'))).toEqual([
      reviewId
    ])
    expect(idsOf(await list(org.owner.cookie))).toEqual([])
    expect(await stats(org.owner.cookie)).toEqual({ pending: 0 })

    const response = await resolve(org.owner.cookie, reviewId, {
      decision: 'bug'
    })
    expect(response.status).toBe(409)
    expect(await json(response)).toEqual({
      error: {
        code: 'REVIEW_NOT_PENDING',
        message: 'This review is no longer pending',
        details: { status: 'expired' }
      }
    })
    expect((await storedRun(runId)).finalDecision).toBeNull()
  })

  test('filters by template', async () => {
    const { org, key, slug, templateId } = await setup()
    const other = await insertTemplate(org, { definition: decideRefund })
    const classify = await runToReview(key, `${slug}@1`)
    const decide = await runToReview(key, `${other.template.slug}@1`, {
      input: { request: 'Refund my car', amount: 25_000 },
      answers: null
    })
    const cookie = org.owner.cookie

    expect(idsOf(await list(cookie, `?templateId=${templateId}`))).toEqual([
      classify.reviewId
    ])
    expect(
      idsOf(await list(cookie, `?templateId=${other.template.id}`))
    ).toEqual([decide.reviewId])
    expect(idsOf(await list(cookie))).toEqual([
      classify.reviewId,
      decide.reviewId
    ])
    expect(idsOf(await list(cookie, `?templateId=${unknownId()}`))).toEqual([])

    await resolve(cookie, decide.reviewId, { decision: 'reject' })
    expect(
      idsOf(
        await list(cookie, `?status=resolved&templateId=${other.template.id}`)
      )
    ).toEqual([decide.reviewId])
    expect(
      idsOf(await list(cookie, `?status=resolved&templateId=${templateId}`))
    ).toEqual([])
  })

  test('paginates with a cursor, in both orders', async () => {
    const { org, key, slug } = await setup()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      ids.push((await runToReview(key, `${slug}@1`)).reviewId)
    }
    const [r1, r2, r3, r4, r5] = ids
    const cookie = org.owner.cookie

    /** Every page's ids, following `nextCursor`. */
    const collect = async (query: string): Promise<unknown> => {
      const pages: string[][] = []
      let cursor: string | null = null
      do {
        const suffix: string = cursor ? `&cursor=${cursor}` : ''
        const page = await list(cookie, `${query}${suffix}`)
        pages.push(idsOf(page))
        cursor = page.nextCursor
      } while (cursor && pages.length < 10)
      return pages
    }

    expect(await collect('?limit=2')).toEqual([[r1, r2], [r3, r4], [r5]])
    expect(await collect('?status=all&limit=2')).toEqual([
      [r5, r4],
      [r3, r2],
      [r1]
    ])
    // An exact fit has no next page.
    const exact = await list(cookie, '?limit=5')
    expect(idsOf(exact)).toEqual(ids)
    expect(exact.nextCursor).toBeNull()
    const first = await list(cookie, '?limit=4')
    expect(first.nextCursor).toBe(r4)
  })

  test('the default page is 50 reviews', async () => {
    const { org, key } = await setup()
    // Precondition-free, evaluator-free: `needs_review` straight from the fallback.
    const reviewAll: TemplateDefinitionInput = {
      kind: 'custom',
      input: { fields: [{ path: 'n', type: 'number', required: true }] },
      decisions: [{ label: 'ok' }]
    }
    const quick = await insertTemplate(org, { definition: reviewAll })
    const created: string[] = []
    for (let i = 0; i < 51; i++) {
      const response = await api.post(
        `/v1/decisions/${quick.template.slug}@1/run`,
        { apiKey: key, body: { input: { n: i } } }
      )
      created.push((await json(response)).review.id)
    }
    expect(fake.calls).toHaveLength(0)

    const page = await list(org.owner.cookie)
    expect(page.data).toHaveLength(50)
    expect(page.nextCursor).toBe(created[49])
    const rest = await list(org.owner.cookie, `?cursor=${page.nextCursor}`)
    expect(idsOf(rest)).toEqual(created.slice(50))
    expect(rest.nextCursor).toBeNull()
    expect((await list(org.owner.cookie, '?limit=100')).data).toHaveLength(51)
    expect(await stats(org.owner.cookie)).toEqual({ pending: 51 })
  })

  test('rejects invalid queries', async () => {
    const org = await createOrg()
    for (const [query, path] of [
      ['?status=open', 'status'],
      ['?limit=0', 'limit'],
      ['?limit=101', 'limit'],
      ['?limit=abc', 'limit'],
      ['?limit=1.5', 'limit'],
      [`?cursor=${'x'.repeat(65)}`, 'cursor'],
      // Postgres can't take a NUL: a 422, not a failed query (500).
      ['?templateId=a%00b', 'templateId'],
      ['?cursor=a%00b', 'cursor']
    ]) {
      const response = await api.get(`/api/reviews${query}`, {
        cookie: org.owner.cookie
      })
      expect(response.status).toBe(422)
      const body = await json(response)
      expect(body.error.code).toBe('VALIDATION_FAILED')
      expect(body.error.details.issues).toEqual([
        { path, message: expect.any(String), code: expect.any(String) }
      ])
    }
  })

  test('an empty inbox', async () => {
    const org = await createOrg()
    expect(await list(org.owner.cookie)).toEqual({ data: [], nextCursor: null })
    expect(await stats(org.owner.cookie)).toEqual({ pending: 0 })
  })

  test('requires a session', async () => {
    const { key, slug } = await setup()
    const { reviewId } = await runToReview(key, `${slug}@1`)
    for (const response of [
      await api.get('/api/reviews'),
      await api.get('/api/reviews/stats'),
      await api.get(`/api/reviews/${reviewId}`),
      await api.post(`/api/reviews/${reviewId}/resolve`, {
        body: { decision: 'bug' }
      }),
      await api.post(`/api/reviews/${reviewId}/dismiss`),
      // An API key is not a dashboard session.
      await api.get('/api/reviews', { apiKey: key })
    ]) {
      expect(response.status).toBe(401)
    }
    expect((await storedReview(reviewId)).status).toBe('pending')
  })

  test('an unknown review is 404', async () => {
    const org = await createOrg()
    const response = await api.get(`/api/reviews/${unknownId()}`, {
      cookie: org.owner.cookie
    })
    expect(response.status).toBe(404)
    expect(await json(response)).toEqual({
      error: { code: 'NOT_FOUND', message: 'Review not found' }
    })
  })

  test('an id with a NUL is 404, not a failed query', async () => {
    const org = await createOrg()
    const cookie = org.owner.cookie
    for (const response of [
      await api.get('/api/reviews/a%00b', { cookie }),
      await resolve(cookie, 'a%00b', { decision: 'bug' }),
      await dismiss(cookie, 'a%00b')
    ]) {
      expect(response.status).toBe(404)
      expect(await json(response)).toEqual({
        error: { code: 'NOT_FOUND', message: 'Review not found' }
      })
    }
  })
})

// ── Resolving ───────────────────────────────────────────────────────────

describe('POST /api/reviews/:id/resolve', () => {
  test("resolving sets the run's finalDecision, visible on /v1", async () => {
    const { org, key, slug } = await setup()
    const { runId, reviewId } = await runToReview(key, `${slug}@1`)
    const before = Date.now()

    const response = await resolve(org.owner.cookie, reviewId, {
      decision: 'billing',
      comment: 'It is about an invoice'
    })

    expect(response.status).toBe(200)
    const { review } = await json(response)
    expect(review).toMatchObject({
      id: reviewId,
      status: 'resolved',
      suggestedDecision: 'bug',
      resolvedDecision: 'billing',
      resolvedBy: { id: org.owner.id, name: org.owner.name },
      comment: 'It is about an invoice',
      run: { id: runId, decision: 'needs_review' }
    })
    const resolvedAt = new Date(review.resolvedAt).getTime()
    expect(resolvedAt).toBeGreaterThanOrEqual(before - 1)
    expect(resolvedAt).toBeLessThanOrEqual(Date.now() + 1)

    // What an API caller polling the run sees.
    const polled = await api.get(`/v1/runs/${runId}`, { apiKey: key })
    expect(polled.status).toBe(200)
    expect(await json(polled)).toMatchObject({
      id: runId,
      decision: 'needs_review',
      finalDecision: 'billing',
      suggestion: 'bug',
      review: {
        id: reviewId,
        status: 'resolved',
        reason: 'low_confidence',
        resolvedDecision: 'billing',
        resolvedAt: review.resolvedAt
      }
    })

    // The dashboard's run views agree.
    const detail = await json(
      await api.get(`/api/runs/${runId}`, { cookie: org.owner.cookie })
    )
    expect(detail.run.finalDecision).toBe('billing')
    const resolvedRuns = await json(
      await api.get('/api/runs?reviewStatus=resolved', {
        cookie: org.owner.cookie
      })
    )
    expect(resolvedRuns.data).toHaveLength(1)
    expect(resolvedRuns.data[0]).toMatchObject({
      id: runId,
      finalDecision: 'billing',
      reviewStatus: 'resolved'
    })

    // It left the queue.
    expect(await stats(org.owner.cookie)).toEqual({ pending: 0 })
    expect(idsOf(await list(org.owner.cookie))).toEqual([])
    expect(idsOf(await list(org.owner.cookie, '?status=resolved'))).toEqual([
      reviewId
    ])
    const stored = await storedReview(reviewId)
    expect(stored).toMatchObject({
      status: 'resolved',
      resolvedDecision: 'billing',
      resolvedBy: org.owner.id,
      comment: 'It is about an invoice'
    })
  })

  test('accepting the suggestion, without a comment', async () => {
    const { org, key, slug } = await setup()
    const { runId, reviewId } = await runToReview(key, `${slug}@1`)

    const response = await resolve(org.owner.cookie, reviewId, {
      decision: 'bug'
    })

    expect(response.status).toBe(200)
    const { review } = await json(response)
    expect(review.resolvedDecision).toBe('bug')
    expect(review.comment).toBeNull()
    expect(
      await json(await api.get(`/v1/runs/${runId}`, { apiKey: key }))
    ).toMatchObject({ finalDecision: 'bug', review: { status: 'resolved' } })
  })

  test('a blank comment is stored as null; the comment is trimmed', async () => {
    const { org, key, slug } = await setup()
    const first = await runToReview(key, `${slug}@1`)
    const second = await runToReview(key, `${slug}@1`)

    const blank = await json(
      await resolve(org.owner.cookie, first.reviewId, {
        decision: 'bug',
        comment: '   '
      })
    )
    expect(blank.review.comment).toBeNull()
    const trimmed = await json(
      await resolve(org.owner.cookie, second.reviewId, {
        decision: 'bug',
        comment: '  Looks right \n'
      })
    )
    expect(trimmed.review.comment).toBe('Looks right')
  })

  test('concurrent resolves: exactly one wins, and the run agrees with it', async () => {
    const { org, key, slug } = await setup()
    const admin = await addMember(org, 'admin')
    const member = await addMember(org, 'member')
    const reviewers: [TestUser, string][] = [
      [org.owner, 'bug'],
      [admin, 'billing'],
      [member, 'other']
    ]

    for (let round = 0; round < 3; round++) {
      const { runId, reviewId } = await runToReview(key, `${slug}@1`)

      const responses = await Promise.all(
        reviewers.map(([user, decision]) =>
          resolve(user.cookie, reviewId, { decision })
        )
      )

      const statuses = responses.map(response => response.status)
      expect(statuses.filter(status => status === 200)).toHaveLength(1)
      expect(statuses.filter(status => status === 409)).toHaveLength(2)
      const winnerIndex = statuses.indexOf(200)
      const [winner, decision] = reviewers[winnerIndex] as [TestUser, string]
      for (const [index, response] of responses.entries()) {
        const body = await json(response)
        if (index === winnerIndex) {
          expect(body.review.resolvedDecision).toBe(decision)
        } else {
          expect(body).toEqual({
            error: {
              code: 'REVIEW_NOT_PENDING',
              message: 'This review is no longer pending',
              details: { status: 'resolved' }
            }
          })
        }
      }

      expect(await storedReview(reviewId)).toMatchObject({
        status: 'resolved',
        resolvedDecision: decision,
        resolvedBy: winner.id
      })
      expect((await storedRun(runId)).finalDecision).toBe(decision)
    }
    expect(await stats(org.owner.cookie)).toEqual({ pending: 0 })
  })

  test('concurrent resolve and dismiss: one wins', async () => {
    const { org, key, slug } = await setup()
    const member = await addMember(org, 'member')
    const { runId, reviewId } = await runToReview(key, `${slug}@1`)

    const [resolved, dismissed] = await Promise.all([
      resolve(org.owner.cookie, reviewId, { decision: 'bug' }),
      dismiss(member.cookie, reviewId, { comment: 'Not worth it' })
    ])

    expect([resolved.status, dismissed.status].sort()).toEqual([200, 409])
    const stored = await storedReview(reviewId)
    const run = await storedRun(runId)
    if (resolved.status === 200) {
      expect(stored.status).toBe('resolved')
      expect(run.finalDecision).toBe('bug')
      expect((await json(dismissed)).error.details).toEqual({
        status: 'resolved'
      })
    } else {
      expect(stored.status).toBe('dismissed')
      expect(run.finalDecision).toBeNull()
      expect((await json(resolved)).error.details).toEqual({
        status: 'dismissed'
      })
    }
  })

  test('a closed review stays closed', async () => {
    const { org, key, slug } = await setup()
    const { runId, reviewId } = await runToReview(key, `${slug}@1`)
    const cookie = org.owner.cookie
    expect((await resolve(cookie, reviewId, { decision: 'bug' })).status).toBe(
      200
    )

    const again = await resolve(cookie, reviewId, { decision: 'billing' })
    expect(again.status).toBe(409)
    expect((await json(again)).error).toMatchObject({
      code: 'REVIEW_NOT_PENDING',
      details: { status: 'resolved' }
    })
    const dismissed = await dismiss(cookie, reviewId)
    expect(dismissed.status).toBe(409)
    expect((await json(dismissed)).error.code).toBe('REVIEW_NOT_PENDING')

    expect(await storedReview(reviewId)).toMatchObject({
      status: 'resolved',
      resolvedDecision: 'bug'
    })
    expect((await storedRun(runId)).finalDecision).toBe('bug')
  })

  test('a decision outside allowedDecisions is 422 INVALID_DECISION', async () => {
    const { org, key, slug } = await setup()
    const { runId, reviewId } = await runToReview(key, `${slug}@1`)

    for (const decision of ['refund', 'needs_review', 'BUG', 'bug ']) {
      const response = await resolve(org.owner.cookie, reviewId, { decision })
      expect(response.status).toBe(422)
      expect(await json(response)).toEqual({
        error: {
          code: 'INVALID_DECISION',
          message:
            'The decision is not one of the allowed decisions of this review',
          details: { decision, allowedDecisions: ['bug', 'billing', 'other'] }
        }
      })
    }

    expect((await storedReview(reviewId)).status).toBe('pending')
    expect((await storedRun(runId)).finalDecision).toBeNull()
    expect(await stats(org.owner.cookie)).toEqual({ pending: 1 })
  })

  test('an invalid decision on a closed review is still 422', async () => {
    const { org, key, slug } = await setup()
    const { reviewId } = await runToReview(key, `${slug}@1`)
    await dismiss(org.owner.cookie, reviewId)

    const response = await resolve(org.owner.cookie, reviewId, {
      decision: 'refund'
    })
    expect(response.status).toBe(422)
    expect((await json(response)).error.code).toBe('INVALID_DECISION')
  })

  test('validates the body', async () => {
    const { org, key, slug } = await setup()
    const { reviewId } = await runToReview(key, `${slug}@1`)
    const cookie = org.owner.cookie

    for (const [body, path] of [
      [{}, 'decision'],
      [{ decision: '' }, 'decision'],
      [{ decision: 3 }, 'decision'],
      [{ decision: 'bug', comment: 'x'.repeat(2001) }, 'comment'],
      [{ decision: 'bug', comment: 42 }, 'comment'],
      // Postgres can't store a NUL: a 422, not a failed transaction (500).
      [{ decision: 'bug', comment: 'x\u0000' }, 'comment'],
      [{ decision: 'b\u0000ug' }, 'decision']
    ] as const) {
      const response = await resolve(cookie, reviewId, body)
      expect(response.status).toBe(422)
      const payload = await json(response)
      expect(payload.error.code).toBe('VALIDATION_FAILED')
      expect(payload.error.details.issues).toEqual([
        { path, message: expect.any(String), code: expect.any(String) }
      ])
    }
    expect((await storedReview(reviewId)).status).toBe('pending')

    const invalidJson = await api.post(`/api/reviews/${reviewId}/resolve`, {
      cookie,
      body: '{"decision":',
      headers: { 'content-type': 'application/json' }
    })
    expect(invalidJson.status).toBe(400)
    expect((await json(invalidJson)).error.code).toBe('INVALID_JSON')

    const notJson = await api.post(`/api/reviews/${reviewId}/resolve`, {
      cookie,
      body: 'decision=bug',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })
    expect(notJson.status).toBe(415)

    const missing = await api.post(`/api/reviews/${reviewId}/resolve`, {
      cookie
    })
    expect(missing.status).toBe(415)

    // 2000 characters is fine.
    const longest = await resolve(cookie, reviewId, {
      decision: 'bug',
      comment: 'x'.repeat(2000)
    })
    expect(longest.status).toBe(200)
    expect((await json(longest)).review.comment).toHaveLength(2000)
  })

  test('an unknown review is 404, whatever the decision', async () => {
    const org = await createOrg()
    for (const decision of ['bug', 'refund']) {
      const response = await resolve(org.owner.cookie, unknownId(), {
        decision
      })
      expect(response.status).toBe(404)
      expect(await json(response)).toEqual({
        error: { code: 'NOT_FOUND', message: 'Review not found' }
      })
    }
  })

  test('members and admins can resolve; resolvedBy names them', async () => {
    const { org, key, slug } = await setup()
    const member = await addMember(org, 'member')
    const admin = await addMember(org, 'admin')
    const first = await runToReview(key, `${slug}@1`)
    const second = await runToReview(key, `${slug}@1`)

    const byMember = await resolve(member.cookie, first.reviewId, {
      decision: 'other'
    })
    expect(byMember.status).toBe(200)
    expect((await json(byMember)).review.resolvedBy).toEqual({
      id: member.id,
      name: member.name
    })
    const byAdmin = await resolve(admin.cookie, second.reviewId, {
      decision: 'bug'
    })
    expect(byAdmin.status).toBe(200)
    expect((await json(byAdmin)).review.resolvedBy).toEqual({
      id: admin.id,
      name: admin.name
    })

    // Everyone in the org sees who resolved what.
    const resolved = await list(org.owner.cookie, '?status=resolved')
    expect(
      resolved.data.map(
        (review: { id: string; resolvedBy: { id: string } }) => [
          review.id,
          review.resolvedBy.id
        ]
      )
    ).toEqual([
      [second.reviewId, admin.id],
      [first.reviewId, member.id]
    ])
  })

  test('a role without review:resolve can read the inbox but not act on it', async () => {
    const { org, key, slug } = await setup()
    const viewer = await addMember(org, 'member')
    await db
      .update(members)
      .set({ role: 'viewer' })
      .where(
        and(eq(members.userId, viewer.id), eq(members.organizationId, org.id))
      )
    const { reviewId } = await runToReview(key, `${slug}@1`)

    for (const response of [
      await resolve(viewer.cookie, reviewId, { decision: 'bug' }),
      await dismiss(viewer.cookie, reviewId)
    ]) {
      expect(response.status).toBe(403)
      expect(await json(response)).toEqual({
        error: {
          code: 'FORBIDDEN',
          message: 'Insufficient permissions',
          details: { required: { review: ['resolve'] } }
        }
      })
    }
    expect(idsOf(await list(viewer.cookie))).toEqual([reviewId])
    expect(await stats(viewer.cookie)).toEqual({ pending: 1 })
    expect(
      (await api.get(`/api/reviews/${reviewId}`, { cookie: viewer.cookie }))
        .status
    ).toBe(200)
    expect((await storedReview(reviewId)).status).toBe('pending')
  })

  test('the review of an archived template can still be resolved', async () => {
    const { org, key, slug, templateId } = await setup()
    const { runId, reviewId } = await runToReview(key, `${slug}@1`)
    const archived = await api.post(`/api/templates/${templateId}/archive`, {
      cookie: org.owner.cookie
    })
    expect(archived.status).toBe(200)

    expect(idsOf(await list(org.owner.cookie))).toEqual([reviewId])
    const response = await resolve(org.owner.cookie, reviewId, {
      decision: 'other'
    })
    expect(response.status).toBe(200)
    expect((await storedRun(runId)).finalDecision).toBe('other')
  })

  test('an idempotent replay returns the resolved run', async () => {
    const { org, key, slug } = await setup()
    const headers = { 'Idempotency-Key': `review-${unknownId()}` }
    const { runId, reviewId } = await runToReview(key, `${slug}@1`, {
      headers
    })
    await resolve(org.owner.cookie, reviewId, { decision: 'billing' })

    const replay = await api.post(`/v1/decisions/${slug}@1/run`, {
      apiKey: key,
      body: { input: ticket },
      headers
    })
    expect(replay.status).toBe(200)
    expect(replay.headers.get('Idempotent-Replayed')).toBe('true')
    expect(await json(replay)).toMatchObject({
      id: runId,
      finalDecision: 'billing',
      review: { id: reviewId, status: 'resolved', resolvedDecision: 'billing' }
    })
    expect(fake.calls).toHaveLength(1)
  })

  test('the run is only touched through its own review', async () => {
    const { org, key, slug } = await setup()
    const first = await runToReview(key, `${slug}@1`)
    const second = await runToReview(key, `${slug}@1`)

    await resolve(org.owner.cookie, first.reviewId, { decision: 'billing' })

    expect((await storedRun(first.runId)).finalDecision).toBe('billing')
    expect((await storedRun(second.runId)).finalDecision).toBeNull()
    const untouched = await db
      .select({ finalDecision: decisionRuns.finalDecision })
      .from(decisionRuns)
      .where(eq(decisionRuns.id, second.runId))
    expect(untouched).toEqual([{ finalDecision: null }])
  })
})

// ── Dismissing ──────────────────────────────────────────────────────────

describe('POST /api/reviews/:id/dismiss', () => {
  test('dismissing closes the review and leaves finalDecision null', async () => {
    const { org, key, slug } = await setup()
    const { runId, reviewId } = await runToReview(key, `${slug}@1`)

    const response = await dismiss(org.owner.cookie, reviewId, {
      comment: 'Duplicate of T-12'
    })

    expect(response.status).toBe(200)
    const { review } = await json(response)
    expect(review).toMatchObject({
      id: reviewId,
      status: 'dismissed',
      resolvedDecision: null,
      resolvedBy: { id: org.owner.id, name: org.owner.name },
      resolvedAt: expect.any(String),
      comment: 'Duplicate of T-12'
    })

    expect(
      await json(await api.get(`/v1/runs/${runId}`, { apiKey: key }))
    ).toMatchObject({
      decision: 'needs_review',
      finalDecision: null,
      review: { id: reviewId, status: 'dismissed', resolvedDecision: null }
    })
    expect(await stats(org.owner.cookie)).toEqual({ pending: 0 })
    expect(idsOf(await list(org.owner.cookie, '?status=dismissed'))).toEqual([
      reviewId
    ])
    expect((await storedRun(runId)).finalDecision).toBeNull()
  })

  test('the body is optional', async () => {
    const { org, key, slug } = await setup()
    const first = await runToReview(key, `${slug}@1`)
    const second = await runToReview(key, `${slug}@1`)
    const third = await runToReview(key, `${slug}@1`)

    const noBody = await dismiss(org.owner.cookie, first.reviewId)
    expect(noBody.status).toBe(200)
    expect((await json(noBody)).review).toMatchObject({
      status: 'dismissed',
      comment: null
    })
    const emptyObject = await dismiss(org.owner.cookie, second.reviewId, {})
    expect(emptyObject.status).toBe(200)
    const nullComment = await dismiss(org.owner.cookie, third.reviewId, {
      comment: null
    })
    expect(nullComment.status).toBe(200)
    expect((await json(nullComment)).review.comment).toBeNull()
  })

  test('validates the body', async () => {
    const { org, key, slug } = await setup()
    const { reviewId } = await runToReview(key, `${slug}@1`)

    const tooLong = await dismiss(org.owner.cookie, reviewId, {
      comment: 'x'.repeat(2001)
    })
    expect(tooLong.status).toBe(422)
    expect((await json(tooLong)).error.details.issues).toEqual([
      { path: 'comment', message: expect.any(String), code: 'too_big' }
    ])
    // Postgres can't store a NUL: a 422, not a failed update (500).
    const nul = await dismiss(org.owner.cookie, reviewId, {
      comment: 'x\u0000'
    })
    expect(nul.status).toBe(422)
    expect(await json(nul)).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: {
          issues: [
            {
              path: 'comment',
              message: 'Must not contain NUL characters',
              code: 'custom'
            }
          ]
        }
      }
    })
    const invalidJson = await api.post(`/api/reviews/${reviewId}/dismiss`, {
      cookie: org.owner.cookie,
      body: '{',
      headers: { 'content-type': 'application/json' }
    })
    expect(invalidJson.status).toBe(400)
    expect((await storedReview(reviewId)).status).toBe('pending')
  })

  test('twice is 409; an unknown review is 404', async () => {
    const { org, key, slug } = await setup()
    const { reviewId } = await runToReview(key, `${slug}@1`)
    expect((await dismiss(org.owner.cookie, reviewId)).status).toBe(200)

    const again = await dismiss(org.owner.cookie, reviewId)
    expect(again.status).toBe(409)
    expect((await json(again)).error).toMatchObject({
      code: 'REVIEW_NOT_PENDING',
      details: { status: 'dismissed' }
    })
    const resolved = await resolve(org.owner.cookie, reviewId, {
      decision: 'bug'
    })
    expect(resolved.status).toBe(409)

    const unknown = await dismiss(org.owner.cookie, unknownId())
    expect(unknown.status).toBe(404)
    expect((await json(unknown)).error.code).toBe('NOT_FOUND')
  })

  test('members can dismiss', async () => {
    const { org, key, slug } = await setup()
    const member = await addMember(org, 'member')
    const { reviewId } = await runToReview(key, `${slug}@1`)

    const response = await dismiss(member.cookie, reviewId)
    expect(response.status).toBe(200)
    expect((await json(response)).review.resolvedBy).toEqual({
      id: member.id,
      name: member.name
    })
  })
})
