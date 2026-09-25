import { beforeEach, describe, expect, test } from 'bun:test'
import { eq } from 'drizzle-orm'
import { auth } from '#modules/auth/config'
import {
  type CanonicalAnswer,
  getFakeEvaluator
} from '#modules/engine/evaluator'
import { decisionRuns } from '#modules/runs/runs.schemas'
import { db } from '#shared/db/config'
import { classifySupport, decideRefund } from '../fixtures/definitions'
import { json, testApi } from '../helpers/app'
import {
  addMember,
  createApiKey,
  createOrg,
  createUser,
  setActiveOrganization,
  type TestOrg
} from '../helpers/factories'
import { type InsertedTemplate, insertTemplate } from '../helpers/templates'

/**
 * Tenant isolation across every resource that has an id or a slug: org B —
 * through its session, its members or its API key — can neither see nor
 * change org A's templates, versions, runs and reviews, and a slug always
 * resolves inside the caller's own organization.
 */

const api = testApi()
const fake = getFakeEvaluator()

beforeEach(() => fake.reset())

const choice = (
  picked: string,
  probabilities: Record<string, number>
): Record<string, CanonicalAnswer> => ({
  category: { type: 'choice', choice: picked, probabilities }
})

const ticket = { ticket: { message: 'The export button crashes the app' } }

interface Tenant {
  org: TestOrg
  key: string
  template: InsertedTemplate
}

/**
 * Org A: `classifySupport` as `<slug>` with 1.0, 2.0 and a draft, one
 * decided run and one run waiting for review. Org B: `decideRefund` under
 * the SAME slug, 1.0 and a draft.
 */
interface World {
  slug: string
  a: Tenant & { decidedRunId: string; reviewRunId: string; reviewId: string }
  b: Tenant
}

async function createWorld(): Promise<World> {
  const slug = `shared-${Math.random().toString(36).slice(2, 8)}`

  const orgA = await createOrg()
  const keyA = await createApiKey(orgA, 'live')
  const templateA = await insertTemplate(orgA, {
    definition: classifySupport,
    slug,
    name: 'A support',
    versions: [
      { major: 1, minor: 0 },
      { major: 2, minor: 0 }
    ],
    draft: true
  })

  const orgB = await createOrg()
  const keyB = await createApiKey(orgB, 'live')
  const templateB = await insertTemplate(orgB, {
    definition: decideRefund,
    slug,
    name: 'B refunds',
    draft: true
  })

  fake.enqueue(choice('bug', { bug: 0.97, billing: 0.02, other: 0.01 }))
  const decided = await json(
    await api.post(`/v1/decisions/${slug}@1/run`, {
      apiKey: keyA.key,
      body: { input: ticket }
    })
  )
  fake.enqueue(choice('bug', { bug: 0.5, billing: 0.3, other: 0.2 }))
  const reviewed = await json(
    await api.post(`/v1/decisions/${slug}@1/run`, {
      apiKey: keyA.key,
      body: { input: ticket }
    })
  )
  if (decided.decision !== 'bug' || reviewed.decision !== 'needs_review') {
    throw new Error('world: org A runs did not decide as scripted')
  }
  fake.reset()

  return {
    slug,
    a: {
      org: orgA,
      key: keyA.key,
      template: templateA,
      decidedRunId: decided.id,
      reviewRunId: reviewed.id,
      reviewId: reviewed.review.id
    },
    b: { org: orgB, key: keyB.key, template: templateB }
  }
}

const expectNotFound = async (response: Response, code = 'NOT_FOUND') => {
  expect(response.status).toBe(404)
  expect((await json(response)).error.code).toBe(code)
}

const runsOf = (organizationId: string) =>
  db
    .select({ id: decisionRuns.id })
    .from(decisionRuns)
    .where(eq(decisionRuns.organizationId, organizationId))

// ── Templates ───────────────────────────────────────────────────────────

