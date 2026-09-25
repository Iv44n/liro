import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  spyOn,
  test
} from 'bun:test'
import {
  claimExecutions,
  completeExecution,
  failExecution,
  processEffects
} from '#modules/effects/delivery'
import { enqueueEffects } from '#modules/effects/dispatcher'
import { verifyWebhook } from '#modules/effects/signing'
import type { CanonicalAnswer } from '#modules/engine/evaluator'
import { getFakeEvaluator } from '#modules/engine/evaluator'
import { db } from '#shared/db/config'
import { classifySupport } from '../fixtures/definitions'
import { json, testApi } from '../helpers/app'
import {
  disableWebhookEndpoint,
  emailBinding,
  executionsOf,
  getExecution,
  getWebhookEndpoint,
  insertEffectExecution,
  insertWebhookEndpoint,
  slackBinding,
  testEffectPayload,
  webhookBinding
} from '../helpers/effects'
import { emailsTo } from '../helpers/email'
import {
  addMember,
  createApiKey,
  createOrg,
  type TestOrg
} from '../helpers/factories'
import { type InsertedTemplate, insertTemplate } from '../helpers/templates'

/**
 * Effects: dispatcher (which bindings fire for which event), the delivery
 * queue (claim, complete/fail with backoff, endpoint auto-disable) and the
 * three handlers (webhook signing, email member-filtering, slack prefix
 * enforcement). Driven through real `/v1` runs and `/api/reviews` resolves
 * (fake evaluator), with bindings/endpoints inserted straight into the
 * database — the routes that would normally manage them aren't wired up yet.
 */

const api = testApi()
const fake = getFakeEvaluator()

beforeEach(() => fake.reset())
afterEach(() => setSystemTime())

const servers: ReturnType<typeof Bun.serve>[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

function serve(handler: (req: Request) => Response | Promise<Response>): {
  url: string
  stop: () => void
} {
  const server = Bun.serve({ port: 0, fetch: handler })
  servers.push(server)
  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true)
  }
}

const confidentBug: Record<string, CanonicalAnswer> = {
  category: {
    type: 'choice',
    choice: 'bug',
    probabilities: { bug: 0.97, billing: 0.02, other: 0.01 }
  }
}
const hesitant: Record<string, CanonicalAnswer> = {
  category: {
    type: 'choice',
    choice: 'bug',
    probabilities: { bug: 0.5, billing: 0.3, other: 0.2 }
  }
}

const ticket = {
  ticket: { subject: 'Export', message: 'The export button crashes the app' }
}

interface Setup {
  org: TestOrg
  key: string
  inserted: InsertedTemplate
  templateId: string
  slug: string
}

async function setup(): Promise<Setup> {
  const org = await createOrg()
  const { key } = await createApiKey(org, 'live')
  const inserted = await insertTemplate(org, { definition: classifySupport })
  return {
    org,
    key,
    inserted,
    templateId: inserted.template.id,
    slug: inserted.template.slug
  }
}

async function runDecision(
  key: string,
  slug: string,
  answers: Record<string, CanonicalAnswer> | null
  // biome-ignore lint/suspicious/noExplicitAny: test assertions inspect arbitrary JSON
): Promise<{ status: number; body: any }> {
  if (answers) fake.enqueue(answers)
  const response = await api.post(`/v1/decisions/${slug}/run`, {
    apiKey: key,
    body: { input: ticket }
  })
  return { status: response.status, body: await json(response) }
}

// ── Dispatcher: which events fire, and for whom ────────────────────────────

