import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test
} from 'bun:test'
import { and, eq } from 'drizzle-orm'
import { alertEvents, alertRules } from '#modules/alerts/alerts.schemas'
import {
  ALERTS_JOB_TYPE,
  alertsEvaluateHandler,
  type CreateAlertRuleInput,
  createAlertRule,
  evaluateAlerts,
  registerAlertsJobs
} from '#modules/alerts/alerts.service'
import { verifyWebhook } from '#modules/effects/signing'
import { db } from '#shared/db/config'
import { jobs } from '#shared/jobs/jobs.schemas'
import { processJobs } from '#shared/jobs/queue'
import {
  clearPeriodicJobs,
  periodicJobDefinitions
} from '#shared/jobs/scheduler'
import { classifySupport } from '../fixtures/definitions'
import { json, testApi } from '../helpers/app'
import {
  insertWebhookEndpoint,
  type WebhookEndpointRow,
  webhookBinding
} from '../helpers/effects'
import { emailsTo, sentEmails } from '../helpers/email'
import {
  addMember,
  createOrg,
  removeMember,
  type TestOrg
} from '../helpers/factories'
import { insertRun } from '../helpers/runs'
import { insertTemplate } from '../helpers/templates'

/**
 * `alerts.schemas.ts` (`alert_rules`/`alert_events`), `alerts.service.ts`
 * (CRUD, `/api/alerts` routes, and the `alerts.evaluate` periodic sweep:
 * metric scoping/windowing, cooldown, notifications) and the wiring into
 * `shared/jobs/{scheduler,queue}.ts`. `evaluate.ts`'s own per-metric math is
 * unit-tested in `evaluate.test.ts`.
 */

const api = testApi()

afterEach(() => setSystemTime())

// Every test starts from a known-clean periodic-job registry: exactly
// `alerts.evaluate`'s own definition. `registerPeriodicJob` just appends
// (`shared/jobs/scheduler.ts`) and the registry is process-wide shared state
// across every test file in one `bun test` run (see `retention.test.ts`'s
// own `beforeEach` for the same reasoning) — this restores `alerts.evaluate`
// before every test here regardless of what an earlier file left behind.
beforeEach(() => {
  clearPeriodicJobs()
  registerAlertsJobs()
})

const servers: ReturnType<typeof Bun.serve>[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

interface Captured {
  headers: Headers
  body: string
}

/** A local receiver that records every request it gets and answers with `status`. */
function receiver(status = 200): { url: string; requests: Captured[] } {
  const requests: Captured[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      requests.push({ headers: req.headers, body: await req.text() })
      return new Response('ok', { status })
    }
  })
  servers.push(server)
  return { url: `http://127.0.0.1:${server.port}`, requests }
}

async function setup(): Promise<{ org: TestOrg; templateId: string }> {
  const org = await createOrg()
  const inserted = await insertTemplate(org, { definition: classifySupport })
  return { org, templateId: inserted.template.id }
}

type CreateBody = Record<string, unknown>

async function createRule(
  org: TestOrg,
  body: CreateBody,
  cookie = org.owner.cookie
) {
  const response = await api.post('/api/alerts', { cookie, body })
  return { response, body: await json(response) }
}

/** Directly through the service (bypassing HTTP) for tests that only care about `evaluateAlerts`. Defaults to an email rule targeting the org owner. */
async function insertRule(
  org: TestOrg,
  overrides: Partial<CreateAlertRuleInput> & {
    metric: CreateAlertRuleInput['metric']
  }
) {
  const channel = overrides.channel ?? 'email'
  const base = {
    templateId: null,
    threshold: 1,
    windowMinutes: 60,
    minRuns: 1,
    enabled: true,
    cooldownMinutes: 60,
    channel,
    target:
      channel === 'webhook'
        ? { endpointId: 'placeholder' }
        : { to: [org.owner.email] }
  }
  const input = { ...base, ...overrides } as CreateAlertRuleInput
  return createAlertRule(
    { organizationId: org.id, userId: org.owner.id },
    input
  )
}

const HOUR_MS = 60 * 60 * 1000

