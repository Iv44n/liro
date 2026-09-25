import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test
} from 'bun:test'
import { eq } from 'drizzle-orm'
import {
  type CanonicalAnswer,
  getFakeEvaluator
} from '#modules/engine/evaluator'
import {
  decisionRuns,
  type RunMode,
  type RunSource,
  usageDaily
} from '#modules/runs/runs.schemas'
import { db } from '#shared/db/config'
import { classifySupport } from '../fixtures/definitions'
import { json, testApi } from '../helpers/app'
import {
  addMember,
  createApiKey,
  createOrg,
  type TestOrg,
  type TestUser
} from '../helpers/factories'
import { insertTemplate } from '../helpers/templates'

/**
 * `GET /api/usage` reads the `usage_daily` rollup (`engine/executor.ts`
 * maintains it, see `run.test.ts` for the write side). Most of these tests
 * seed `usage_daily` directly — the shape and math of the endpoint don't
 * depend on how a row got there — with one end-to-end test through `/v1`
 * and the fake evaluator to prove the two sides actually agree.
 */

const api = testApi()
const fake = getFakeEvaluator()

beforeEach(() => fake.reset())
afterEach(() => setSystemTime())

interface SeedRow {
  day: string
  templateId: string
  source?: RunSource
  mode?: RunMode
  provider?: string
  runs?: number
  evaluations?: number
  inputTokens?: number
  outputTokens?: number
}

async function seedUsage(
  organizationId: string,
  rows: SeedRow[]
): Promise<void> {
  await db.insert(usageDaily).values(
    rows.map(row => ({
      organizationId,
      day: row.day,
      templateId: row.templateId,
      source: row.source ?? 'api',
      mode: row.mode ?? 'live',
      provider: row.provider ?? 'fake',
      runs: row.runs ?? 0,
      evaluations: row.evaluations ?? 0,
      inputTokens: row.inputTokens ?? 0,
      outputTokens: row.outputTokens ?? 0
    }))
  )
}

function getUsage(org: TestOrg, month?: string, user: TestUser = org.owner) {
  const qs = month === undefined ? '' : `?month=${encodeURIComponent(month)}`
  return api.get(`/api/usage${qs}`, { cookie: user.cookie })
}

const choice = (
  picked: string,
  probabilities: Record<string, number> | null
): CanonicalAnswer => ({ type: 'choice', choice: picked, probabilities })

const confidentBug = {
  category: choice('bug', { bug: 0.97, billing: 0.02, other: 0.01 })
}

const ticket = {
  ticket: { subject: 'Export', message: 'The export button crashes the app' },
  customer: { plan: 'pro', email: 'jane@example.com' }
}