describe('dispatcher', () => {
  test('a decided run queues one execution per matching binding, signed and delivered', async () => {
    const { org, key, templateId, slug } = await setup()
    let received: { headers: Headers; body: string } | undefined
    const { url } = serve(async req => {
      received = { headers: req.headers, body: await req.text() }
      return new Response('ok', { status: 200 })
    })
    const { endpoint, secret } = await insertWebhookEndpoint(org, { url })
    await webhookBinding(org, templateId, endpoint, { on: 'bug' })
    // Doesn't match this run's label — proves label matching, not just "any binding fires".
    await webhookBinding(org, templateId, endpoint, { on: 'billing' })

    const { status, body } = await runDecision(key, slug, confidentBug)
    expect(status).toBe(200)
    expect(body.decision).toBe('bug')

    const executions = await executionsOf(body.id)
    expect(executions).toHaveLength(1)
    const execution = executions[0]
    if (!execution) throw new Error('expected one execution')
    expect(execution.event).toBe('decision.made')
    expect(execution.type).toBe('webhook')
    expect(execution.status).toBe('queued')
    expect(execution.target).toBe(new URL(url).host)
    expect(execution.payload.data.run.decision).toBe('bug')
    expect(execution.payload.data.run.id).toBe(body.id)

    const result = await processEffects({ now: new Date() })
    expect(result.succeeded).toBe(1)

    if (!received) throw new Error('the receiver was never called')
    expect(received.headers.get('webhook-id')).toBe(execution.id)
    expect(received.headers.get('content-type')).toBe('application/json')
    expect(received.headers.get('user-agent')).toBe('Liro-Webhooks/1')
    // Throws on a bad signature/timestamp — the assertion is that it doesn't.
    verifyWebhook({ body: received.body, headers: received.headers, secret })

    const delivered = await getExecution(execution.id)
    expect(delivered?.status).toBe('succeeded')
    expect(delivered?.lastResponseStatus).toBe(200)
    expect(delivered?.lastResponseBody).toBe('ok')
    expect(delivered?.completedAt).not.toBeNull()

    const updatedEndpoint = await getWebhookEndpoint(endpoint.id)
    expect(updatedEndpoint?.failureCount).toBe(0)
    expect(updatedEndpoint?.lastSuccessAt).not.toBeNull()
  })

  test('needs_review queues decision.review_requested; resolving queues decision.reviewed with the resolved label', async () => {
    const { org, key, templateId, slug } = await setup()
    const { url } = serve(() => new Response('ok'))
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    await webhookBinding(org, templateId, endpoint, { on: 'needs_review' })
    // Neither should fire while the run is only `needs_review`.
    await webhookBinding(org, templateId, endpoint, { on: 'bug' })
    await webhookBinding(org, templateId, endpoint, { on: 'billing' })

    const { status, body } = await runDecision(key, slug, hesitant)
    expect(status).toBe(200)
    expect(body.decision).toBe('needs_review')
    const reviewId = body.review.id

    let executions = await executionsOf(body.id)
    expect(executions).toHaveLength(1)
    expect(executions[0]?.event).toBe('decision.review_requested')

    const resolveResponse = await api.post(`/api/reviews/${reviewId}/resolve`, {
      cookie: org.owner.cookie,
      body: { decision: 'billing' }
    })
    expect(resolveResponse.status).toBe(200)

    executions = await executionsOf(body.id)
    expect(executions).toHaveLength(2)
    const reviewed = executions.find(
      execution => execution.event === 'decision.reviewed'
    )
    if (!reviewed) throw new Error('expected a decision.reviewed execution')
    expect(reviewed.payload.data.review?.resolvedDecision).toBe('billing')
    expect(reviewed.payload.data.review?.status).toBe('resolved')
    expect(reviewed.payload.data.review?.id).toBe(reviewId)
    // The `bug` binding never fires: the run resolved to `billing`.
    expect(
      executions.some(
        execution =>
          execution.id !== reviewed.id && execution.event === 'decision.made'
      )
    ).toBe(false)
  })

  test('a test-key run and a playground run enqueue nothing (transactional outbox: never a partial write)', async () => {
    const { org, templateId, slug } = await setup()
    const { url } = serve(() => new Response('ok'))
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    await webhookBinding(org, templateId, endpoint, { on: '*' })

    const { key: testKey } = await createApiKey(org, 'test')
    const { status, body } = await runDecision(testKey, slug, confidentBug)
    expect(status).toBe(200)
    expect(await executionsOf(body.id)).toHaveLength(0)

    fake.enqueue(confidentBug)
    const playgroundResponse = await api.post(
      `/api/templates/${templateId}/draft/test`,
      {
        cookie: org.owner.cookie,
        body: { input: ticket }
      }
    )
    expect(playgroundResponse.status).toBe(200)
    const playgroundBody = await json(playgroundResponse)
    expect(await executionsOf(playgroundBody.run.id)).toHaveLength(0)
  })

  test('an evaluator failure stores no execution (no partial write when the run itself failed)', async () => {
    const { org, key, templateId, slug } = await setup()
    const { url } = serve(() => new Response('ok'))
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    await webhookBinding(org, templateId, endpoint, { on: '*' })

    fake.fail('BAD_RESPONSE')
    const { status, body } = await runDecision(key, slug, null)
    expect(status).toBe(500)
    const runId = body.error?.details?.runId
    expect(typeof runId).toBe('string')
    expect(await executionsOf(runId)).toHaveLength(0)
  })

  test('a webhook binding whose endpoint is disabled is skipped entirely', async () => {
    const { org, key, templateId, slug } = await setup()
    const { url } = serve(() => new Response('ok'))
    const { endpoint } = await insertWebhookEndpoint(org, {
      url,
      enabled: false
    })
    await webhookBinding(org, templateId, endpoint, { on: '*' })

    const { body } = await runDecision(key, slug, confidentBug)
    expect(await executionsOf(body.id)).toHaveLength(0)
  })

  test('major matching: a binding pinned to another major is skipped; a null-major binding always matches', async () => {
    const { org, key, templateId, slug } = await setup() // published at major 1
    const { url } = serve(() => new Response('ok'))
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    await webhookBinding(org, templateId, endpoint, { on: '*', major: 2 })
    await webhookBinding(org, templateId, endpoint, { on: '*', major: null })

    const { body } = await runDecision(key, slug, confidentBug)
    const executions = await executionsOf(body.id)
    expect(executions).toHaveLength(1)
  })

  test('a disabled binding never fires, even when its `on` matches', async () => {
    const { org, key, templateId, slug } = await setup()
    const { url } = serve(() => new Response('ok'))
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    await webhookBinding(org, templateId, endpoint, { on: '*', enabled: false })

    const { body } = await runDecision(key, slug, confidentBug)
    expect(await executionsOf(body.id)).toHaveLength(0)
  })

  test('enqueueEffects stamps the inserted execution with its injected `now`, not the wall clock (same clock-injection convention as `buildEffectPayload`)', async () => {
    const { org, key, templateId, slug } = await setup()
    const { url } = serve(() => new Response('ok'))
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    // `on`/`major` chosen so the real run below (label `bug`) never matches
    // it on its own — only the manual `enqueueEffects` call below does
    // (with an explicit, different `label`) — so this test creates exactly
    // one execution, not an extra one from the app's own automatic dispatch.
    await webhookBinding(org, templateId, endpoint, {
      on: 'now-injection-probe',
      major: null
    })

    const { body } = await runDecision(key, slug, confidentBug)
    const runId = body.id
    expect(await executionsOf(runId)).toHaveLength(0)

    // Far in the future (not the past): the row this creates is `queued`
    // and never falls due for any other test's own `processEffects()` call
    // sharing this DB, so it can't leak into an unrelated test's counts —
    // belt and suspenders alongside the label decoupling above.
    const injectedNow = new Date('2099-06-15T12:00:00.000Z')
    await db.transaction(tx =>
      enqueueEffects(tx, {
        organizationId: org.id,
        runId,
        templateId,
        major: null,
        mode: 'live',
        event: 'decision.made',
        label: 'now-injection-probe',
        now: injectedNow,
        payloadFor: () => testEffectPayload(runId)
      })
    )

    const executions = await executionsOf(runId)
    const injected = executions.find(
      execution => execution.runAt.getTime() === injectedNow.getTime()
    )
    expect(injected).toBeDefined()
  })
})