describe('POST /api/alerts', () => {
  test('creates an email rule', async () => {
    const { org } = await setup()
    const { response, body } = await createRule(org, {
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: [org.owner.email] }
    })
    expect(response.status).toBe(201)
    expect(body.rule).toMatchObject({
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: [org.owner.email] },
      templateId: null,
      enabled: true,
      windowMinutes: 60,
      minRuns: 20,
      cooldownMinutes: 60
    })
  })

  test('creates a webhook rule targeting an existing endpoint', async () => {
    const { org } = await setup()
    const { endpoint } = await insertWebhookEndpoint(org, {
      url: 'http://127.0.0.1:1'
    })
    const { response, body } = await createRule(org, {
      metric: 'jev_errors',
      threshold: 5,
      channel: 'webhook',
      target: { endpointId: endpoint.id }
    })
    expect(response.status).toBe(201)
    expect(body.rule.target).toEqual({ endpointId: endpoint.id })
  })

  test('a templateId scopes the rule to one template', async () => {
    const { org, templateId } = await setup()
    const { response, body } = await createRule(org, {
      templateId,
      metric: 'failure_rate',
      threshold: 0.5,
      channel: 'email',
      target: { to: [org.owner.email] }
    })
    expect(response.status).toBe(201)
    expect(body.rule.templateId).toBe(templateId)
  })

  test('422 when threshold is out of [0, 1] for a rate metric', async () => {
    const { org } = await setup()
    const { response, body } = await createRule(org, {
      metric: 'review_rate',
      threshold: 1.5,
      channel: 'email',
      target: { to: [org.owner.email] }
    })
    expect(response.status).toBe(422)
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })

  test('422 when threshold is not a positive integer for a count metric', async () => {
    const { org } = await setup()
    const { response, body } = await createRule(org, {
      metric: 'jev_errors',
      threshold: 0.5,
      channel: 'email',
      target: { to: [org.owner.email] }
    })
    expect(response.status).toBe(422)
    expect(body.error.code).toBe('VALIDATION_FAILED')
  })

  test('422 INVALID_RECIPIENTS when an email target is not a verified member', async () => {
    const { org } = await setup()
    const { response, body } = await createRule(org, {
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: ['nobody@example.com'] }
    })
    expect(response.status).toBe(422)
    expect(body.error.code).toBe('INVALID_RECIPIENTS')
  })

  test('404 when a webhook target endpoint does not exist', async () => {
    const { org } = await setup()
    const { response, body } = await createRule(org, {
      metric: 'jev_errors',
      threshold: 5,
      channel: 'webhook',
      target: { endpointId: 'does-not-exist' }
    })
    expect(response.status).toBe(404)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  test('404 when templateId does not belong to the organization', async () => {
    const { org } = await setup()
    const { response } = await createRule(org, {
      templateId: 'does-not-exist',
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: [org.owner.email] }
    })
    expect(response.status).toBe(404)
  })

  test('members cannot create alert rules (403); admins can', async () => {
    const { org } = await setup()
    const member = await addMember(org, 'member')
    const admin = await addMember(org, 'admin')
    const body = {
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: [org.owner.email] }
    }

    const byMember = await createRule(org, body, member.cookie)
    expect(byMember.response.status).toBe(403)
    expect(byMember.body.error).toMatchObject({
      code: 'FORBIDDEN',
      details: { required: { webhook: ['manage'] } }
    })

    const byAdmin = await createRule(org, body, admin.cookie)
    expect(byAdmin.response.status).toBe(201)
  })

  test('401 without a session', async () => {
    const response = await api.post('/api/alerts', {
      body: {
        metric: 'review_rate',
        threshold: 0.3,
        channel: 'email',
        target: { to: [] }
      }
    })
    expect(response.status).toBe(401)
  })
})

describe('GET /api/alerts', () => {
  test('lists only the organization’s own rules', async () => {
    const { org: orgA } = await setup()
    const { org: orgB } = await setup()
    await createRule(orgA, {
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: [orgA.owner.email] }
    })
    await createRule(orgB, {
      metric: 'failure_rate',
      threshold: 0.2,
      channel: 'email',
      target: { to: [orgB.owner.email] }
    })

    const response = await api.get('/api/alerts', { cookie: orgA.owner.cookie })
    const body = await json(response)
    expect(response.status).toBe(200)
    expect(body).toHaveLength(1)
    expect(body[0].metric).toBe('review_rate')
  })
})

