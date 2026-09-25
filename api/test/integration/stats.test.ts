import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test
} from 'bun:test'
import { classifySupport, decideRefund } from '../fixtures/definitions'
import { json, testApi } from '../helpers/app'
import { addMember, createOrg, type TestOrg } from '../helpers/factories'
import { type InsertRunOptions, insertReview, insertRun } from '../helpers/runs'
import { insertTemplate } from '../helpers/templates'

/**
 * Stats: `GET /api/stats/templates/:id` and `GET /api/stats/overview`.
 * Runs/reviews are seeded straight into the database (`insertRun`,
 * `insertReview`) with chosen timestamps/decisions/confidences, so every
 * aggregate can be checked against a hand-computed expectation instead of
 * driving the engine.
 */

const api = testApi()

afterEach(() => setSystemTime())

const iso = (value: string) => new Date(value)

async function stats(templateId: string, query: string, cookie: string) {
  const response = await api.get(`/api/stats/templates/${templateId}${query}`, {
    cookie
  })
  return { status: response.status, body: await json(response) }
}

async function overview(query: string, cookie: string) {
  const response = await api.get(`/api/stats/overview${query}`, { cookie })
  return { status: response.status, body: await json(response) }
}

describe('GET /api/stats/templates/:id — a week of activity', () => {
  let org: TestOrg
  let templateId: string
  let versionId: string
  const now = iso('2026-01-08T00:00:00.000Z')

  beforeEach(async () => {
    setSystemTime(now)
    org = await createOrg()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    templateId = inserted.template.id
    versionId = inserted.versions[0]?.id ?? ''

    const run = (options: Omit<InsertRunOptions, 'templateId' | 'versionId'>) =>
      insertRun(org, { templateId, versionId, ...options })

    // Day 1: an auto-decided run.
    await run({
      createdAt: iso('2026-01-01T12:00:00.000Z'),
      decision: 'bug',
      confidence: 0.95,
      latencyMs: 100,
      evaluatorLatencyMs: 50,
      inputTokens: 10,
      outputTokens: 5,
      flags: ['urgent']
    })
    // Day 2: another auto-decided run, plus a still-queued one (counts
    // toward `runs` but nothing decision-shaped).
    await run({
      createdAt: iso('2026-01-02T12:00:00.000Z'),
      decision: 'billing',
      confidence: 0.85,
      latencyMs: 200,
      evaluatorLatencyMs: 60,
      inputTokens: 20,
      outputTokens: 8,
      flags: ['urgent', 'followup']
    })
    await run({ createdAt: iso('2026-01-02T09:00:00.000Z'), status: 'queued' })
    // Day 3: a pending review.
    const pending = await run({
      createdAt: iso('2026-01-03T12:00:00.000Z'),
      decision: 'needs_review',
      confidence: 0.4,
      reviewReason: 'low_confidence',
      suggestion: 'bug',
      latencyMs: 150,
      evaluatorLatencyMs: 55,
      inputTokens: 15,
      outputTokens: 6
    })
    await insertReview(org, pending, {
      status: 'pending',
      suggestedDecision: 'bug'
    })
    // Day 4: a review already resolved (agreeing with the suggestion) — the
    // run's own `finalDecision` reflects that, as `resolveReview` would set it.
    const resolved = await run({
      createdAt: iso('2026-01-04T12:00:00.000Z'),
      decision: 'needs_review',
      finalDecision: 'other',
      confidence: 0.3,
      reviewReason: 'low_confidence',
      suggestion: 'other',
      latencyMs: 300,
      evaluatorLatencyMs: 90,
      inputTokens: 25,
      outputTokens: 9,
      flags: ['urgent']
    })
    await insertReview(org, resolved, {
      status: 'resolved',
      suggestedDecision: 'other',
      resolvedDecision: 'other',
      resolvedAt: iso('2026-01-04T14:00:00.000Z')
    })
    // Day 5: two failed runs.
    await run({
      createdAt: iso('2026-01-05T12:00:00.000Z'),
      status: 'failed',
      errorCode: 'AUTH',
      latencyMs: 50
    })
    await run({
      createdAt: iso('2026-01-05T15:00:00.000Z'),
      status: 'failed',
      errorCode: 'BAD_RESPONSE',
      latencyMs: 80
    })
    // Day 6: a perfect-confidence run (edge of the histogram) and a
    // precondition-decided one (no confidence, no evaluator call).
    await run({
      createdAt: iso('2026-01-06T12:00:00.000Z'),
      decision: 'bug',
      confidence: 1,
      latencyMs: 120,
      evaluatorLatencyMs: 45,
      inputTokens: 12,
      outputTokens: 4
    })
    await run({
      createdAt: iso('2026-01-06T18:00:00.000Z'),
      decision: 'other',
      confidence: null,
      latencyMs: 90,
      evaluatorLatencyMs: null
    })
    // Day 7: excluded by the default filters (mode=live, source=api).
    await run({
      createdAt: iso('2026-01-07T12:00:00.000Z'),
      mode: 'test',
      decision: 'bug',
      confidence: 0.9,
      latencyMs: 999,
      evaluatorLatencyMs: 999,
      inputTokens: 999,
      outputTokens: 999
    })
    await run({
      createdAt: iso('2026-01-07T13:00:00.000Z'),
      source: 'playground',
      decision: 'bug',
      confidence: 0.99,
      latencyMs: 888
    })
    // Outside the 7-day window entirely.
    await run({ createdAt: iso('2025-12-30T12:00:00.000Z'), decision: 'bug' })
  })

  test('totals', async () => {
    const { status, body } = await stats(
      templateId,
      '?range=7d',
      org.owner.cookie
    )

    expect(status).toBe(200)
    expect(body.range).toBe('7d')
    expect(body.from).toBe('2026-01-01T00:00:00.000Z')
    expect(body.to).toBe('2026-01-08T00:00:00.000Z')
    expect(body.totals).toEqual({
      runs: 9,
      succeeded: 6,
      failed: 2,
      decided: 4,
      needsReview: 2,
      reviewRate: 0.3333,
      autoDecisionRate: 0.6667,
      avgConfidence: 0.7
    })
  })

  test('decisions and finalDecisions breakdowns', async () => {
    const { body } = await stats(templateId, '?range=7d', org.owner.cookie)

    expect(body.decisions).toEqual([
      { label: 'bug', count: 2, share: 0.3333 },
      { label: 'needs_review', count: 2, share: 0.3333 },
      { label: 'billing', count: 1, share: 0.1667 },
      { label: 'other', count: 1, share: 0.1667 }
    ])
    expect(body.finalDecisions).toEqual([
      { label: 'bug', count: 2 },
      { label: 'other', count: 2 },
      { label: 'billing', count: 1 }
    ])
  })

  test('confidence histogram: 10 bins on [0, 1], confidence = 1 in the last bin, nulls counted separately', async () => {
    const { body } = await stats(templateId, '?range=7d', org.owner.cookie)

    expect(body.confidenceHistogram.nullCount).toBe(1)
    const nonEmpty = body.confidenceHistogram.bins.filter(
      (bin: { count: number }) => bin.count > 0
    )
    expect(nonEmpty).toEqual([
      { from: 0.3, to: 0.4, count: 1 },
      { from: 0.4, to: 0.5, count: 1 },
      { from: 0.8, to: 0.9, count: 1 },
      { from: 0.9, to: 1, count: 2 }
    ])
    expect(body.confidenceHistogram.bins).toHaveLength(10)
  })

  test('latency and evaluatorLatency percentiles (percentile_cont over succeeded runs)', async () => {
    const { body } = await stats(templateId, '?range=7d', org.owner.cookie)

    // latencyMs of succeeded runs, sorted: 90, 100, 120, 150, 200, 300.
    expect(body.latency).toEqual({ p50: 135, p95: 275, p99: 295 })
    // evaluatorLatencyMs, nulls excluded, sorted: 45, 50, 55, 60, 90.
    expect(body.evaluatorLatency).toEqual({ p50: 55, p95: 84 })
  })

  test('tokens sum across every matching run, not only succeeded ones', async () => {
    const { body } = await stats(templateId, '?range=7d', org.owner.cookie)

    expect(body.tokens).toEqual({ input: 82, output: 32 })
  })

  test('errors grouped by code, failed runs only', async () => {
    const { body } = await stats(templateId, '?range=7d', org.owner.cookie)

    expect(body.errors).toEqual([
      { label: 'AUTH', count: 1 },
      { label: 'BAD_RESPONSE', count: 1 }
    ])
  })

  test('flags counted across succeeded runs', async () => {
    const { body } = await stats(templateId, '?range=7d', org.owner.cookie)

    expect(body.flags).toEqual([
      { flag: 'urgent', count: 3 },
      { flag: 'followup', count: 1 }
    ])
  })

  test('daily series with correct bucket boundaries', async () => {
    const { body } = await stats(templateId, '?range=7d', org.owner.cookie)

    expect(body.series).toHaveLength(7)
    expect(
      body.series.map((point: { bucket: string }) => point.bucket)
    ).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
      '2026-01-04T00:00:00.000Z',
      '2026-01-05T00:00:00.000Z',
      '2026-01-06T00:00:00.000Z',
      '2026-01-07T00:00:00.000Z'
    ])
    expect(
      body.series.map(
        ({ bucket, ...rest }: { bucket: string; [k: string]: unknown }) => rest
      )
    ).toEqual([
      { runs: 1, needsReview: 0, failed: 0, avgLatencyMs: 100 },
      { runs: 2, needsReview: 0, failed: 0, avgLatencyMs: 200 },
      { runs: 1, needsReview: 1, failed: 0, avgLatencyMs: 150 },
      { runs: 1, needsReview: 1, failed: 0, avgLatencyMs: 300 },
      { runs: 2, needsReview: 0, failed: 2, avgLatencyMs: null },
      { runs: 2, needsReview: 0, failed: 0, avgLatencyMs: 105 },
      { runs: 0, needsReview: 0, failed: 0, avgLatencyMs: null }
    ])
  })

  test('reviews summary', async () => {
    const { body } = await stats(templateId, '?range=7d', org.owner.cookie)

    expect(body.reviews).toEqual({
      pending: 1,
      resolved: 1,
      agreedWithSuggestion: 1,
      agreementRate: 1,
      medianTimeToResolveMs: 7_200_000
    })
  })

  test('mode: live (default) excludes test-mode runs; all includes them', async () => {
    const live = await stats(templateId, '?range=7d', org.owner.cookie)
    const all = await stats(templateId, '?range=7d&mode=all', org.owner.cookie)
    const testOnly = await stats(
      templateId,
      '?range=7d&mode=test',
      org.owner.cookie
    )

    expect(live.body.totals.runs).toBe(9)
    expect(all.body.totals.runs).toBe(10)
    expect(testOnly.body.totals.runs).toBe(1)
    expect(testOnly.body.totals.succeeded).toBe(1)
  })

  test('source defaults to api; another source must be named explicitly', async () => {
    const defaultSource = await stats(templateId, '?range=7d', org.owner.cookie)
    const playground = await stats(
      templateId,
      '?range=7d&source=playground',
      org.owner.cookie
    )

    expect(defaultSource.body.totals.runs).toBe(9)
    expect(playground.body.totals.runs).toBe(1)
    expect(playground.body.totals.succeeded).toBe(1)
  })

  test('members can read template stats', async () => {
    const member = await addMember(org, 'member')

    const { status } = await stats(templateId, '?range=7d', member.cookie)

    expect(status).toBe(200)
  })
})

