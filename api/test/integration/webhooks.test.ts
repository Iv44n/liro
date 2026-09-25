import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test
} from 'bun:test'
import { eq } from 'drizzle-orm'
import { effectExecutions } from '#modules/effects/effects.schemas'
import { verifyWebhook } from '#modules/effects/signing'
import { getFakeEvaluator } from '#modules/engine/evaluator'
import { db } from '#shared/db/config'
import { classifySupport } from '../fixtures/definitions'
import { json, type RequestOptions, testApi } from '../helpers/app'
import {
  getWebhookEndpoint,
  insertEffectExecution,
  insertWebhookEndpoint,
  testEffectPayload
} from '../helpers/effects'
import {
  addMember,
  createApiKey,
  createOrg,
  type TestOrg
} from '../helpers/factories'
import { insertTemplate } from '../helpers/templates'

/**
 * `/api/webhooks`: CRUD on webhook endpoints, secret reveal/rotation (both
 * signatures accepted for 24h), the test ping, deliveries listing, and
 * `webhook:manage` permissions.
 */

const api = testApi()
const fake = getFakeEvaluator()

beforeEach(() => fake.reset())
afterEach(() => setSystemTime())

const patch = (path: string, options?: RequestOptions) =>
  api.request('PATCH', path, options)

const servers: ReturnType<typeof Bun.serve>[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

function serve(
  handler: (req: Request) => Response | Promise<Response>
): string {
  const server = Bun.serve({ port: 0, fetch: handler })
  servers.push(server)
  return `http://127.0.0.1:${server.port}`
}

interface Captured {
  headers: Headers
  body: string
}

/** A local receiver that records every request it gets and answers with `status`. */
function receiver(status = 200): { url: string; requests: Captured[] } {
  const requests: Captured[] = []
  const url = serve(async req => {
    requests.push({ headers: req.headers, body: await req.text() })
    return new Response('ok', { status })
  })
  return { url, requests }
}

async function create(
  org: TestOrg,
  body: Record<string, unknown>,
  cookie = org.owner.cookie
) {
  const response = await api.post('/api/webhooks', { cookie, body })
  return { response, body: await json(response) }
}

/**
 * There's no per-test DB rollback in this suite (see `factories.ts`): a
 * `queued`, immediately-due `effect_executions` row left behind would be
 * picked up by *any* later `processEffects()` call anywhere in the suite
 * (it claims globally, not per organization). Tests that retry an execution
 * into `queued` clean it back up with this afterward.
 */
async function deleteExecution(id: string): Promise<void> {
  await db.delete(effectExecutions).where(eq(effectExecutions.id, id))
}

/** A real run (so `effect_executions.run_id`'s FK has something to point at). */
async function realRun(
  org: TestOrg
): Promise<{ runId: string; templateId: string }> {
  const { key } = await createApiKey(org, 'live')
  const inserted = await insertTemplate(org, { definition: classifySupport })
  fake.enqueue({
    category: {
      type: 'choice',
      choice: 'bug',
      probabilities: { bug: 0.97, billing: 0.02, other: 0.01 }
    }
  })
  const result = await api.post(`/v1/decisions/${inserted.template.slug}/run`, {
    apiKey: key,
    body: {
      input: { ticket: { message: 'The export button crashes the app' } }
    }
  })
  const body = await json(result)
  return { runId: body.id, templateId: inserted.template.id }
}

describe('GET /api/webhooks', () => {
  test('lists endpoints without their secret', async () => {
    const org = await createOrg()
    const { url } = receiver()
    await insertWebhookEndpoint(org, { url, name: 'Ops' })

    const response = await api.get('/api/webhooks', {
      cookie: org.owner.cookie
    })
    expect(response.status).toBe(200)
    const { data } = await json(response)
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({
      name: 'Ops',
      url,
      enabled: true,
      failureCount: 0
    })
    expect(data[0].secretEncrypted).toBeUndefined()
    expect(data[0].secret).toBeUndefined()
  })

  test('never another organization’s endpoints', async () => {
    const orgA = await createOrg()
    const orgB = await createOrg()
    const { url } = receiver()
    await insertWebhookEndpoint(orgA, { url })

    const response = await api.get('/api/webhooks', {
      cookie: orgB.owner.cookie
    })
    expect((await json(response)).data).toEqual([])
  })

  test('401 without a session', async () => {
    const response = await api.get('/api/webhooks')
    expect(response.status).toBe(401)
  })
})

describe('POST /api/webhooks', () => {
  test('creates an endpoint; the secret is only ever shown here', async () => {
    const org = await createOrg()
    const { url } = receiver()
    const { response, body } = await create(org, { name: 'Ops', url })

    expect(response.status).toBe(201)
    expect(body.endpoint).toMatchObject({
      name: 'Ops',
      url,
      description: null,
      enabled: true,
      failureCount: 0,
      disabledReason: null
    })
    expect(body.secret).toMatch(/^whsec_/)

    const fetched = await json(
      await api.get(`/api/webhooks/${body.endpoint.id}`, {
        cookie: org.owner.cookie
      })
    )
    expect(fetched.endpoint.secret).toBeUndefined()
  })

  test('422 UNSAFE_URL: a non-http(s) protocol', async () => {
    const org = await createOrg()
    const { response, body } = await create(org, {
      name: 'Bad',
      url: 'ftp://example.com'
    })
    expect(response.status).toBe(422)
    expect(body.error.code).toBe('UNSAFE_URL')
  })

  test('422 UNSAFE_URL: embedded credentials', async () => {
    const org = await createOrg()
    const { response, body } = await create(org, {
      name: 'Bad',
      url: 'https://user:pass@example.com/hook'
    })
    expect(response.status).toBe(422)
    expect(body.error.code).toBe('UNSAFE_URL')
  })

  test('422 on an invalid body', async () => {
    const org = await createOrg()
    const { response } = await create(org, { name: '', url: 'not a url' })
    expect(response.status).toBe(422)
  })

  test('members cannot manage webhooks (403); admins and owners can', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const admin = await addMember(org, 'admin')
    const { url } = receiver()

    const byMember = await create(org, { name: 'A', url }, member.cookie)
    expect(byMember.response.status).toBe(403)
    expect(byMember.body.error).toMatchObject({
      code: 'FORBIDDEN',
      details: { required: { webhook: ['manage'] } }
    })

    const byAdmin = await create(org, { name: 'A', url }, admin.cookie)
    expect(byAdmin.response.status).toBe(201)
  })

  test('401 without a session', async () => {
    const response = await api.post('/api/webhooks', {
      body: { name: 'A', url: 'https://x.test' }
    })
    expect(response.status).toBe(401)
  })
})