describe('PATCH /api/alerts/:id', () => {
  test('updates fields; omitted fields are unchanged', async () => {
    const { org } = await setup()
    const { body: created } = await createRule(org, {
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: [org.owner.email] }
    })

    const response = await api.request(
      'PATCH',
      `/api/alerts/${created.rule.id}`,
      {
        cookie: org.owner.cookie,
        body: { threshold: 0.6, enabled: false }
      }
    )
    const body = await json(response)
    expect(response.status).toBe(200)
    expect(body.rule).toMatchObject({
      threshold: 0.6,
      enabled: false,
      metric: 'review_rate',
      target: { to: [org.owner.email] }
    })
  })

  test('switches channel + target together', async () => {
    const { org } = await setup()
    const { endpoint } = await insertWebhookEndpoint(org, {
      url: 'http://127.0.0.1:1'
    })
    const { body: created } = await createRule(org, {
      metric: 'jev_errors',
      threshold: 3,
      channel: 'email',
      target: { to: [org.owner.email] }
    })

    const response = await api.request(
      'PATCH',
      `/api/alerts/${created.rule.id}`,
      {
        cookie: org.owner.cookie,
        body: { channel: 'webhook', target: { endpointId: endpoint.id } }
      }
    )
    const body = await json(response)
    expect(response.status).toBe(200)
    expect(body.rule).toMatchObject({
      channel: 'webhook',
      target: { endpointId: endpoint.id }
    })
  })

  test('404 for another organization’s rule', async () => {
    const { org: orgA } = await setup()
    const { org: orgB } = await setup()
    const { body: created } = await createRule(orgA, {
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: [orgA.owner.email] }
    })

    const response = await api.request(
      'PATCH',
      `/api/alerts/${created.rule.id}`,
      {
        cookie: orgB.owner.cookie,
        body: { enabled: false }
      }
    )
    expect(response.status).toBe(404)
  })

  test('members cannot update alert rules (403)', async () => {
    const { org } = await setup()
    const member = await addMember(org, 'member')
    const { body: created } = await createRule(org, {
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: [org.owner.email] }
    })

    const response = await api.request(
      'PATCH',
      `/api/alerts/${created.rule.id}`,
      {
        cookie: member.cookie,
        body: { enabled: false }
      }
    )
    expect(response.status).toBe(403)
  })
})

describe('DELETE /api/alerts/:id', () => {
  test('deletes the rule and cascades its events', async () => {
    const { org } = await setup()
    const { body: created } = await createRule(org, {
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: [org.owner.email] }
    })
    await db.insert(alertEvents).values({
      id: 'test-event-1',
      organizationId: org.id,
      ruleId: created.rule.id,
      value: 0.5,
      threshold: 0.3,
      triggeredAt: new Date()
    })

    const response = await api.delete(`/api/alerts/${created.rule.id}`, {
      cookie: org.owner.cookie
    })
    expect(response.status).toBe(204)

    const rule = await db.query.alertRules.findFirst({
      where: { id: created.rule.id }
    })
    expect(rule).toBeUndefined()
    const event = await db.query.alertEvents.findFirst({
      where: { id: 'test-event-1' }
    })
    expect(event).toBeUndefined()
  })

  test('404 for an unknown id', async () => {
    const { org } = await setup()
    const response = await api.delete('/api/alerts/does-not-exist', {
      cookie: org.owner.cookie
    })
    expect(response.status).toBe(404)
  })

  test('members cannot delete alert rules (403)', async () => {
    const { org } = await setup()
    const member = await addMember(org, 'member')
    const { body: created } = await createRule(org, {
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: [org.owner.email] }
    })

    const response = await api.delete(`/api/alerts/${created.rule.id}`, {
      cookie: member.cookie
    })
    expect(response.status).toBe(403)
  })
})

describe('GET /api/alerts/events', () => {
  test('filters by ruleId, org-scoped, newest first, paginated by cursor', async () => {
    const { org } = await setup()
    const { body: created } = await createRule(org, {
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: [org.owner.email] }
    })
    const { org: otherOrg } = await setup()
    const { body: otherCreated } = await createRule(otherOrg, {
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: [otherOrg.owner.email] }
    })

    const now = new Date()
    for (let i = 0; i < 3; i++) {
      await db.insert(alertEvents).values({
        organizationId: org.id,
        ruleId: created.rule.id,
        value: 0.5,
        threshold: 0.3,
        triggeredAt: new Date(now.getTime() + i * 1000)
      })
    }
    await db.insert(alertEvents).values({
      organizationId: otherOrg.id,
      ruleId: otherCreated.rule.id,
      value: 0.5,
      threshold: 0.3,
      triggeredAt: now
    })

    const first = await api.get(
      `/api/alerts/events?ruleId=${created.rule.id}&limit=2`,
      { cookie: org.owner.cookie }
    )
    const firstBody = await json(first)
    expect(firstBody.data).toHaveLength(2)
    expect(firstBody.nextCursor).not.toBeNull()
    expect(
      firstBody.data.every(
        (e: { ruleId: string }) => e.ruleId === created.rule.id
      )
    ).toBe(true)

    const second = await api.get(
      `/api/alerts/events?ruleId=${created.rule.id}&limit=2&cursor=${firstBody.nextCursor}`,
      { cookie: org.owner.cookie }
    )
    const secondBody = await json(second)
    expect(secondBody.data).toHaveLength(1)
    expect(secondBody.nextCursor).toBeNull()
  })
})