describe('GET /api/stats/templates/:id — 24h range', () => {
  test('uses hourly buckets anchored at now - 24h', async () => {
    const now = iso('2026-02-10T10:00:00.000Z')
    setSystemTime(now)
    const org = await createOrg()
    const { template, versions } = await insertTemplate(org, {
      definition: classifySupport
    })
    const versionId = versions[0]?.id ?? ''
    await insertRun(org, {
      templateId: template.id,
      versionId,
      createdAt: iso('2026-02-09T10:30:00.000Z'),
      decision: 'bug',
      confidence: 0.9
    })
    await insertRun(org, {
      templateId: template.id,
      versionId,
      createdAt: iso('2026-02-10T09:30:00.000Z'),
      decision: 'bug',
      confidence: 0.9
    })
    // Just outside the window (25 h ago): excluded.
    await insertRun(org, {
      templateId: template.id,
      versionId,
      createdAt: iso('2026-02-09T08:59:00.000Z'),
      decision: 'bug'
    })

    const { status, body } = await stats(
      template.id,
      '?range=24h',
      org.owner.cookie
    )

    expect(status).toBe(200)
    expect(body.from).toBe('2026-02-09T10:00:00.000Z')
    expect(body.to).toBe('2026-02-10T10:00:00.000Z')
    expect(body.series).toHaveLength(24)
    expect(body.totals.runs).toBe(2)
    expect(body.series[0]).toMatchObject({
      bucket: '2026-02-09T10:00:00.000Z',
      runs: 1
    })
    expect(body.series[23]).toMatchObject({
      bucket: '2026-02-10T09:00:00.000Z',
      runs: 1
    })
    const middle = body.series.slice(1, 23)
    expect(middle.every((point: { runs: number }) => point.runs === 0)).toBe(
      true
    )
  })
})