// ── Claim safety: TOCTOU ───────────────────────────────────────────────────

describe('claim safety', () => {
  test('claimExecutions never resurrects a row a separate transaction fully claimed and completed between its unlocked candidate scan and its row-level lock', async () => {
    const { org, key, templateId, slug } = await setup()
    const { url } = serve(() => new Response('ok'))
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    await webhookBinding(org, templateId, endpoint, { on: '*' })

    const { body } = await runDecision(key, slug, confidentBug)
    const [execution] = await executionsOf(body.id)
    if (!execution) throw new Error('expected one execution')

    const now = new Date()
    // Reproduces the exact race: the outer `claimExecutions` call's
    // candidate scan (step 1, unlocked) has already listed this row when a
    // *fully separate* transaction claims and completes it entirely — by
    // the time the outer call's row-level lock (step 2) runs, the row is
    // `succeeded` and held by no one, so plain SKIP LOCKED wouldn't skip it.
    // The fix's status/run_at re-check (both in step 2 and the final
    // update) is what actually excludes it.
    const claimed = await claimExecutions({
      now,
      limit: 10,
      afterCandidateSelect: async () => {
        const other = await claimExecutions({ now, limit: 10 })
        const row = other.find(row => row.id === execution.id)
        if (!row) {
          throw new Error('expected the concurrent claim to win the row first')
        }
        await completeExecution(
          row,
          { status: 200, body: 'ok', durationMs: 1 },
          now
        )
      }
    })

    expect(claimed.map(row => row.id)).not.toContain(execution.id)

    const after = await getExecution(execution.id)
    expect(after?.status).toBe('succeeded')
    expect(after?.attempts).toBe(1)
    expect(after?.completedAt).not.toBeNull()
  })
})