describe('POST /api/alerts/:id/test', () => {
  test('email: sends a test email to verified members, does not record an alert_events row', async () => {
    const { org } = await setup()
    sentEmails().clear()
    const { body: created } = await createRule(org, {
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: [org.owner.email] }
    })

    const response = await api.post(`/api/alerts/${created.rule.id}/test`, {
      cookie: org.owner.cookie
    })
    const body = await json(response)
    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(emailsTo(org.owner.email)).toHaveLength(1)
    expect(emailsTo(org.owner.email)[0]?.subject).toStartWith('[Test]')

    const events = await db.query.alertEvents.findMany({
      where: { ruleId: created.rule.id }
    })
    expect(events).toHaveLength(0)
  })

  test('webhook: sends a signed alert.test POST to the endpoint', async () => {
    const { org } = await setup()
    const { url, requests } = receiver()
    const { endpoint, secret } = await insertWebhookEndpoint(org, { url })
    const { body: created } = await createRule(org, {
      metric: 'jev_errors',
      threshold: 3,
      channel: 'webhook',
      target: { endpointId: endpoint.id }
    })

    const response = await api.post(`/api/alerts/${created.rule.id}/test`, {
      cookie: org.owner.cookie
    })
    const body = await json(response)
    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(requests).toHaveLength(1)

    const request = requests[0]
    if (!request) throw new Error('expected a captured request')
    expect(() =>
      verifyWebhook({ body: request.body, headers: request.headers, secret })
    ).not.toThrow()
    const payload = JSON.parse(request.body)
    expect(payload.type).toBe('alert.test')
    expect(payload.data.ruleId).toBe(created.rule.id)
  })

  test('members cannot send test notifications (403)', async () => {
    const { org } = await setup()
    const member = await addMember(org, 'member')
    const { body: created } = await createRule(org, {
      metric: 'review_rate',
      threshold: 0.3,
      channel: 'email',
      target: { to: [org.owner.email] }
    })

    const response = await api.post(`/api/alerts/${created.rule.id}/test`, {
      cookie: member.cookie
    })
    expect(response.status).toBe(403)
  })
})