describe('templates by id', () => {
  test("org B cannot read org A's template, draft or versions", async () => {
    const { a, b } = await createWorld()
    const cookie = b.org.owner.cookie
    const id = a.template.template.id
    const versionId = a.template.versions[0]?.id

    for (const path of [
      `/api/templates/${id}`,
      `/api/templates/${id}/draft`,
      `/api/templates/${id}/versions`,
      `/api/templates/${id}/versions/${versionId}`
    ]) {
      await expectNotFound(await api.get(path, { cookie }))
    }

    const listed = await json(
      await api.get('/api/templates?status=all', { cookie })
    )
    expect(listed.data.map((t: { id: string }) => t.id)).toEqual([
      b.template.template.id
    ])
  })

  test("org B cannot change org A's template", async () => {
    const { a, b } = await createWorld()
    const cookie = b.org.owner.cookie
    const id = a.template.template.id
    const draftHash = a.template.draft?.definitionHash ?? ''
    const versionId = a.template.versions[0]?.id

    const attempts = [
      api.request('PATCH', `/api/templates/${id}`, {
        cookie,
        body: { name: 'Hijacked', slug: 'hijacked' }
      }),
      api.request('PUT', `/api/templates/${id}/draft`, {
        cookie,
        headers: { 'If-Match': `"${draftHash}"` },
        body: { definition: decideRefund }
      }),
      api.post(`/api/templates/${id}/publish`, {
        cookie,
        body: { expectedDraftHash: draftHash, major: true }
      }),
      api.post(`/api/templates/${id}/archive`, { cookie }),
      api.post(`/api/templates/${id}/restore`, { cookie }),
      api.post(`/api/templates/${id}/versions/${versionId}/deprecate`, {
        cookie
      }),
      api.post(`/api/templates/${id}/versions/${versionId}/undeprecate`, {
        cookie
      }),
      api.post(`/api/templates/${id}/draft/test`, {
        cookie,
        body: { input: ticket }
      })
    ]
    for (const response of await Promise.all(attempts)) {
      await expectNotFound(response)
    }
    expect(fake.calls).toHaveLength(0)

    // Org A sees its template exactly as it was.
    const owner = a.org.owner.cookie
    const { template } = await json(
      await api.get(`/api/templates/${id}`, { cookie: owner })
    )
    expect(template).toMatchObject({
      name: 'A support',
      slug: a.template.template.slug,
      status: 'active',
      hasDraft: true,
      latestVersion: { version: '2.0', status: 'published' }
    })
    const versions = await json(
      await api.get(`/api/templates/${id}/versions`, { cookie: owner })
    )
    expect(
      versions.data.map((v: { version: string; status: string }) => [
        v.version,
        v.status
      ])
    ).toEqual([
      ['2.0', 'published'],
      ['1.0', 'published']
    ])
    const draft = await json(
      await api.get(`/api/templates/${id}/draft`, { cookie: owner })
    )
    expect(draft.definitionHash).toBe(draftHash)
  })

  test("org A's version ids don't work under org B's own template", async () => {
    const { a, b } = await createWorld()
    const cookie = b.org.owner.cookie
    const ownId = b.template.template.id
    const foreignVersion = a.template.versions[0]?.id

    await expectNotFound(
      await api.get(`/api/templates/${ownId}/versions/${foreignVersion}`, {
        cookie
      })
    )
    await expectNotFound(
      await api.post(
        `/api/templates/${ownId}/versions/${foreignVersion}/deprecate`,
        { cookie }
      )
    )

    const version = await db.query.decisionTemplateVersions.findFirst({
      where: { id: foreignVersion }
    })
    expect(version?.status).toBe('published')
  })

  test('a slug taken in A is free in another organization', async () => {
    const { slug, a } = await createWorld()
    const other = await createOrg()
    const body = {
      name: 'Mine too',
      slug,
      source: { type: 'blank', kind: 'custom' }
    }

    const created = await api.post('/api/templates', {
      cookie: other.owner.cookie,
      body
    })
    expect(created.status).toBe(201)
    expect((await json(created)).template.slug).toBe(slug)

    // …while in A it is taken.
    const taken = await api.post('/api/templates', {
      cookie: a.org.owner.cookie,
      body
    })
    expect(taken.status).toBe(409)
    expect((await json(taken)).error.code).toBe('SLUG_TAKEN')
  })

  test('a user in both organizations only sees the active one', async () => {
    const { a, b } = await createWorld()
    const user = await createUser()
    await auth.api.addMember({
      body: { userId: user.id, organizationId: a.org.id, role: 'admin' }
    })
    await auth.api.addMember({
      body: { userId: user.id, organizationId: b.org.id, role: 'admin' }
    })
    const idA = a.template.template.id
    const idB = b.template.template.id

    await setActiveOrganization(user, b.org.id)
    await expectNotFound(
      await api.get(`/api/templates/${idA}`, { cookie: user.cookie })
    )
    await expectNotFound(
      await api.get(`/api/reviews/${a.reviewId}`, { cookie: user.cookie })
    )
    await expectNotFound(
      await api.get(`/api/runs/${a.decidedRunId}`, { cookie: user.cookie })
    )
    expect(
      (await api.get(`/api/templates/${idB}`, { cookie: user.cookie })).status
    ).toBe(200)
    // The session on /v1 acts for the active organization too.
    const decisionsInB = await json(
      await api.get('/v1/decisions', { cookie: user.cookie })
    )
    expect(decisionsInB.data.map((d: { kind: string }) => d.kind)).toEqual([
      'decide'
    ])

    await setActiveOrganization(user, a.org.id)
    expect(
      (await api.get(`/api/templates/${idA}`, { cookie: user.cookie })).status
    ).toBe(200)
    expect(
      (await api.get(`/api/reviews/${a.reviewId}`, { cookie: user.cookie }))
        .status
    ).toBe(200)
    await expectNotFound(
      await api.get(`/api/templates/${idB}`, { cookie: user.cookie })
    )
  })
})