describe('GET /api/usage', () => {
  test('aggregates seeded rows into totals and every breakdown, scoped to the requested month', async () => {
    const org = await createOrg()
    const { template: templateA } = await insertTemplate(org, {
      definition: classifySupport,
      name: 'Support triage',
      slug: 'support-triage'
    })
    const { template: templateB } = await insertTemplate(org, {
      definition: classifySupport,
      name: 'Refund check',
      slug: 'refund-check',
      status: 'archived'
    })

    await seedUsage(org.id, [
      {
        day: '2026-02-01',
        templateId: templateA.id,
        source: 'api',
        mode: 'live',
        provider: 'fake',
        runs: 3,
        evaluations: 3,
        inputTokens: 300_000,
        outputTokens: 30_000
      },
      {
        day: '2026-02-02',
        templateId: templateA.id,
        source: 'api',
        mode: 'live',
        provider: 'fake',
        runs: 2,
        evaluations: 2,
        inputTokens: 150_000,
        outputTokens: 15_000
      },
      {
        day: '2026-02-02',
        templateId: templateA.id,
        source: 'playground',
        mode: 'test',
        provider: 'fake',
        runs: 1,
        evaluations: 1,
        inputTokens: 50_000,
        outputTokens: 5_000
      },
      {
        // Archived template — still counted.
        day: '2026-02-03',
        templateId: templateB.id,
        source: 'api',
        mode: 'live',
        provider: 'vercel-gateway',
        runs: 5,
        evaluations: 6,
        inputTokens: 500_000,
        outputTokens: 0
      },
      // Outside the requested month — must not be counted.
      {
        day: '2026-01-31',
        templateId: templateA.id,
        runs: 100,
        evaluations: 100,
        inputTokens: 100_000_000,
        outputTokens: 100
      },
      {
        day: '2026-03-01',
        templateId: templateA.id,
        runs: 100,
        evaluations: 100,
        inputTokens: 100_000_000,
        outputTokens: 100
      }
    ])

    const response = await getUsage(org, '2026-02')
    expect(response.status).toBe(200)
    const body = await json(response)

    expect(body.month).toBe('2026-02')
    expect(body.totals).toEqual({
      runs: 11,
      evaluations: 12,
      inputTokens: 1_000_000,
      outputTokens: 50_000,
      estimatedCostUsd: 0.042
    })
    expect(body.byDay).toEqual([
      { day: '2026-02-01', runs: 3, evaluations: 3, inputTokens: 300_000 },
      { day: '2026-02-02', runs: 3, evaluations: 3, inputTokens: 200_000 },
      { day: '2026-02-03', runs: 5, evaluations: 6, inputTokens: 500_000 }
    ])
    expect(body.byTemplate).toEqual([
      {
        templateId: templateA.id,
        name: 'Support triage',
        slug: 'support-triage',
        runs: 6,
        evaluations: 6,
        inputTokens: 500_000
      },
      {
        templateId: templateB.id,
        name: 'Refund check',
        slug: 'refund-check',
        runs: 5,
        evaluations: 6,
        inputTokens: 500_000
      }
    ])
    expect(body.bySource).toEqual([
      { source: 'api', runs: 10, evaluations: 11, inputTokens: 950_000 },
      { source: 'playground', runs: 1, evaluations: 1, inputTokens: 50_000 }
    ])
    expect(body.byMode).toEqual([
      { mode: 'live', runs: 10, evaluations: 11, inputTokens: 950_000 },
      { mode: 'test', runs: 1, evaluations: 1, inputTokens: 50_000 }
    ])
    expect(body.byProvider).toEqual([
      { provider: 'fake', runs: 6, evaluations: 6, inputTokens: 500_000 },
      {
        provider: 'vercel-gateway',
        runs: 5,
        evaluations: 6,
        inputTokens: 500_000
      }
    ])
  })

  test('defaults to the current UTC month when none is given', async () => {
    setSystemTime(new Date('2026-05-17T12:00:00Z'))
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })

    await seedUsage(org.id, [
      {
        day: '2026-05-01',
        templateId: template.id,
        runs: 4,
        evaluations: 4,
        inputTokens: 1_000
      },
      // Adjacent months — must not leak into the default.
      {
        day: '2026-04-30',
        templateId: template.id,
        runs: 9,
        evaluations: 9,
        inputTokens: 9_000
      },
      {
        day: '2026-06-01',
        templateId: template.id,
        runs: 9,
        evaluations: 9,
        inputTokens: 9_000
      }
    ])

    const body = await json(await getUsage(org))

    expect(body.month).toBe('2026-05')
    expect(body.totals.runs).toBe(4)
  })

  test('December rolls the month-end bound into January of the next year', async () => {
    const org = await createOrg()
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })

    await seedUsage(org.id, [
      {
        day: '2026-12-31',
        templateId: template.id,
        runs: 1,
        evaluations: 1,
        inputTokens: 10
      },
      {
        day: '2027-01-01',
        templateId: template.id,
        runs: 1,
        evaluations: 1,
        inputTokens: 10
      }
    ])

    const body = await json(await getUsage(org, '2026-12'))

    expect(body.totals.runs).toBe(1)
    expect(body.byDay).toEqual([
      { day: '2026-12-31', runs: 1, evaluations: 1, inputTokens: 10 }
    ])
  })

  test('returns all-zero totals and empty breakdowns for a month with no usage', async () => {
    const org = await createOrg()

    const body = await json(await getUsage(org, '2026-02'))

    expect(body).toEqual({
      month: '2026-02',
      totals: {
        runs: 0,
        evaluations: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0
      },
      byDay: [],
      byTemplate: [],
      bySource: [],
      byMode: [],
      byProvider: []
    })
  })

  test.each([
    '2026-13',
    '2026-00',
    '26-01',
    '2026-1',
    '2026/01',
    'not-a-month',
    ''
  ])('rejects an invalid month %p', async month => {
    const org = await createOrg()

    const response = await getUsage(org, month)

    expect(response.status).toBe(422)
    const body = await json(response)
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })

  test('is scoped to the caller organization', async () => {
    const orgA = await createOrg()
    const orgB = await createOrg()
    const { template } = await insertTemplate(orgB, {
      definition: classifySupport
    })

    await seedUsage(orgB.id, [
      {
        day: '2026-02-01',
        templateId: template.id,
        runs: 7,
        evaluations: 7,
        inputTokens: 70
      }
    ])

    const bodyA = await json(await getUsage(orgA, '2026-02'))
    const bodyB = await json(await getUsage(orgB, '2026-02'))

    expect(bodyA.totals.runs).toBe(0)
    expect(bodyB.totals.runs).toBe(7)
  })

  test('any member role can read usage, not just the owner', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')

    const response = await getUsage(org, '2026-02', member)

    expect(response.status).toBe(200)
  })

  test('an unauthenticated request is rejected', async () => {
    const response = await api.get('/api/usage')

    expect(response.status).toBe(401)
  })
})