describe('evaluateAlerts — review_rate', () => {
  test('triggers when the review share reaches threshold, gated by minRuns', async () => {
    const { org, templateId } = await setup()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const rule = await insertRule(org, {
      metric: 'review_rate',
      threshold: 0.5,
      minRuns: 2,
      windowMinutes: 60
    })

    await insertRun(org, {
      templateId,
      versionId,
      createdAt: now,
      decision: 'needs_review'
    })
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: now,
      decision: 'bug'
    })

    sentEmails().clear()
    // `rulesChecked`/`triggered` are a global-sweep count (this job runs
    // across every organization, like `retention.purge`) — other rules left
    // enabled by earlier tests in this file (in particular the
    // `cooldownMinutes: 0` rule below) can also fire on this same call, so
    // every assertion here is scoped to *this* rule's own events instead.
    await evaluateAlerts(now)

    const events = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(events).toHaveLength(1)
    expect(events[0]?.value).toBe(0.5)
    expect(events[0]?.threshold).toBe(0.5)
    expect(events[0]?.notifiedAt).not.toBeNull()
    expect(emailsTo(org.owner.email)).toHaveLength(1)

    const updatedRule = await db.query.alertRules.findFirst({
      where: { id: rule.id }
    })
    expect(updatedRule?.lastTriggeredAt).not.toBeNull()
  })

  test('does not trigger below minRuns even past the threshold', async () => {
    const { org, templateId } = await setup()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const rule = await insertRule(org, {
      metric: 'review_rate',
      threshold: 0.5,
      minRuns: 5,
      windowMinutes: 60
    })
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: now,
      decision: 'needs_review'
    })

    await evaluateAlerts(now)
    const events = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(events).toHaveLength(0)
  })

  test('a run outside the window does not count', async () => {
    const { org, templateId } = await setup()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const rule = await insertRule(org, {
      metric: 'review_rate',
      threshold: 0.1,
      minRuns: 1,
      windowMinutes: 30
    })
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: new Date(now.getTime() - 2 * HOUR_MS),
      decision: 'needs_review'
    })

    await evaluateAlerts(now)
    const events = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(events).toHaveLength(0)
  })

  test('playground/test-mode runs are excluded from the metric', async () => {
    const { org, templateId } = await setup()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const rule = await insertRule(org, {
      metric: 'review_rate',
      threshold: 0.1,
      minRuns: 1,
      windowMinutes: 60
    })
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: now,
      decision: 'needs_review',
      mode: 'test'
    })
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: now,
      decision: 'needs_review',
      source: 'playground',
      mode: 'test'
    })

    await evaluateAlerts(now)
    const events = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(events).toHaveLength(0)
  })

  test('a disabled rule never fires, even when its metric is well past threshold', async () => {
    const { org, templateId } = await setup()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const rule = await insertRule(org, {
      metric: 'review_rate',
      threshold: 0.1,
      minRuns: 1,
      windowMinutes: 60,
      enabled: false
    })
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: now,
      decision: 'needs_review'
    })

    await evaluateAlerts(now)
    const events = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(events).toHaveLength(0)
  })

  test('cooldown suppresses an immediate re-trigger; cooldownMinutes: 0 never suppresses', async () => {
    const { org, templateId } = await setup()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const cooling = await insertRule(org, {
      metric: 'review_rate',
      threshold: 0.5,
      minRuns: 1,
      windowMinutes: 60,
      cooldownMinutes: 60
    })
    const alwaysOn = await insertRule(org, {
      metric: 'review_rate',
      threshold: 0.5,
      minRuns: 1,
      windowMinutes: 60,
      cooldownMinutes: 0
    })
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: now,
      decision: 'needs_review'
    })

    await evaluateAlerts(now)
    await evaluateAlerts(new Date(now.getTime() + 1))

    const coolingEvents = await db.query.alertEvents.findMany({
      where: { ruleId: cooling.id }
    })
    expect(coolingEvents).toHaveLength(1)

    const alwaysOnEvents = await db.query.alertEvents.findMany({
      where: { ruleId: alwaysOn.id }
    })
    expect(alwaysOnEvents).toHaveLength(2)
  })
})

describe('evaluateAlerts — failure_rate', () => {
  test('triggers on the share of failed runs (out of all runs, not just succeeded)', async () => {
    const { org, templateId } = await setup()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const rule = await insertRule(org, {
      metric: 'failure_rate',
      threshold: 0.4,
      minRuns: 2,
      windowMinutes: 60
    })
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: now,
      status: 'failed'
    })
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: now,
      decision: 'bug'
    })

    await evaluateAlerts(now)
    const events = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(events).toHaveLength(1)
    expect(events[0]?.value).toBe(0.5)
  })
})

describe('evaluateAlerts — jev_errors', () => {
  test('triggers on the plain count of failed runs, ignoring minRuns', async () => {
    const { org, templateId } = await setup()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const rule = await insertRule(org, {
      metric: 'jev_errors',
      threshold: 3,
      minRuns: 1000,
      windowMinutes: 60
    })
    for (let i = 0; i < 3; i++) {
      await insertRun(org, {
        templateId,
        versionId,
        createdAt: now,
        status: 'failed'
      })
    }
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: now,
      decision: 'bug'
    })

    await evaluateAlerts(now)
    const events = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(events).toHaveLength(1)
    expect(events[0]?.value).toBe(3)
  })
})