describe('GET /api/webhooks/:id', () => {
  test('404 for an unknown id, and for another organization’s endpoint', async () => {
    const orgA = await createOrg()
    const orgB = await createOrg()
    const { url } = receiver()
    const { endpoint } = await insertWebhookEndpoint(orgA, { url })

    const missing = await api.get('/api/webhooks/does-not-exist', {
      cookie: orgA.owner.cookie
    })
    expect(missing.status).toBe(404)

    const crossOrg = await api.get(`/api/webhooks/${endpoint.id}`, {
      cookie: orgB.owner.cookie
    })
    expect(crossOrg.status).toBe(404)
  })
})

describe('PATCH /api/webhooks/:id', () => {
  test('updates name/description/url', async () => {
    const org = await createOrg()
    const { url } = receiver()
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    const { url: newUrl } = receiver()

    const response = await patch(`/api/webhooks/${endpoint.id}`, {
      cookie: org.owner.cookie,
      body: { name: 'Renamed', description: 'A description', url: newUrl }
    })
    expect(response.status).toBe(200)
    expect((await json(response)).endpoint).toMatchObject({
      name: 'Renamed',
      description: 'A description',
      url: newUrl
    })
  })

  test('re-validates a changed url (422 UNSAFE_URL)', async () => {
    const org = await createOrg()
    const { url } = receiver()
    const { endpoint } = await insertWebhookEndpoint(org, { url })

    const response = await patch(`/api/webhooks/${endpoint.id}`, {
      cookie: org.owner.cookie,
      body: { url: 'ftp://example.com' }
    })
    expect(response.status).toBe(422)
    expect((await json(response)).error.code).toBe('UNSAFE_URL')
  })

  test('enabled: true resets failureCount and clears disabledReason', async () => {
    const org = await createOrg()
    const { url } = receiver()
    const { endpoint } = await insertWebhookEndpoint(org, {
      url,
      enabled: false,
      failureCount: 42
    })
    await patch(`/api/webhooks/${endpoint.id}`, {
      cookie: org.owner.cookie,
      body: { enabled: false, name: 'Still disabled' }
    })
    // Disabling (or an unrelated field) alone doesn't touch failureCount.
    expect((await getWebhookEndpoint(endpoint.id))?.failureCount).toBe(42)

    const response = await patch(`/api/webhooks/${endpoint.id}`, {
      cookie: org.owner.cookie,
      body: { enabled: true }
    })
    const { endpoint: updated } = await json(response)
    expect(updated).toMatchObject({
      enabled: true,
      failureCount: 0,
      disabledReason: null
    })
  })

  test('members cannot patch (403)', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const { url } = receiver()
    const { endpoint } = await insertWebhookEndpoint(org, { url })

    const response = await patch(`/api/webhooks/${endpoint.id}`, {
      cookie: member.cookie,
      body: { name: 'Nope' }
    })
    expect(response.status).toBe(403)
  })
})