describe('GET /api/stats/templates/:id — versionId filter', () => {
  test('scopes to one published version', async () => {
    const now = iso('2026-04-01T00:00:00.000Z')
    setSystemTime(now)
    const org = await createOrg()
    const { template, versions } = await insertTemplate(org, {
      definition: classifySupport,
      versions: [
        { major: 1, minor: 0 },
        { major: 1, minor: 1 }
      ]
    })
    const v1 = versions[0]?.id ?? ''
    const v2 = versions[1]?.id ?? ''
    await insertRun(org, {
      templateId: template.id,
      versionId: v1,
      createdAt: iso('2026-03-30T00:00:00.000Z'),
      decision: 'bug'
    })
    await insertRun(org, {
      templateId: template.id,
      versionId: v2,
      createdAt: iso('2026-03-30T01:00:00.000Z'),
      decision: 'billing'
    })

    const scoped = await stats(
      template.id,
      `?range=7d&versionId=${v1}`,
      org.owner.cookie
    )
    const both = await stats(template.id, '?range=7d', org.owner.cookie)

    expect(scoped.body.totals.runs).toBe(1)
    expect(scoped.body.decisions).toEqual([
      { label: 'bug', count: 1, share: 1 }
    ])
    expect(both.body.totals.runs).toBe(2)
  })
})