describe('evaluateAlerts — endpoint_failing', () => {
  async function endpointBoundTo(
    org: TestOrg,
    templateId: string,
    failureCount: number
  ): Promise<WebhookEndpointRow> {
    const { endpoint } = await insertWebhookEndpoint(org, {
      url: 'http://127.0.0.1:1',
      failureCount
    })
    await webhookBinding(org, templateId, endpoint)
    return endpoint
  }

  test('org-wide (templateId: null): the highest failureCount across every endpoint', async () => {
    const { org } = await setup()
    const now = new Date()
    await insertWebhookEndpoint(org, {
      url: 'http://127.0.0.1:1',
      failureCount: 2
    })
    await insertWebhookEndpoint(org, {
      url: 'http://127.0.0.1:1',
      failureCount: 6
    })

    const rule = await insertRule(org, {
      metric: 'endpoint_failing',
      threshold: 5,
      windowMinutes: 60
    })

    await evaluateAlerts(now)
    const events = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(events).toHaveLength(1)
    expect(events[0]?.value).toBe(6)
  })

  test('scoped to a template: only endpoints that template’s webhook bindings use', async () => {
    const { org, templateId } = await setup()
    const now = new Date()
    // Unbound to this template — must not count towards its scoped max.
    await insertWebhookEndpoint(org, {
      url: 'http://127.0.0.1:1',
      failureCount: 9
    })
    await endpointBoundTo(org, templateId, 2)

    const rule = await insertRule(org, {
      templateId,
      metric: 'endpoint_failing',
      threshold: 5,
      windowMinutes: 60
    })

    await evaluateAlerts(now)
    const events = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(events).toHaveLength(0)
  })
})

describe('evaluateAlerts — webhook channel end to end', () => {
  test('sends a signed alert.triggered POST; notifiedAt is set on success', async () => {
    const { org, templateId } = await setup()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const { url, requests } = receiver()
    const { endpoint, secret } = await insertWebhookEndpoint(org, { url })
    const rule = await insertRule(org, {
      metric: 'jev_errors',
      threshold: 1,
      channel: 'webhook',
      target: { endpointId: endpoint.id }
    })
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: now,
      status: 'failed'
    })

    await evaluateAlerts(now)
    expect(requests).toHaveLength(1)

    const request = requests[0]
    if (!request) throw new Error('expected a captured request')
    expect(() =>
      verifyWebhook({ body: request.body, headers: request.headers, secret })
    ).not.toThrow()
    const payload = JSON.parse(request.body)
    expect(payload.type).toBe('alert.triggered')
    expect(payload.data.ruleId).toBe(rule.id)
    expect(payload.data.metric).toBe('jev_errors')

    const events = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(events[0]?.notifiedAt).not.toBeNull()
    expect(events[0]?.notifyError).toBeNull()
  })

  test('notifyError is recorded (not thrown) when the endpoint responds with an error status', async () => {
    const { org, templateId } = await setup()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const { url } = receiver(500)
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    const rule = await insertRule(org, {
      metric: 'jev_errors',
      threshold: 1,
      channel: 'webhook',
      target: { endpointId: endpoint.id }
    })
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: now,
      status: 'failed'
    })

    await evaluateAlerts(now)

    const events = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(events).toHaveLength(1)
    expect(events[0]?.notifiedAt).toBeNull()
    expect(events[0]?.notifyError).toContain('500')

    // The trip is still recorded (and the cooldown still gates it) even
    // though the notification itself failed.
    const updatedRule = await db.query.alertRules.findFirst({
      where: { id: rule.id }
    })
    expect(updatedRule?.lastTriggeredAt).not.toBeNull()
  })
})

describe('evaluateAlerts — email notifyError when no recipient is a current verified member', () => {
  test('the trip is still recorded; notifyError explains why nothing was sent', async () => {
    const { org, templateId } = await setup()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const member = await addMember(org, 'member')
    const rule = await insertRule(org, {
      metric: 'jev_errors',
      threshold: 1,
      channel: 'email',
      target: { to: [member.email] }
    })
    await removeMember(org, member)
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: now,
      status: 'failed'
    })

    sentEmails().clear()
    await evaluateAlerts(now)
    expect(emailsTo(member.email)).toHaveLength(0)

    const events = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(events).toHaveLength(1)
    expect(events[0]?.notifiedAt).toBeNull()
    expect(events[0]?.notifyError).toContain('verified')
  })
})

