import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { eq, inArray } from 'drizzle-orm'
import { startWorker } from '#/worker'
import * as effectsDelivery from '#modules/effects/delivery'
import { processEffects, reapExpiredLeases } from '#modules/effects/delivery'
import { effectExecutions } from '#modules/effects/effects.schemas'
import { getFakeEvaluator } from '#modules/engine/evaluator'
import { log } from '#shared/config/logger'
import { db } from '#shared/db/config'
import { jobs } from '#shared/jobs/jobs.schemas'
import {
  clearJobHandlers,
  processJobs,
  reapExpiredJobLeases,
  registerJobHandler
} from '#shared/jobs/queue'
import { classifySupport } from '../fixtures/definitions'
import { json, testApi } from '../helpers/app'
import {
  insertEffectExecution,
  insertWebhookEndpoint,
  testEffectPayload
} from '../helpers/effects'
import { createApiKey, createOrg, type TestOrg } from '../helpers/factories'
import { insertTemplate } from '../helpers/templates'

/**
 * The worker's building blocks (reaper, fair claiming, graceful shutdown)
 * and its two queues' `process*` entry points, driven directly — no
 * polling, per `processEffects`/`processJobs` being exported for exactly
 * this.
 */

const fake = getFakeEvaluator()
beforeEach(() => fake.reset())

const servers: ReturnType<typeof Bun.serve>[] = []
afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true)
})