describe('GET /api/stats/templates/:id — reviews (agreement and median)', () => {
  test('agreement counts a matching resolvedDecision; dismissed reviews are neither pending nor resolved', async () => {
    const now = iso('2026-03-05T00:00:00.000Z')
    setSystemTime(now)
    const org = await createOrg()
    const { template, versions } = await insertTemplate(org, {
      definition: classifySupport
    })
    const versionId = versions[0]?.id ?? ''
    const run = (
      createdAt: Date,
      extra: Partial<Parameters<typeof insertRun>[1]> = {}
    ) =>
      insertRun(org, {
        templateId: template.id,
        versionId,
        createdAt,
        decision: 'needs_review',
        reviewReason: 'low_confidence',
        ...extra
      })

    const agreed = await run(iso('2026-03-01T00:00:00.000Z'), {
      suggestion: 'bug'
    })
    await insertReview(org, agreed, {
      status: 'resolved',
      suggestedDecision: 'bug',
      resolvedDecision: 'bug',
      resolvedAt: iso('2026-03-01T00:00:01.000Z') // +1 s
    })

    const disagreed = await run(iso('2026-03-01T01:00:00.000Z'), {
      suggestion: 'billing'
    })
    await insertReview(org, disagreed, {
      status: 'resolved',
      suggestedDecision: 'billing',
      resolvedDecision: 'other',
      resolvedAt: iso('2026-03-01T01:00:05.000Z') // +5 s
    })

    const pending = await run(iso('2026-03-01T02:00:00.000Z'))
    await insertReview(org, pending, { status: 'pending' })

    const dismissed = await run(iso('2026-03-01T03:00:00.000Z'))
    await insertReview(org, dismissed, {
      status: 'dismissed',
      resolvedAt: iso('2026-03-01T03:00:02.000Z')
    })

    const { body } = await stats(template.id, '?range=7d', org.owner.cookie)

    expect(body.reviews).toEqual({
      pending: 1,
      resolved: 2,
      agreedWithSuggestion: 1,
      agreementRate: 0.5,
      medianTimeToResolveMs: 3_000
    })
  })
})