describe('org isolation', () => {
  test('evaluating one organization’s rules never trips on another’s runs', async () => {
    const { org: orgA } = await setup()
    const { org: orgB } = await setup()
    const insertedB = await insertTemplate(orgB, {
      definition: classifySupport
    })
    const versionB = insertedB.versions[0]?.id
    if (!versionB) throw new Error('expected a published version')
    const now = new Date()

    const ruleA = await insertRule(orgA, {
      metric: 'review_rate',
      threshold: 0.1,
      minRuns: 1,
      windowMinutes: 60
    })
    // Plenty of review-needing runs, but on org B — must never affect org A's rule.
    for (let i = 0; i < 5; i++) {
      await insertRun(orgB, {
        templateId: insertedB.template.id,
        versionId: versionB,
        createdAt: now,
        decision: 'needs_review'
      })
    }

    await evaluateAlerts(now)
    const eventsA = await db.query.alertEvents.findMany({
      where: { ruleId: ruleA.id }
    })
    expect(eventsA).toHaveLength(0)
  })
})

describe('scheduler wiring', () => {
  test('registerAlertsJobs registers a 5-minute periodic definition with a unique dedupeKeyPrefix', () => {
    const definitions = periodicJobDefinitions()
    const alerts = definitions.find(d => d.type === ALERTS_JOB_TYPE)
    expect(alerts).toBeDefined()
    expect(alerts?.dedupeKeyPrefix).toBe('alerts')
    expect(alerts?.intervalMs).toBe(5 * 60_000)
  })

  test('a queued alerts.evaluate job is claimed and completed by the registered handler', async () => {
    const { org, templateId } = await setup()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')

    const future = new Date(Date.now() + 365 * 24 * HOUR_MS)
    setSystemTime(future)

    const rule = await insertRule(org, {
      metric: 'jev_errors',
      threshold: 1,
      minRuns: 0,
      windowMinutes: 60
    })
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: future,
      status: 'failed'
    })

    const [jobRow] = await db
      .insert(jobs)
      .values({ type: ALERTS_JOB_TYPE, payload: {}, runAt: future })
      .returning()
    if (!jobRow) throw new Error('expected a job row')

    // `processJobs` claims the oldest-`runAt` due jobs first, across every
    // type — in a full `bun test` run, other files' own (unrelated) queued
    // rows can occupy a single call's `limit` before this row's turn, since
    // `future` (365 days out) sorts after anything with a real-time `runAt`.
    // Draining in a loop, rather than asserting on one call's aggregate
    // count, makes this deterministic regardless of what else is queued.
    let row = jobRow
    for (let i = 0; i < 20 && row.status === 'queued'; i++) {
      const result = await processJobs({ now: future, limit: 200 })
      if (result.claimed === 0) break
      row = (await db.query.jobs.findFirst({ where: { id: jobRow.id } })) ?? row
    }
    expect(row.status).toBe('succeeded')

    const events = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(events.length).toBeGreaterThanOrEqual(1)
  })

  test('alertsEvaluateHandler runs the sweep using the JS clock (new Date()), so setSystemTime moves it', async () => {
    const { org, templateId } = await setup()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')

    const future = new Date(Date.now() + 366 * 24 * HOUR_MS)
    setSystemTime(future)

    const rule = await insertRule(org, {
      metric: 'jev_errors',
      threshold: 1,
      minRuns: 0,
      windowMinutes: 60
    })
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: future,
      status: 'failed'
    })

    const [jobRow] = await db
      .insert(jobs)
      .values({ type: ALERTS_JOB_TYPE, payload: {}, runAt: future })
      .returning()
    if (!jobRow) throw new Error('expected a job row')

    await alertsEvaluateHandler(jobRow)

    const events = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(events.length).toBeGreaterThanOrEqual(1)
  })
})

describe('cleanup hygiene', () => {
  test("deleting a rule doesn't leave orphaned events for a later evaluateAlerts sweep to choke on", async () => {
    const { org, templateId } = await setup()
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const rule = await insertRule(org, {
      metric: 'jev_errors',
      threshold: 1,
      minRuns: 0,
      windowMinutes: 60
    })
    await insertRun(org, {
      templateId,
      versionId,
      createdAt: now,
      status: 'failed'
    })
    await evaluateAlerts(now)

    await db
      .delete(alertRules)
      .where(
        and(eq(alertRules.id, rule.id), eq(alertRules.organizationId, org.id))
      )

    const remainingEvents = await db.query.alertEvents.findMany({
      where: { ruleId: rule.id }
    })
    expect(remainingEvents).toHaveLength(0)

    // Doesn't throw with the rule gone.
    await expect(
      evaluateAlerts(new Date(now.getTime() + 1))
    ).resolves.toBeDefined()
  })
})