// ── Handlers ────────────────────────────────────────────────────────────

describe('handlers', () => {
  test('webhook: an endpoint disabled after queuing (but before delivery) fails permanently', async () => {
    // The dispatcher only skips *already*-disabled endpoints at queue time
    // (see the `dispatcher` describe above); this is the handler's own
    // belt-and-braces check for an endpoint disabled in between.
    const { org, key, templateId, slug } = await setup()
    const { url } = serve(() => new Response('ok'))
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    await webhookBinding(org, templateId, endpoint, { on: '*' })

    const { body } = await runDecision(key, slug, confidentBug)
    const [execution] = await executionsOf(body.id)
    if (!execution) throw new Error('expected one execution')

    await disableWebhookEndpoint(endpoint.id)

    const result = await processEffects({ now: new Date() })
    expect(result.dead).toBe(1)

    const delivered = await getExecution(execution.id)
    expect(delivered?.status).toBe('dead')
    expect(delivered?.lastError).toContain('disabled')
  })

  test('email: sends only to current verified org members, dropping the rest', async () => {
    const { org, key, templateId, slug } = await setup()
    const member = await addMember(org, 'member')
    await emailBinding(
      org,
      templateId,
      [member.email, 'outsider@example.com'],
      {
        on: '*'
      }
    )

    const { body } = await runDecision(key, slug, confidentBug)
    const executions = await executionsOf(body.id)
    expect(executions).toHaveLength(1)
    expect(executions[0]?.type).toBe('email')

    const result = await processEffects({ now: new Date() })
    expect(result.succeeded).toBe(1)

    const delivered = await getExecution(executions[0]?.id ?? '')
    expect(delivered?.status).toBe('succeeded')
    // `addMember` itself sends a sign-up verification email to `member.email`
    // (better-auth) — filter to the effect's own message, not that one.
    const effectEmails = emailsTo(member.email).filter(message =>
      message.subject.startsWith('Liro:')
    )
    expect(effectEmails).toHaveLength(1)
    expect(emailsTo('outsider@example.com')).toHaveLength(0)
  })

  test('email: fails permanently when no address is a current verified member', async () => {
    const { org, key, templateId, slug } = await setup()
    await emailBinding(org, templateId, ['nobody@example.com'], { on: '*' })

    const { body } = await runDecision(key, slug, confidentBug)
    const [execution] = await executionsOf(body.id)
    if (!execution) throw new Error('expected one execution')

    const result = await processEffects({ now: new Date() })
    expect(result.dead).toBe(1)

    const delivered = await getExecution(execution.id)
    expect(delivered?.status).toBe('dead')
    expect(delivered?.lastError).toContain('nobody@example.com')
  })

  test('slack: a stored URL without the hooks.slack.com prefix fails permanently, no network call made', async () => {
    const { org, key, templateId, slug } = await setup()
    await slackBinding(org, templateId, 'https://example.com/not-slack', {
      on: '*'
    })

    const { body } = await runDecision(key, slug, confidentBug)
    const [execution] = await executionsOf(body.id)
    if (!execution) throw new Error('expected one execution')

    const result = await processEffects({ now: new Date() })
    expect(result.dead).toBe(1)

    const delivered = await getExecution(execution.id)
    expect(delivered?.status).toBe('dead')
    expect(delivered?.lastError).toContain('hooks.slack.com')
  })

  describe('slack: delivery (fetch mocked — assertSlackWebhookUrl requires a real hooks.slack.com URL, so the outbound leg is stubbed instead of hitting Slack)', () => {
    let fetchSpy: ReturnType<typeof spyOn<typeof globalThis, 'fetch'>> | null =
      null
    afterEach(() => {
      fetchSpy?.mockRestore()
      fetchSpy = null
    })

    test('posts a Block Kit message and succeeds on a 2xx response', async () => {
      const { org, key, templateId, slug } = await setup()
      fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('ok', { status: 200 })
      )
      await slackBinding(
        org,
        templateId,
        'https://hooks.slack.com/services/T000/B000/xxxxxxxxxxxxxxxx',
        { on: '*', channel: '#alerts' }
      )

      const { body } = await runDecision(key, slug, confidentBug)
      const [execution] = await executionsOf(body.id)
      if (!execution) throw new Error('expected one execution')

      const result = await processEffects({ now: new Date() })
      expect(result.succeeded).toBe(1)

      const [url, init] = fetchSpy.mock.calls[0] ?? []
      // `safeFetch` (outbound.ts) deliberately dials the already-DNS-checked
      // address rather than the hostname — SSRF/DNS-rebinding protection,
      // see its own doc comment — so the URL `fetch()` actually receives has
      // the resolved IP as its host (which varies run to run); the original
      // hostname travels as the `Host` header (and, over TLS, the SNI/
      // certificate name) instead. Assert on those, not the literal host.
      const requestUrl = new URL(String(url))
      expect(requestUrl.protocol).toBe('https:')
      expect(requestUrl.pathname).toBe('/services/T000/B000/xxxxxxxxxxxxxxxx')
      expect(new Headers(init?.headers).get('host')).toBe('hooks.slack.com')
      const message = JSON.parse(String(init?.body))
      expect(message.channel).toBe('#alerts')
      expect(message.blocks[0].text.text).toContain('bug')

      const delivered = await getExecution(execution.id)
      expect(delivered?.status).toBe('succeeded')
      expect(delivered?.lastResponseStatus).toBe(200)
    })

    test('a non-2xx response from Slack fails, but is retried (not permanent)', async () => {
      const { org, key, templateId, slug } = await setup()
      fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('invalid_payload', { status: 400 })
      )
      await slackBinding(
        org,
        templateId,
        'https://hooks.slack.com/services/T000/B000/yyyyyyyyyyyyyyyy',
        { on: '*' }
      )

      const { body } = await runDecision(key, slug, confidentBug)
      const [execution] = await executionsOf(body.id)
      if (!execution) throw new Error('expected one execution')

      const result = await processEffects({ now: new Date() })
      expect(result.failed).toBe(1)

      const delivered = await getExecution(execution.id)
      expect(delivered?.status).toBe('queued')
      expect(delivered?.lastResponseStatus).toBe(400)
      expect(delivered?.lastError).toContain('400')
    })
  })

  test('slack: an execution whose binding no longer exists fails permanently', async () => {
    const { org, key, templateId, slug } = await setup()
    const { body } = await runDecision(key, slug, confidentBug)

    const orphan = await insertEffectExecution(org, {
      runId: body.id,
      templateId,
      type: 'slack',
      event: 'decision.made',
      target: 'slack',
      bindingId: null,
      payload: testEffectPayload(body.id)
    })

    const result = await processEffects({ now: new Date() })
    expect(result.dead).toBeGreaterThanOrEqual(1)

    const delivered = await getExecution(orphan.id)
    expect(delivered?.status).toBe('dead')
    expect(delivered?.lastError).toContain('no longer exists')
  })
})