describe('DELETE /api/webhooks/:id', () => {
  test('409 ENDPOINT_IN_USE while an effect binding references it; deletable after', async () => {
    const org = await createOrg()
    const { url } = receiver()
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    const { template } = await insertTemplate(org, {
      definition: classifySupport
    })

    const created = await api.post(`/api/templates/${template.id}/effects`, {
      cookie: org.owner.cookie,
      body: { on: '*', type: 'webhook', config: { endpointId: endpoint.id } }
    })
    expect(created.status).toBe(201)
    const { binding } = await json(created)

    const blocked = await api.delete(`/api/webhooks/${endpoint.id}`, {
      cookie: org.owner.cookie
    })
    expect(blocked.status).toBe(409)
    const blockedBody = await json(blocked)
    expect(blockedBody.error.code).toBe('ENDPOINT_IN_USE')
    expect(blockedBody.error.details.templates).toEqual([
      { id: template.id, name: template.name }
    ])

    await api.delete(`/api/templates/${template.id}/effects/${binding.id}`, {
      cookie: org.owner.cookie
    })
    const allowed = await api.delete(`/api/webhooks/${endpoint.id}`, {
      cookie: org.owner.cookie
    })
    expect(allowed.status).toBe(204)
    expect(await getWebhookEndpoint(endpoint.id)).toBeNull()
  })

  test('404 for an unknown endpoint', async () => {
    const org = await createOrg()
    const response = await api.delete('/api/webhooks/does-not-exist', {
      cookie: org.owner.cookie
    })
    expect(response.status).toBe(404)
  })

  test('members cannot delete (403)', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const { url } = receiver()
    const { endpoint } = await insertWebhookEndpoint(org, { url })

    const response = await api.delete(`/api/webhooks/${endpoint.id}`, {
      cookie: member.cookie
    })
    expect(response.status).toBe(403)
  })
})

describe('GET /api/webhooks/:id/secret', () => {
  test('reveals the current secret', async () => {
    const org = await createOrg()
    const { url } = receiver()
    const { response, body } = await create(org, { name: 'Ops', url })
    expect(response.status).toBe(201)

    const revealed = await api.get(`/api/webhooks/${body.endpoint.id}/secret`, {
      cookie: org.owner.cookie
    })
    expect(revealed.status).toBe(200)
    expect((await json(revealed)).secret).toBe(body.secret)
  })

  test('members cannot reveal it (403)', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const { url } = receiver()
    const { endpoint } = await insertWebhookEndpoint(org, { url })

    const response = await api.get(`/api/webhooks/${endpoint.id}/secret`, {
      cookie: member.cookie
    })
    expect(response.status).toBe(403)
  })
})