// ── Decisions by slug ───────────────────────────────────────────────────

describe('decisions by slug', () => {
  test("B's key runs B's own template when both have the same slug", async () => {
    const { slug, a, b } = await createWorld()
    const runsOfA = await runsOf(a.org.id)
    fake.enqueue({ answer: { type: 'boolean', probability: 0.97 } })

    const response = await api.post(`/v1/decisions/${slug}@1/run`, {
      apiKey: b.key,
      body: { input: { request: 'Arrived broken', amount: 40 } }
    })

    expect(response.status).toBe(200)
    const run = await json(response)
    expect(run).toMatchObject({
      template: slug,
      version: '1.0',
      decision: 'approve',
      answers: { answer: { type: 'boolean' } }
    })
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]?.organizationId).toBe(b.org.id)
    expect(Object.keys(fake.calls[0]?.questions ?? {})).toEqual(['answer'])

    const stored = await db.query.decisionRuns.findFirst({
      where: { id: run.id }
    })
    expect(stored).toMatchObject({
      organizationId: b.org.id,
      templateId: b.template.template.id,
      versionId: b.template.versions[0]?.id
    })
    expect(await runsOf(a.org.id)).toEqual(runsOfA)

    // A's input contract doesn't apply in B.
    const wrongInput = await api.post(`/v1/decisions/${slug}@1/run`, {
      apiKey: b.key,
      body: { input: ticket }
    })
    expect(wrongInput.status).toBe(422)
    expect(
      (await json(wrongInput)).error.details.issues.map(
        (issue: { path: string }) => issue.path
      )
    ).toContain('input.request')

    // A still runs its own classify template under the same slug.
    fake.enqueue(choice('billing', { bug: 0.01, billing: 0.98, other: 0.01 }))
    const inA = await json(
      await api.post(`/v1/decisions/${slug}@1/run`, {
        apiKey: a.key,
        body: { input: ticket }
      })
    )
    expect(inA.decision).toBe('billing')
    expect(fake.calls[1]?.organizationId).toBe(a.org.id)
  })

  test("versions only A has don't exist for B", async () => {
    const { slug, a, b } = await createWorld()

    for (const response of [
      await api.post(`/v1/decisions/${slug}@2/run`, {
        apiKey: b.key,
        body: { input: { request: 'x', amount: 1 } }
      }),
      await api.get(`/v1/decisions/${slug}@2.0`, { apiKey: b.key })
    ]) {
      await expectNotFound(response, 'VERSION_NOT_FOUND')
    }
    expect(fake.calls).toHaveLength(0)

    // A's `slug` floats to 2.0; B's to its 1.0.
    const inA = await api.get(`/v1/decisions/${slug}`, { apiKey: a.key })
    expect(await json(inA)).toMatchObject({ version: '2.0', kind: 'classify' })
    const inB = await api.get(`/v1/decisions/${slug}`, { apiKey: b.key })
    expect(await json(inB)).toMatchObject({
      version: '1.0',
      kind: 'decide',
      labels: ['approve', 'reject']
    })
  })

  test('a slug only A has is unknown to B', async () => {
    const { a, b } = await createWorld()
    const onlyA = await insertTemplate(a.org, { definition: classifySupport })
    const slug = onlyA.template.slug

    for (const response of [
      await api.get(`/v1/decisions/${slug}`, { apiKey: b.key }),
      await api.post(`/v1/decisions/${slug}@1/run`, {
        apiKey: b.key,
        body: { input: ticket }
      }),
      await api.post(`/v1/decisions/${slug}/run`, {
        cookie: b.org.owner.cookie,
        body: { input: ticket }
      })
    ]) {
      await expectNotFound(response, 'TEMPLATE_NOT_FOUND')
    }
    expect(fake.calls).toHaveLength(0)
  })

  test("B's archived template never falls back to A's", async () => {
    const { slug, a, b } = await createWorld()
    const archived = await api.post(
      `/api/templates/${b.template.template.id}/archive`,
      { cookie: b.org.owner.cookie }
    )
    expect(archived.status).toBe(200)

    const response = await api.post(`/v1/decisions/${slug}@1/run`, {
      apiKey: b.key,
      body: { input: ticket }
    })
    expect(response.status).toBe(410)
    expect((await json(response)).error.code).toBe('TEMPLATE_ARCHIVED')
    expect(fake.calls).toHaveLength(0)

    // A is unaffected by B archiving its namesake.
    fake.enqueue(choice('bug', { bug: 0.97, billing: 0.02, other: 0.01 }))
    const inA = await api.post(`/v1/decisions/${slug}@1/run`, {
      apiKey: a.key,
      body: { input: ticket }
    })
    expect(inA.status).toBe(200)
  })

  test("B's API key lists only B's decisions", async () => {
    const { slug, a, b } = await createWorld()
    await insertTemplate(a.org, { definition: classifySupport })

    const inB = await json(await api.get('/v1/decisions', { apiKey: b.key }))
    expect(inB.data).toEqual([
      expect.objectContaining({
        slug,
        name: 'B refunds',
        kind: 'decide',
        version: '1.0',
        labels: ['approve', 'reject']
      })
    ])

    const inA = await json(await api.get('/v1/decisions', { apiKey: a.key }))
    expect(inA.data).toHaveLength(2)
    expect(
      inA.data.every((d: { kind: string }) => d.kind === 'classify')
    ).toBeTrue()

    // B's test key too.
    const testKey = await createApiKey(b.org, 'test')
    const inBTest = await json(
      await api.get('/v1/decisions', { apiKey: testKey.key })
    )
    expect(inBTest.data.map((d: { slug: string }) => d.slug)).toEqual([slug])
  })

  test('idempotency keys are per organization', async () => {
    const { slug, a, b } = await createWorld()
    const headers = { 'Idempotency-Key': 'order-42' }

    fake.enqueue(choice('bug', { bug: 0.97, billing: 0.02, other: 0.01 }))
    const inA = await api.post(`/v1/decisions/${slug}@1/run`, {
      apiKey: a.key,
      body: { input: ticket },
      headers
    })
    fake.enqueue({ answer: { type: 'boolean', probability: 0.02 } })
    const inB = await api.post(`/v1/decisions/${slug}@1/run`, {
      apiKey: b.key,
      body: { input: { request: 'Changed my mind', amount: 10 } },
      headers
    })

    expect(inA.status).toBe(200)
    expect(inB.status).toBe(200)
    expect(inB.headers.get('Idempotent-Replayed')).toBeNull()
    const runA = await json(inA)
    const runB = await json(inB)
    expect(runB.id).not.toBe(runA.id)
    expect(runB.decision).toBe('reject')
    expect(fake.calls).toHaveLength(2)
  })
})