// ── Retries / backoff ───────────────────────────────────────────────────

describe('retries', () => {
  test('a failing webhook retries on the backoff schedule and dies after 8 attempts, keeping the same webhook-id', async () => {
    const { org, key, templateId, slug } = await setup()
    const { url, stop } = serve(() => new Response('ok'))
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    await webhookBinding(org, templateId, endpoint, { on: '*' })
    // Closed immediately: every attempt fails to connect (retryable, not permanent).
    stop()

    const { body } = await runDecision(key, slug, confidentBug)
    const [execution] = await executionsOf(body.id)
    if (!execution) throw new Error('expected one execution')
    const executionId = execution.id

    let now = new Date()
    for (let attempt = 1; attempt <= 8; attempt++) {
      setSystemTime(now)
      const result = await processEffects({ now, limit: 10 })
      expect(result.claimed).toBeGreaterThanOrEqual(1)

      const row = await getExecution(executionId)
      if (!row) throw new Error('execution disappeared')
      expect(row.id).toBe(executionId)
      expect(row.attempts).toBe(attempt)

      if (attempt < 8) {
        expect(row.status).toBe('queued')
        now = new Date(row.runAt.getTime() + 1)
      } else {
        expect(row.status).toBe('dead')
        expect(row.completedAt).not.toBeNull()
      }
    }
  })

  test('a webhook endpoint auto-disables after 50 consecutive failures', async () => {
    const { org, key, templateId, slug } = await setup()
    const { url } = serve(() => new Response('ok'))
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    await webhookBinding(org, templateId, endpoint, { on: '*' })

    const { body } = await runDecision(key, slug, confidentBug)
    const [execution] = await executionsOf(body.id)
    if (!execution) throw new Error('expected one execution')

    const now = new Date()
    for (let i = 1; i <= 50; i++) {
      await failExecution(
        { ...execution, attempts: i, maxAttempts: 1_000 },
        { error: 'simulated failure' },
        now
      )
    }

    const disabled = await getWebhookEndpoint(endpoint.id)
    expect(disabled?.enabled).toBe(false)
    expect(disabled?.disabledReason).toBe('too_many_failures')
    expect(disabled?.failureCount).toBe(50)
  })

  test('a retry endpoint is not required for delivery to succeed after a transient failure clears', async () => {
    // Exercises `failExecution` → requeue → a later `processEffects` picking
    // it back up once `runAt` is due, without a dedicated retry endpoint
    // (owned by the routes agent, not implemented here).
    const { org, key, templateId, slug } = await setup()
    let attempts = 0
    const { url } = serve(() => {
      attempts++
      return attempts === 1
        ? new Response('nope', { status: 500 })
        : new Response('ok', { status: 200 })
    })
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    await webhookBinding(org, templateId, endpoint, { on: '*' })

    const { body } = await runDecision(key, slug, confidentBug)
    const [execution] = await executionsOf(body.id)
    if (!execution) throw new Error('expected one execution')

    const now = new Date()
    setSystemTime(now)
    const first = await processEffects({ now, limit: 10 })
    expect(first.failed).toBe(1)

    const afterFirst = await getExecution(execution.id)
    if (!afterFirst) throw new Error('execution disappeared')
    expect(afterFirst.status).toBe('queued')
    expect(afterFirst.lastResponseStatus).toBe(500)

    const later = new Date(afterFirst.runAt.getTime() + 1)
    setSystemTime(later)
    const second = await processEffects({ now: later, limit: 10 })
    expect(second.succeeded).toBe(1)

    const afterSecond = await getExecution(execution.id)
    expect(afterSecond?.status).toBe('succeeded')
  })
})