describe('POST /api/webhooks/:id/rotate-secret', () => {
  test('a fresh secret, with the old one valid for exactly 24h', async () => {
    const org = await createOrg()
    const target = receiver()
    const { body } = await create(org, {
      name: 'Ops',
      url: target.url
    })
    const originalSecret = body.secret as string
    const endpointId = body.endpoint.id as string

    const rotated = await api.post(
      `/api/webhooks/${endpointId}/rotate-secret`,
      {
        cookie: org.owner.cookie
      }
    )
    expect(rotated.status).toBe(200)
    const { secret: newSecret } = await json(rotated)
    expect(newSecret).toMatch(/^whsec_/)
    expect(newSecret).not.toBe(originalSecret)

    // Within the 24h window, a delivery is signed with both secrets.
    const ping = await api.post(`/api/webhooks/${endpointId}/test`, {
      cookie: org.owner.cookie
    })
    expect((await json(ping)).ok).toBe(true)
    const [request] = target.requests
    if (!request) throw new Error('receiver got no request')
    expect(() =>
      verifyWebhook({
        body: request.body,
        headers: request.headers,
        secret: originalSecret
      })
    ).not.toThrow()
    expect(() =>
      verifyWebhook({
        body: request.body,
        headers: request.headers,
        secret: newSecret
      })
    ).not.toThrow()

    // After 24h, only the new secret verifies.
    setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000 + 1000))
    target.requests.length = 0
    await api.post(`/api/webhooks/${endpointId}/test`, {
      cookie: org.owner.cookie
    })
    const [later] = target.requests
    if (!later) throw new Error('receiver got no request')
    expect(() =>
      verifyWebhook({
        body: later.body,
        headers: later.headers,
        secret: originalSecret
      })
    ).toThrow()
    expect(() =>
      verifyWebhook({
        body: later.body,
        headers: later.headers,
        secret: newSecret
      })
    ).not.toThrow()
  })

  test('members cannot rotate it (403)', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const { url } = receiver()
    const { endpoint } = await insertWebhookEndpoint(org, { url })

    const response = await api.post(
      `/api/webhooks/${endpoint.id}/rotate-secret`,
      {
        cookie: member.cookie
      }
    )
    expect(response.status).toBe(403)
  })
})

describe('POST /api/webhooks/:id/test', () => {
  test('sends a signed webhook.test event now, not queued', async () => {
    const org = await createOrg()
    const target = receiver()
    const { endpoint, secret } = await insertWebhookEndpoint(org, {
      url: target.url
    })

    const response = await api.post(`/api/webhooks/${endpoint.id}/test`, {
      cookie: org.owner.cookie
    })
    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body).toMatchObject({ ok: true, status: 200 })
    expect(typeof body.durationMs).toBe('number')

    expect(target.requests).toHaveLength(1)
    const [request] = target.requests
    if (!request) throw new Error('receiver got no request')
    expect(JSON.parse(request.body)).toMatchObject({ type: 'webhook.test' })
    expect(() =>
      verifyWebhook({ body: request.body, headers: request.headers, secret })
    ).not.toThrow()
  })

  test('a non-2xx response: ok: false with the status', async () => {
    const org = await createOrg()
    const target = receiver(500)
    const { endpoint } = await insertWebhookEndpoint(org, { url: target.url })

    const response = await api.post(`/api/webhooks/${endpoint.id}/test`, {
      cookie: org.owner.cookie
    })
    const body = await json(response)
    expect(body.ok).toBe(false)
    expect(body.status).toBe(500)
  })

  test('an unreachable receiver: ok: false with an error, no status', async () => {
    const org = await createOrg()
    // A port nothing listens on: the server is stopped right after picking one.
    const closedPort = Bun.serve({ port: 0, fetch: () => new Response('ok') })
    const url = `http://127.0.0.1:${closedPort.port}`
    closedPort.stop(true)
    const { endpoint } = await insertWebhookEndpoint(org, { url })

    const response = await api.post(`/api/webhooks/${endpoint.id}/test`, {
      cookie: org.owner.cookie
    })
    const body = await json(response)
    expect(body.ok).toBe(false)
    expect(body.status).toBeUndefined()
    expect(typeof body.error).toBe('string')
  })

  test('members cannot send a test ping (403)', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const { url } = receiver()
    const { endpoint } = await insertWebhookEndpoint(org, { url })

    const response = await api.post(`/api/webhooks/${endpoint.id}/test`, {
      cookie: member.cookie
    })
    expect(response.status).toBe(403)
  })
})