// ── Runs ────────────────────────────────────────────────────────────────

describe('runs', () => {
  test("org B cannot read org A's runs", async () => {
    const { a, b } = await createWorld()

    for (const runId of [a.decidedRunId, a.reviewRunId]) {
      await expectNotFound(
        await api.get(`/api/runs/${runId}`, { cookie: b.org.owner.cookie })
      )
      await expectNotFound(
        await api.get(`/v1/runs/${runId}`, { apiKey: b.key })
      )
      await expectNotFound(
        await api.get(`/v1/runs/${runId}`, { cookie: b.org.owner.cookie })
      )
    }

    const listed = await json(
      await api.get('/api/runs', { cookie: b.org.owner.cookie })
    )
    expect(listed).toEqual({ data: [], nextCursor: null })
    const filtered = await json(
      await api.get(`/api/runs?templateId=${a.template.template.id}`, {
        cookie: b.org.owner.cookie
      })
    )
    expect(filtered).toEqual({ data: [], nextCursor: null })

    // A reads them fine.
    expect(
      (await api.get(`/v1/runs/${a.decidedRunId}`, { apiKey: a.key })).status
    ).toBe(200)
    const inA = await json(
      await api.get('/api/runs', { cookie: a.org.owner.cookie })
    )
    expect(inA.data.map((run: { id: string }) => run.id).sort()).toEqual(
      [a.decidedRunId, a.reviewRunId].sort()
    )
  })

  test("a member of B cannot read A's runs either", async () => {
    const { a, b } = await createWorld()
    const member = await addMember(b.org, 'member')

    await expectNotFound(
      await api.get(`/api/runs/${a.decidedRunId}`, { cookie: member.cookie })
    )
    await expectNotFound(
      await api.get(`/v1/runs/${a.decidedRunId}`, { cookie: member.cookie })
    )
  })
})