describe('GET /api/stats/templates/:id — access and validation', () => {
  let org: TestOrg
  let templateId: string

  beforeEach(async () => {
    org = await createOrg()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    templateId = inserted.template.id
  })

  test("another organization's template id is 404", async () => {
    const other = await createOrg()

    const { status, body } = await stats(
      templateId,
      '?range=7d',
      other.owner.cookie
    )

    expect(status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  test('an unknown template id is 404', async () => {
    const { status } = await stats(
      '01900000-0000-7000-8000-000000000000',
      '?range=7d',
      org.owner.cookie
    )

    expect(status).toBe(404)
  })

  test.each([
    ['', 'range'],
    ['?range=8h', 'range'],
    ['?range=7d&mode=staging', 'mode'],
    ['?range=7d&source=cron', 'source'],
    ['?range=7d&versionId=a%00b', 'versionId']
  ])('%s is 422 VALIDATION_FAILED (%s)', async (query, path) => {
    const { status, body } = await stats(templateId, query, org.owner.cookie)

    expect(status).toBe(422)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details.issues[0].path).toBe(path)
  })

  test('requires a session', async () => {
    const response = await api.get(
      `/api/stats/templates/${templateId}?range=7d`
    )

    expect(response.status).toBe(401)
  })
})

describe('GET /api/stats/overview', () => {
  let org: TestOrg
  let busy: { id: string; slug: string; name: string }
  let quiet: { id: string; slug: string; name: string }
  const now = iso('2026-05-08T00:00:00.000Z')

  beforeEach(async () => {
    setSystemTime(now)
    org = await createOrg()
    const a = await insertTemplate(org, {
      definition: classifySupport,
      name: 'Busy template'
    })
    const b = await insertTemplate(org, {
      definition: decideRefund,
      name: 'Quiet template'
    })
    // A third template with no traffic in range: must not appear.
    await insertTemplate(org, { definition: classifySupport, name: 'Idle' })
    busy = a.template
    quiet = b.template
    const busyVersion = a.versions[0]?.id ?? ''
    const quietVersion = b.versions[0]?.id ?? ''

    await insertRun(org, {
      templateId: busy.id,
      versionId: busyVersion,
      createdAt: iso('2026-05-02T00:00:00.000Z'),
      decision: 'bug',
      latencyMs: 100
    })
    await insertRun(org, {
      templateId: busy.id,
      versionId: busyVersion,
      createdAt: iso('2026-05-02T01:00:00.000Z'),
      decision: 'needs_review',
      latencyMs: 200
    })
    await insertRun(org, {
      templateId: busy.id,
      versionId: busyVersion,
      createdAt: iso('2026-05-02T02:00:00.000Z'),
      status: 'failed',
      errorCode: 'AUTH',
      latencyMs: 50
    })
    await insertRun(org, {
      templateId: quiet.id,
      versionId: quietVersion,
      createdAt: iso('2026-05-03T00:00:00.000Z'),
      decision: 'approve',
      latencyMs: 300
    })
    // A test-mode run on the busy template: excluded by the default filters.
    await insertRun(org, {
      templateId: busy.id,
      versionId: busyVersion,
      createdAt: iso('2026-05-04T00:00:00.000Z'),
      mode: 'test',
      decision: 'bug'
    })
  })

  test('totals aggregate across every template, templates list is busiest first', async () => {
    const { status, body } = await overview('?range=7d', org.owner.cookie)

    expect(status).toBe(200)
    expect(body.totals.runs).toBe(4)
    expect(body.totals.succeeded).toBe(3)
    expect(body.totals.failed).toBe(1)
    expect(body.templates.map((t: { id: string }) => t.id)).toEqual([
      busy.id,
      quiet.id
    ])
  })

  test('only templates with a matching run appear, and never with negative rates', async () => {
    const { body } = await overview('?range=7d', org.owner.cookie)

    expect(body.templates).toHaveLength(2)
    const busyRow = body.templates.find((t: { id: string }) => t.id === busy.id)
    const quietRow = body.templates.find(
      (t: { id: string }) => t.id === quiet.id
    )
    expect(busyRow).toMatchObject({
      slug: busy.slug,
      name: 'Busy template',
      runs: 3,
      reviewRate: 0.5, // 1 of 2 succeeded runs needed review
      failureRate: expect.closeTo(1 / 3, 4)
    })
    expect(quietRow).toMatchObject({
      slug: quiet.slug,
      name: 'Quiet template',
      runs: 1,
      reviewRate: 0,
      failureRate: 0
    })
  })

  test('trend is a run-count series aligned with the range buckets', async () => {
    const { body } = await overview('?range=7d', org.owner.cookie)

    const busyRow = body.templates.find((t: { id: string }) => t.id === busy.id)
    const quietRow = body.templates.find(
      (t: { id: string }) => t.id === quiet.id
    )
    expect(busyRow.trend).toHaveLength(7)
    expect(busyRow.trend.reduce((sum: number, n: number) => sum + n, 0)).toBe(3)
    // All 3 of the busy template's runs are on 2026-05-02: bucket index 1
    // (from = 2026-05-01T00:00:00Z).
    expect(busyRow.trend[1]).toBe(3)
    // The quiet template's one run is on 2026-05-03: bucket index 2.
    expect(quietRow.trend[2]).toBe(1)
  })

  test('mode=all includes the test-mode run', async () => {
    const { body } = await overview('?range=7d&mode=all', org.owner.cookie)

    expect(body.totals.runs).toBe(5)
    const busyRow = body.templates.find((t: { id: string }) => t.id === busy.id)
    expect(busyRow.runs).toBe(4)
  })

  test('another organization sees no templates and zero totals', async () => {
    const other = await createOrg()

    const { body } = await overview('?range=7d', other.owner.cookie)

    expect(body.templates).toEqual([])
    expect(body.totals.runs).toBe(0)
  })

  test.each([
    ['', 'range'],
    ['?range=1y', 'range'],
    ['?range=7d&mode=nope', 'mode']
  ])('%s is 422 VALIDATION_FAILED (%s)', async (query, path) => {
    const { status, body } = await overview(query, org.owner.cookie)

    expect(status).toBe(422)
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details.issues[0].path).toBe(path)
  })

  test('requires a session', async () => {
    const response = await api.get('/api/stats/overview?range=7d')

    expect(response.status).toBe(401)
  })
})