describe('GET /api/webhooks/:id/deliveries', () => {
  async function seedDeliveries(
    org: TestOrg,
    endpointId: string,
    count: number
  ) {
    const { runId, templateId } = await realRun(org)
    for (let i = 0; i < count; i++) {
      await insertEffectExecution(org, {
        runId,
        templateId,
        endpointId,
        type: 'webhook',
        event: 'decision.made',
        target: 'example.com',
        status: i % 2 === 0 ? 'succeeded' : 'dead',
        payload: testEffectPayload(runId)
      })
    }
  }

  test('paginates, newest first, and filters by status', async () => {
    const org = await createOrg()
    const { url } = receiver()
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    await seedDeliveries(org, endpoint.id, 5)

    const first = await json(
      await api.get(`/api/webhooks/${endpoint.id}/deliveries?limit=3`, {
        cookie: org.owner.cookie
      })
    )
    expect(first.data).toHaveLength(3)
    expect(first.nextCursor).not.toBeNull()

    const second = await json(
      await api.get(
        `/api/webhooks/${endpoint.id}/deliveries?limit=3&cursor=${first.nextCursor}`,
        { cookie: org.owner.cookie }
      )
    )
    expect(second.data).toHaveLength(2)
    expect(second.nextCursor).toBeNull()

    const ids = [...first.data, ...second.data].map(
      (row: { id: string }) => row.id
    )
    expect(new Set(ids).size).toBe(5)

    const dead = await json(
      await api.get(`/api/webhooks/${endpoint.id}/deliveries?status=dead`, {
        cookie: org.owner.cookie
      })
    )
    expect(dead.data.length).toBeGreaterThan(0)
    expect(
      dead.data.every((row: { status: string }) => row.status === 'dead')
    ).toBe(true)
  })

  test('404 for another organization’s endpoint', async () => {
    const orgA = await createOrg()
    const orgB = await createOrg()
    const { url } = receiver()
    const { endpoint } = await insertWebhookEndpoint(orgA, { url })

    const response = await api.get(`/api/webhooks/${endpoint.id}/deliveries`, {
      cookie: orgB.owner.cookie
    })
    expect(response.status).toBe(404)
  })
})

describe('GET /api/runs/:id/effects', () => {
  test('every execution of the run, oldest first', async () => {
    const org = await createOrg()
    const { url } = receiver()
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    const { runId, templateId } = await realRun(org)

    // A terminal status: `queued` would be immediately due and picked up by
    // any later `processEffects()` call elsewhere in the suite.
    const first = await insertEffectExecution(org, {
      runId,
      templateId,
      endpointId: endpoint.id,
      type: 'webhook',
      event: 'decision.made',
      target: 'example.com',
      status: 'succeeded',
      payload: testEffectPayload(runId)
    })
    const second = await insertEffectExecution(org, {
      runId,
      templateId,
      type: 'email',
      event: 'decision.made',
      target: org.owner.email,
      status: 'succeeded',
      payload: testEffectPayload(runId)
    })

    const response = await api.get(`/api/runs/${runId}/effects`, {
      cookie: org.owner.cookie
    })
    expect(response.status).toBe(200)
    const { data } = await json(response)
    expect(data.map((row: { id: string }) => row.id)).toEqual([
      first.id,
      second.id
    ])
    expect(data[0]).toMatchObject({ type: 'webhook', endpointId: endpoint.id })
    expect(data[1]).toMatchObject({ type: 'email', endpointId: null })
  })

  test('404 for a run outside the caller’s organization', async () => {
    const orgA = await createOrg()
    const orgB = await createOrg()
    const { runId } = await realRun(orgA)

    const response = await api.get(`/api/runs/${runId}/effects`, {
      cookie: orgB.owner.cookie
    })
    expect(response.status).toBe(404)
  })

  test('404 for an unknown run', async () => {
    const org = await createOrg()
    const response = await api.get('/api/runs/does-not-exist/effects', {
      cookie: org.owner.cookie
    })
    expect(response.status).toBe(404)
  })

  test('401 without a session', async () => {
    const org = await createOrg()
    const { runId } = await realRun(org)
    const response = await api.get(`/api/runs/${runId}/effects`)
    expect(response.status).toBe(401)
  })
})