function serve(handler: (req: Request) => Response | Promise<Response>): {
  url: string
} {
  const server = Bun.serve({ port: 0, fetch: handler })
  servers.push(server)
  return { url: `http://127.0.0.1:${server.port}` }
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const api = testApi()

/** A real run (so `effect_executions.run_id`'s FK has something to point at); no bindings, so it enqueues nothing on its own. */
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

describe('reap', () => {
  test('reapExpiredLeases resets expired running executions to queued', async () => {
    const org = await createOrg()
    const { runId, templateId } = await realRun(org)
    const execution = await insertEffectExecution(org, {
      runId,
      templateId,
      type: 'webhook',
      event: 'decision.made',
      target: 'test',
      status: 'running',
      attempts: 1,
      runAt: new Date(Date.now() - 60_000),
      payload: testEffectPayload(runId)
    })
    await db
      .update(effectExecutions)
      .set({ lockedUntil: new Date(Date.now() - 1_000) })
      .where(eq(effectExecutions.id, execution.id))

    const reaped = await reapExpiredLeases(new Date())
    expect(reaped).toBeGreaterThanOrEqual(1)

    const [row] = await db
      .select()
      .from(effectExecutions)
      .where(eq(effectExecutions.id, execution.id))
    expect(row?.status).toBe('queued')
    expect(row?.lockedUntil).toBeNull()
  })

  test('reapExpiredJobLeases resets expired running jobs to queued', async () => {
    const [job] = await db
      .insert(jobs)
      .values({
        type: 'test.reap',
        payload: {},
        status: 'running',
        runAt: new Date(),
        attempts: 1,
        lockedUntil: new Date(Date.now() - 1_000)
      })
      .returning()
    if (!job) throw new Error('expected a job row')

    const reaped = await reapExpiredJobLeases(new Date())
    expect(reaped).toBeGreaterThanOrEqual(1)

    const row = await db.query.jobs.findFirst({ where: { id: job.id } })
    expect(row?.status).toBe('queued')
    expect(row?.lockedUntil).toBeNull()
  })
})

describe('fairness', () => {
  test('a busy organization does not starve a quiet one', async () => {
    const orgA = await createOrg()
    const orgB = await createOrg()
    const { url } = serve(() => new Response('ok'))
    const { runId: runIdA, templateId: templateIdA } = await realRun(orgA)
    const { runId: runIdB, templateId: templateIdB } = await realRun(orgB)

    const { endpoint: endpointA } = await insertWebhookEndpoint(orgA, { url })
    const { endpoint: endpointB } = await insertWebhookEndpoint(orgB, { url })

    const due = new Date(Date.now() - 1_000)
    for (let i = 0; i < 50; i++) {
      await insertEffectExecution(orgA, {
        runId: runIdA,
        templateId: templateIdA,
        type: 'webhook',
        event: 'decision.made',
        target: 'test',
        endpointId: endpointA.id,
        runAt: due,
        payload: testEffectPayload(runIdA)
      })
    }
    const executionB = await insertEffectExecution(orgB, {
      runId: runIdB,
      templateId: templateIdB,
      type: 'webhook',
      event: 'decision.made',
      target: 'test',
      endpointId: endpointB.id,
      runAt: due,
      payload: testEffectPayload(runIdB)
    })

    const result = await processEffects({
      now: new Date(),
      limit: 5,
      concurrency: 5
    })
    expect(result.claimed).toBe(5)

    const [rowB] = await db
      .select()
      .from(effectExecutions)
      .where(eq(effectExecutions.id, executionB.id))
    // Org B's only row was claimed in the very first, tiny batch — a plain
    // FIFO claim (org A was queued first, 50 rows deep) would have starved it.
    expect(rowB?.status).not.toBe('queued')

    // Drain the rest so later tests in this file see an empty queue.
    let more = await processEffects({ now: new Date(), limit: 100 })
    while (more.claimed > 0) {
      more = await processEffects({ now: new Date(), limit: 100 })
    }
  })

  test('more organizations than `limit`, each with exactly one due row, are all eventually served — a deterministic tie-break, not incidental physical row order', async () => {
    const orgCount = 25
    const limit = 20
    const { url } = serve(() => new Response('ok'))
    const due = new Date(Date.now() - 1_000)

    // Independent per-org setup (each its own org/run/binding) — run
    // concurrently, since `realRun`'s repeated `POST /v1/decisions/.../run`
    // is the slow part and 25 of them sequentially would be needlessly slow.
    const executionIds = await Promise.all(
      Array.from({ length: orgCount }, async () => {
        const org = await createOrg()
        const { runId, templateId } = await realRun(org)
        const { endpoint } = await insertWebhookEndpoint(org, { url })
        const execution = await insertEffectExecution(org, {
          runId,
          templateId,
          type: 'webhook',
          event: 'decision.made',
          target: 'test',
          endpointId: endpoint.id,
          runAt: due,
          payload: testEffectPayload(runId)
        })
        return execution.id
      })
    )

    // Every organization is tied at rank 1 (one due row each, same
    // run_at): without a deterministic secondary sort key, which subset a
    // tick picks is undefined and could — in principle — never rotate in
    // a consistently tied-out organization. With one, a served row leaves
    // the `queued` pool for good, so every organization is served within
    // a small, bounded number of ticks.
    const maxTicks = Math.ceil(orgCount / limit) + 1
    let ticks = 0
    let result: Awaited<ReturnType<typeof processEffects>>
    do {
      result = await processEffects({
        now: new Date(),
        limit,
        concurrency: limit
      })
      ticks++
    } while (result.claimed > 0 && ticks < maxTicks)

    expect(ticks).toBeLessThanOrEqual(maxTicks)

    const rows = await db
      .select({ id: effectExecutions.id, status: effectExecutions.status })
      .from(effectExecutions)
      .where(inArray(effectExecutions.id, executionIds))
    expect(rows).toHaveLength(orgCount)
    for (const row of rows) expect(row.status).toBe('succeeded')
  }, 20_000)
})

describe('graceful shutdown', () => {
  test('releases claimed-but-unfinished executions and jobs back to queued', async () => {
    const org = await createOrg()
    const { runId, templateId } = await realRun(org)

    const worker = startWorker({ pollMs: 60_000 })
    // Let the first (empty) tick settle before seeding "in-flight" rows.
    await sleep(100)

    const execution = await insertEffectExecution(org, {
      runId,
      templateId,
      type: 'webhook',
      event: 'decision.made',
      target: 'test',
      status: 'running',
      attempts: 1,
      lockedUntil: new Date(Date.now() + 60_000),
      runAt: new Date(),
      payload: testEffectPayload(runId)
    })
    // `insertEffectExecution` has no `lockedBy` option — stamp it directly so
    // this row looks like one *this* worker instance actually claimed (release
    // is now scoped to `locked_by = workerId`, see `releaseRunningExecutions`).
    await db
      .update(effectExecutions)
      .set({ lockedBy: worker.id })
      .where(eq(effectExecutions.id, execution.id))

    const [job] = await db
      .insert(jobs)
      .values({
        type: 'test.shutdown',
        payload: {},
        status: 'running',
        runAt: new Date(),
        attempts: 1,
        lockedUntil: new Date(Date.now() + 60_000),
        lockedBy: worker.id
      })
      .returning()
    if (!job) throw new Error('expected a job row')

    await worker.stop()

    const [rowExecution] = await db
      .select()
      .from(effectExecutions)
      .where(eq(effectExecutions.id, execution.id))
    expect(rowExecution?.status).toBe('queued')
    expect(rowExecution?.lockedUntil).toBeNull()

    const rowJob = await db.query.jobs.findFirst({ where: { id: job.id } })
    expect(rowJob?.status).toBe('queued')
    expect(rowJob?.lockedUntil).toBeNull()
  })

  test("one worker instance's shutdown never releases a sibling instance's in-flight execution or job", async () => {
    // Two instances can be alive at once in practice — a rolling deploy of
    // the standalone `worker` service (old/new containers briefly
    // overlapping), the service scaled to 2+ replicas, or `RUN_WORKER=true`
    // on the api alongside the standalone service (docker-compose.dev.yml's
    // own comment anticipates exactly that combination).
    const org = await createOrg()
    const { runId, templateId } = await realRun(org)

    const workerA = startWorker({ pollMs: 60_000 })
    const workerB = startWorker({ pollMs: 60_000 })
    try {
      expect(workerA.id).not.toBe(workerB.id)
      // Let their first (empty) ticks settle before seeding "in-flight" rows.
      await sleep(100)

      const executionA = await insertEffectExecution(org, {
        runId,
        templateId,
        type: 'webhook',
        event: 'decision.made',
        target: 'test',
        status: 'running',
        attempts: 1,
        lockedUntil: new Date(Date.now() + 60_000),
        runAt: new Date(),
        payload: testEffectPayload(runId)
      })
      await db
        .update(effectExecutions)
        .set({ lockedBy: workerA.id })
        .where(eq(effectExecutions.id, executionA.id))

      const executionB = await insertEffectExecution(org, {
        runId,
        templateId,
        type: 'webhook',
        event: 'decision.made',
        target: 'test',
        status: 'running',
        attempts: 1,
        lockedUntil: new Date(Date.now() + 60_000),
        runAt: new Date(),
        payload: testEffectPayload(runId)
      })
      await db
        .update(effectExecutions)
        .set({ lockedBy: workerB.id })
        .where(eq(effectExecutions.id, executionB.id))

      const [jobA] = await db
        .insert(jobs)
        .values({
          type: 'test.shutdown-a',
          payload: {},
          status: 'running',
          runAt: new Date(),
          attempts: 1,
          lockedUntil: new Date(Date.now() + 60_000),
          lockedBy: workerA.id
        })
        .returning()
      const [jobB] = await db
        .insert(jobs)
        .values({
          type: 'test.shutdown-b',
          payload: {},
          status: 'running',
          runAt: new Date(),
          attempts: 1,
          lockedUntil: new Date(Date.now() + 60_000),
          lockedBy: workerB.id
        })
        .returning()
      if (!jobA || !jobB) throw new Error('expected both job rows')

      await workerA.stop()

      const rowExecutionA = await db.query.effectExecutions.findFirst({
        where: { id: executionA.id }
      })
      expect(rowExecutionA?.status).toBe('queued')
      expect(rowExecutionA?.lockedBy).toBeNull()

      // Worker B's row is untouched by A's shutdown — the bug this test
      // pins would have reset every `running` row table-wide, regardless of
      // which worker claimed it.
      const rowExecutionB = await db.query.effectExecutions.findFirst({
        where: { id: executionB.id }
      })
      expect(rowExecutionB?.status).toBe('running')
      expect(rowExecutionB?.lockedBy).toBe(workerB.id)

      const rowJobA = await db.query.jobs.findFirst({
        where: { id: jobA.id }
      })
      expect(rowJobA?.status).toBe('queued')
      expect(rowJobA?.lockedBy).toBeNull()

      const rowJobB = await db.query.jobs.findFirst({
        where: { id: jobB.id }
      })
      expect(rowJobB?.status).toBe('running')
      expect(rowJobB?.lockedBy).toBe(workerB.id)
    } finally {
      await workerB.stop()
    }
  })
})

describe('tick', () => {
  test('the poll loop claims and delivers a due effect on its own, without processEffects being called directly', async () => {
    const org = await createOrg()
    const { runId, templateId } = await realRun(org)
    let received = false
    const { url } = serve(() => {
      received = true
      return new Response('ok')
    })
    const { endpoint } = await insertWebhookEndpoint(org, { url })
    const execution = await insertEffectExecution(org, {
      runId,
      templateId,
      type: 'webhook',
      event: 'decision.made',
      target: 'test',
      endpointId: endpoint.id,
      runAt: new Date(),
      payload: testEffectPayload(runId)
    })

    const worker = startWorker({ pollMs: 50 })
    try {
      const deadline = Date.now() + 5_000
      let status = 'queued'
      while (Date.now() < deadline && status !== 'succeeded') {
        await sleep(50)
        const row = await db.query.effectExecutions.findFirst({
          where: { id: execution.id }
        })
        status = row?.status ?? status
      }
      expect(status).toBe('succeeded')
      expect(received).toBe(true)
    } finally {
      await worker.stop()
    }
  })

  test("a stage throwing (e.g. a DB blip) is logged and doesn't stop the tick loop or crash the worker", async () => {
    const errorSpy = spyOn(log.logger, 'error')
    const reapSpy = spyOn(
      effectsDelivery,
      'reapExpiredLeases'
    ).mockRejectedValueOnce(new Error('simulated reaper failure'))

    const worker = startWorker({ pollMs: 30 })
    try {
      const deadline = Date.now() + 2_000
      while (Date.now() < deadline && reapSpy.mock.calls.length === 0) {
        await sleep(20)
      }
      expect(reapSpy).toHaveBeenCalled()

      // The next tick (reapSpy no longer rejecting, `mockRejectedValueOnce`)
      // still runs — one stage throwing didn't wedge the loop.
      const callsBefore = reapSpy.mock.calls.length
      const recoveredDeadline = Date.now() + 2_000
      while (
        Date.now() < recoveredDeadline &&
        reapSpy.mock.calls.length <= callsBefore
      ) {
        await sleep(20)
      }
      expect(reapSpy.mock.calls.length).toBeGreaterThan(callsBefore)

      const reaperError = errorSpy.mock.calls.find(call =>
        String(call[0]).includes('reaper')
      )
      expect(reaperError).toBeDefined()
    } finally {
      await worker.stop()
      reapSpy.mockRestore()
      errorSpy.mockRestore()
    }
  })
})

describe('CLI entry point', () => {
  /** Reads `proc.stdout` until `needle` shows up (or the process's stdout closes, or `timeoutMs` elapses). */
  async function waitForOutput(
    proc: ReturnType<typeof Bun.spawn>,
    needle: string,
    timeoutMs: number
  ): Promise<string> {
    const decoder = new TextDecoder()
    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader()
    let buffer = ''
    const timeout = new Promise<never>((_resolve, reject) => {
      setTimeout(
        () => reject(new Error(`timed out waiting for "${needle}"`)),
        timeoutMs
      )
    })
    const read = (async () => {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) {
          throw new Error(
            `worker process closed stdout before logging "${needle}"`
          )
        }
        buffer += decoder.decode(value)
        if (buffer.includes(needle)) return buffer
      }
    })()
    try {
      return await Promise.race([read, timeout])
    } finally {
      reader.releaseLock()
    }
  }

  test('running `bun src/worker.ts` starts the worker and SIGTERM shuts it down gracefully', async () => {
    // Real subprocess (not an in-process `startWorker()` call) so the
    // `if (import.meta.main)` block itself — the CLI entry, its startup
    // log and its signal handlers — actually runs.
    const proc = Bun.spawn({
      cmd: ['bun', 'src/worker.ts'],
      cwd: process.cwd(),
      // The logger is silent by default at ENVIRONMENT=test (see
      // shared/config/logger.ts); LOG_LEVEL=info overrides that so the
      // startup log below is actually emitted.
      env: { ...process.env, LOG_LEVEL: 'info' },
      stdout: 'pipe',
      stderr: 'pipe'
    })

    try {
      await waitForOutput(proc, '[worker] started', 10_000)

      proc.kill('SIGTERM')
      const exitCode = await Promise.race([
        proc.exited,
        sleep(12_000).then(() => {
          throw new Error('worker did not exit within 12s of SIGTERM')
        })
      ])
      expect(exitCode).toBe(0)
    } finally {
      if (proc.exitCode === null) proc.kill('SIGKILL')
    }
  }, 20_000)
})