describe('usage_daily written by real /v1 runs', () => {
  test('a run through /v1 is reflected by GET /api/usage', async () => {
    setSystemTime(new Date('2026-07-10T09:00:00Z'))
    const org = await createOrg()
    const { key } = await createApiKey(org, 'live')
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    fake.enqueue(confidentBug).enqueue(confidentBug)

    const first = await json(
      await api.post(`/v1/decisions/${template.slug}@1/run`, {
        body: { input: ticket },
        apiKey: key
      })
    )
    const second = await json(
      await api.post(`/v1/decisions/${template.slug}@1/run`, {
        body: { input: ticket },
        apiKey: key
      })
    )
    expect(first.id).toEqual(expect.any(String))
    expect(second.id).toEqual(expect.any(String))

    const [expectedRow] = await db
      .select()
      .from(usageDaily)
      .where(eq(usageDaily.organizationId, org.id))
    if (!expectedRow) throw new Error('expected a usage_daily row')

    const body = await json(await getUsage(org, '2026-07'))

    expect(body.totals).toEqual({
      runs: 2,
      evaluations: 2,
      inputTokens: expectedRow.inputTokens,
      outputTokens: expectedRow.outputTokens,
      estimatedCostUsd: expect.closeTo(
        (expectedRow.inputTokens * 0.042) / 1_000_000,
        6
      )
    })
    expect(body.byTemplate).toEqual([
      {
        templateId: template.id,
        name: template.name,
        slug: template.slug,
        runs: 2,
        evaluations: 2,
        inputTokens: expectedRow.inputTokens
      }
    ])
    expect(body.bySource).toEqual([
      {
        source: 'api',
        runs: 2,
        evaluations: 2,
        inputTokens: expectedRow.inputTokens
      }
    ])
    expect(body.byMode).toEqual([
      {
        mode: 'live',
        runs: 2,
        evaluations: 2,
        inputTokens: expectedRow.inputTokens
      }
    ])
  })

  test('usage survives a run purge (decision_runs rows deleted)', async () => {
    setSystemTime(new Date('2026-08-05T09:00:00Z'))
    const org = await createOrg()
    const { key } = await createApiKey(org, 'live')
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })
    fake.enqueue(confidentBug)

    const created = await json(
      await api.post(`/v1/decisions/${template.slug}@1/run`, {
        body: { input: ticket },
        apiKey: key
      })
    )

    const before = await json(await getUsage(org, '2026-08'))
    expect(before.totals.runs).toBe(1)

    // Simulate `retention.purge` deleting the run itself — `usage_daily`
    // has no foreign key to `decision_runs` and must be untouched.
    await db.delete(decisionRuns).where(eq(decisionRuns.id, created.id))

    const after = await json(await getUsage(org, '2026-08'))
    expect(after).toEqual(before)
  })
})