describe('POST /api/effect-executions/:id/retry', () => {
  test('dead -> queued, attempts reset, due now', async () => {
    const org = await createOrg()
    const { url } = receiver()
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    const { runId, templateId } = await realRun(org)
    const execution = await insertEffectExecution(org, {
      runId,
      templateId,
      endpointId: endpoint.id,
      type: 'webhook',
      event: 'decision.made',
      target: 'example.com',
      status: 'dead',
      attempts: 8,
      maxAttempts: 8,
      payload: testEffectPayload(runId)
    })

    const response = await api.post(
      `/api/effect-executions/${execution.id}/retry`,
      { cookie: org.owner.cookie }
    )
    expect(response.status).toBe(200)
    const { execution: retried } = await json(response)
    expect(retried).toMatchObject({ status: 'queued', attempts: 0 })
    expect(new Date(retried.runAt).getTime()).toBeLessThanOrEqual(Date.now())
    await deleteExecution(execution.id)
  })

  test('canceled -> queued too', async () => {
    const org = await createOrg()
    const { runId, templateId } = await realRun(org)
    const execution = await insertEffectExecution(org, {
      runId,
      templateId,
      type: 'email',
      event: 'decision.made',
      target: org.owner.email,
      status: 'canceled',
      payload: testEffectPayload(runId)
    })

    const response = await api.post(
      `/api/effect-executions/${execution.id}/retry`,
      { cookie: org.owner.cookie }
    )
    expect(response.status).toBe(200)
    await deleteExecution(execution.id)
  })

  test('409 EXECUTION_NOT_RETRYABLE for a queued/running/succeeded execution', async () => {
    const org = await createOrg()
    const { runId, templateId } = await realRun(org)
    const execution = await insertEffectExecution(org, {
      runId,
      templateId,
      type: 'email',
      event: 'decision.made',
      target: org.owner.email,
      status: 'succeeded',
      payload: testEffectPayload(runId)
    })

    const response = await api.post(
      `/api/effect-executions/${execution.id}/retry`,
      { cookie: org.owner.cookie }
    )
    expect(response.status).toBe(409)
    const body = await json(response)
    expect(body.error).toMatchObject({
      code: 'EXECUTION_NOT_RETRYABLE',
      details: { status: 'succeeded' }
    })
  })

  test('404 for an unknown execution', async () => {
    const org = await createOrg()
    const response = await api.post(
      '/api/effect-executions/does-not-exist/retry',
      { cookie: org.owner.cookie }
    )
    expect(response.status).toBe(404)
  })

  test('404 for another organization’s execution', async () => {
    const orgA = await createOrg()
    const orgB = await createOrg()
    const { runId, templateId } = await realRun(orgA)
    const execution = await insertEffectExecution(orgA, {
      runId,
      templateId,
      type: 'email',
      event: 'decision.made',
      target: orgA.owner.email,
      status: 'dead',
      payload: testEffectPayload(runId)
    })

    const response = await api.post(
      `/api/effect-executions/${execution.id}/retry`,
      { cookie: orgB.owner.cookie }
    )
    expect(response.status).toBe(404)
  })

  test('members cannot retry (403)', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const { runId, templateId } = await realRun(org)
    const execution = await insertEffectExecution(org, {
      runId,
      templateId,
      type: 'email',
      event: 'decision.made',
      target: org.owner.email,
      status: 'dead',
      payload: testEffectPayload(runId)
    })

    const response = await api.post(
      `/api/effect-executions/${execution.id}/retry`,
      { cookie: member.cookie }
    )
    expect(response.status).toBe(403)
  })
})