describe('processJobs', () => {
  afterEach(() => clearJobHandlers())

  test('runs the registered handler and marks the job succeeded', async () => {
    const seen: string[] = []
    registerJobHandler('test.succeed', async job => {
      seen.push(job.id)
    })
    const [job] = await db
      .insert(jobs)
      .values({ type: 'test.succeed', payload: { x: 1 }, runAt: new Date() })
      .returning()
    if (!job) throw new Error('expected a job row')

    const result = await processJobs({ now: new Date(), limit: 10 })
    expect(result.succeeded).toBeGreaterThanOrEqual(1)
    expect(seen).toContain(job.id)

    const row = await db.query.jobs.findFirst({ where: { id: job.id } })
    expect(row?.status).toBe('succeeded')
  })

  test('a throwing handler requeues with backoff, then fails permanently after maxAttempts', async () => {
    registerJobHandler('test.fail', async () => {
      throw new Error('boom')
    })
    const [job] = await db
      .insert(jobs)
      .values({
        type: 'test.fail',
        payload: {},
        runAt: new Date(),
        maxAttempts: 1
      })
      .returning()
    if (!job) throw new Error('expected a job row')

    const result = await processJobs({ now: new Date(), limit: 10 })
    expect(result.dead).toBeGreaterThanOrEqual(1)

    const row = await db.query.jobs.findFirst({ where: { id: job.id } })
    expect(row?.status).toBe('failed')
    expect(row?.lastError).toContain('boom')
  })
})