// ── Reviews ─────────────────────────────────────────────────────────────

describe('reviews', () => {
  test("org B cannot read, resolve or dismiss org A's reviews", async () => {
    const { a, b } = await createWorld()
    const cookie = b.org.owner.cookie

    await expectNotFound(
      await api.get(`/api/reviews/${a.reviewId}`, { cookie })
    )
    await expectNotFound(
      await api.post(`/api/reviews/${a.reviewId}/resolve`, {
        cookie,
        body: { decision: 'bug' }
      })
    )
    // Not even a hint that the decision is invalid for it.
    await expectNotFound(
      await api.post(`/api/reviews/${a.reviewId}/resolve`, {
        cookie,
        body: { decision: 'approve' }
      })
    )
    await expectNotFound(
      await api.post(`/api/reviews/${a.reviewId}/dismiss`, { cookie })
    )

    expect(
      await json(await api.get('/api/reviews?status=all', { cookie }))
    ).toEqual({ data: [], nextCursor: null })
    expect(
      await json(
        await api.get(`/api/reviews?templateId=${a.template.template.id}`, {
          cookie
        })
      )
    ).toEqual({ data: [], nextCursor: null })
    expect(await json(await api.get('/api/reviews/stats', { cookie }))).toEqual(
      { pending: 0 }
    )

    // A's review is untouched.
    const owner = a.org.owner.cookie
    const { review } = await json(
      await api.get(`/api/reviews/${a.reviewId}`, { cookie: owner })
    )
    expect(review).toMatchObject({
      status: 'pending',
      resolvedBy: null,
      comment: null
    })
    expect(
      await json(await api.get('/api/reviews/stats', { cookie: owner }))
    ).toEqual({ pending: 1 })
    const run = await json(
      await api.get(`/v1/runs/${a.reviewRunId}`, { apiKey: a.key })
    )
    expect(run.finalDecision).toBeNull()
  })

  test("a member of B cannot resolve A's review", async () => {
    const { a, b } = await createWorld()
    const member = await addMember(b.org, 'member')

    await expectNotFound(
      await api.post(`/api/reviews/${a.reviewId}/resolve`, {
        cookie: member.cookie,
        body: { decision: 'bug' }
      })
    )

    const resolved = await api.post(`/api/reviews/${a.reviewId}/resolve`, {
      cookie: a.org.owner.cookie,
      body: { decision: 'bug' }
    })
    expect(resolved.status).toBe(200)
  })

  test("B's reviews and A's reviews stay in their inboxes", async () => {
    const { slug, a, b } = await createWorld()
    const inB = await json(
      await api.post(`/v1/decisions/${slug}@1/run`, {
        apiKey: b.key,
        body: { input: { request: 'Refund my car', amount: 25_000 } }
      })
    )
    expect(inB.decision).toBe('needs_review')

    const listB = await json(
      await api.get('/api/reviews', { cookie: b.org.owner.cookie })
    )
    expect(listB.data.map((r: { id: string }) => r.id)).toEqual([inB.review.id])
    expect(listB.data[0].template).toEqual({
      id: b.template.template.id,
      slug,
      name: 'B refunds'
    })
    const listA = await json(
      await api.get('/api/reviews', { cookie: a.org.owner.cookie })
    )
    expect(listA.data.map((r: { id: string }) => r.id)).toEqual([a.reviewId])

    // A can't touch B's review either.
    await expectNotFound(
      await api.post(`/api/reviews/${inB.review.id}/dismiss`, {
        cookie: a.org.owner.cookie
      })
    )
  })
})

// ── API keys ────────────────────────────────────────────────────────────

describe('API keys', () => {
  test("an API key doesn't open the dashboard API", async () => {
    const { a } = await createWorld()

    for (const path of [
      '/api/templates',
      `/api/templates/${a.template.template.id}`,
      '/api/runs',
      '/api/reviews'
    ]) {
      expect((await api.get(path, { apiKey: a.key })).status).toBe(401)
    }
  })
})
