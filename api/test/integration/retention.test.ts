import {
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  test
} from 'bun:test'
import { eq } from 'drizzle-orm'
import { startWorker } from '#/worker'
import { effectExecutions } from '#modules/effects/effects.schemas'
import {
  EFFECT_EXECUTION_RETENTION_DAYS,
  JOB_RETENTION_DAYS,
  PLAYGROUND_RUN_RETENTION_DAYS,
  RETENTION_JOB_TYPE,
  registerRetentionJobs,
  retentionPurgeHandler,
  runRetentionPurge
} from '#modules/retention/retention'
import { decisionRuns, idempotencyKeys } from '#modules/runs/runs.schemas'
import { decisionTemplates } from '#modules/templates/templates.schemas'
import { Id } from '#shared/core/base'
import { db } from '#shared/db/config'
import { jobs } from '#shared/jobs/jobs.schemas'
import {
  clearJobHandlers,
  type JobRow,
  processJobs,
  registerJobHandler
} from '#shared/jobs/queue'
import {
  clearPeriodicJobs,
  periodicJobDefinitions,
  registerPeriodicJob,
  runDuePeriodicJobs
} from '#shared/jobs/scheduler'
import { classifySupport } from '../fixtures/definitions'
import {
  insertEffectExecution,
  insertWebhookEndpoint,
  testEffectPayload
} from '../helpers/effects'
import { createOrg, type TestOrg } from '../helpers/factories'
import { insertRun } from '../helpers/runs'
import { insertTemplate } from '../helpers/templates'

/**
 * `runRetentionPurge` (the whole daily purge), `retentionPurgeHandler` (its
 * `jobs`-queue wiring) and `shared/jobs/scheduler.ts`'s generic periodic-job
 * API, which `retention.purge` is the first consumer of.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

// Every test starts from a known-clean periodic-job registry: exactly
// `retention.purge`'s own definition, nothing else and no duplicates.
// `registerPeriodicJob` just appends (see `scheduler.ts`) — calling
// `registerRetentionJobs()` alone, every test, would otherwise accumulate
// one more duplicate `retention` entry per test for the rest of the file
// (`clearPeriodicJobs` in the "scheduler" describe below only resets
// *within* its own tests). `clearJobHandlers`/`clearPeriodicJobs` used
// anywhere in this file, or in another test file sharing this process,
// is covered too — this restores `retention.purge` before every test either
// way. Every test that also moves the clock restores it in `afterEach`.
beforeEach(() => {
  clearPeriodicJobs()
  registerRetentionJobs()
})
afterEach(() => setSystemTime())

async function daysAgo(now: Date, days: number): Promise<Date> {
  return new Date(now.getTime() - days * DAY_MS)
}

/** A template with `retentionDays` set directly (`insertTemplate` has no such option). */
async function templateWithRetention(
  org: TestOrg,
  retentionDays: number | null
) {
  const inserted = await insertTemplate(org, { definition: classifySupport })
  await db
    .update(decisionTemplates)
    .set({ retentionDays })
    .where(eq(decisionTemplates.id, inserted.template.id))
  return inserted
}

describe('runRetentionPurge — input purge (per-template retentionDays)', () => {
  test('nulls out input on runs older than the cutoff, keeps policyInput, and leaves recent runs untouched', async () => {
    const org = await createOrg()
    const inserted = await templateWithRetention(org, 30)
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const old = await insertRun(org, {
      templateId: inserted.template.id,
      versionId,
      createdAt: await daysAgo(now, 40)
    })
    const recent = await insertRun(org, {
      templateId: inserted.template.id,
      versionId,
      createdAt: await daysAgo(now, 10)
    })
    const policyInput = { ticket: { message: 'kept' } }
    for (const run of [old, recent]) {
      await db
        .update(decisionRuns)
        .set({ input: { ticket: { message: 'secret' } }, policyInput })
        .where(eq(decisionRuns.id, run.id))
    }

    const result = await runRetentionPurge(now)
    expect(result.inputNulled).toBe(1)

    const oldRow = await db.query.decisionRuns.findFirst({
      where: { id: old.id }
    })
    expect(oldRow?.input).toBeNull()
    expect(oldRow?.policyInput).toEqual(policyInput)

    const recentRow = await db.query.decisionRuns.findFirst({
      where: { id: recent.id }
    })
    expect(recentRow?.input).toEqual({ ticket: { message: 'secret' } })
  })

  test('retentionDays: null means keep forever — even a very old run keeps its input', async () => {
    const org = await createOrg()
    const inserted = await templateWithRetention(org, null)
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const ancient = await insertRun(org, {
      templateId: inserted.template.id,
      versionId,
      createdAt: await daysAgo(now, 3650)
    })
    await db
      .update(decisionRuns)
      .set({ input: { ticket: { message: 'forever' } } })
      .where(eq(decisionRuns.id, ancient.id))

    const result = await runRetentionPurge(now)
    expect(result.inputNulled).toBe(0)

    const row = await db.query.decisionRuns.findFirst({
      where: { id: ancient.id }
    })
    expect(row?.input).toEqual({ ticket: { message: 'forever' } })
  })

  test('a run with no input stored is not counted again', async () => {
    const org = await createOrg()
    const inserted = await templateWithRetention(org, 1)
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    // `insertRun` already stores `input: null` — nothing to null out.
    await insertRun(org, {
      templateId: inserted.template.id,
      versionId,
      createdAt: await daysAgo(now, 10)
    })

    const result = await runRetentionPurge(now)
    expect(result.inputNulled).toBe(0)
  })
})

describe('runRetentionPurge — playground runs', () => {
  test('deletes playground runs older than 7 days; keeps recent playground runs and old non-playground runs', async () => {
    const org = await createOrg()
    const inserted = await templateWithRetention(org, null)
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()

    const oldPlayground = await insertRun(org, {
      templateId: inserted.template.id,
      versionId,
      source: 'playground',
      createdAt: await daysAgo(now, PLAYGROUND_RUN_RETENTION_DAYS + 1)
    })
    const recentPlayground = await insertRun(org, {
      templateId: inserted.template.id,
      versionId,
      source: 'playground',
      createdAt: await daysAgo(now, PLAYGROUND_RUN_RETENTION_DAYS - 1)
    })
    const oldApiRun = await insertRun(org, {
      templateId: inserted.template.id,
      versionId,
      source: 'api',
      createdAt: await daysAgo(now, PLAYGROUND_RUN_RETENTION_DAYS + 1)
    })

    const result = await runRetentionPurge(now)
    expect(result.playgroundRunsDeleted).toBe(1)

    expect(
      await db.query.decisionRuns.findFirst({ where: { id: oldPlayground.id } })
    ).toBeUndefined()
    expect(
      await db.query.decisionRuns.findFirst({
        where: { id: recentPlayground.id }
      })
    ).toBeDefined()
    expect(
      await db.query.decisionRuns.findFirst({ where: { id: oldApiRun.id } })
    ).toBeDefined()
  })

  test('exactly at the cutoff is kept (strictly older, not older-or-equal)', async () => {
    const org = await createOrg()
    const inserted = await templateWithRetention(org, null)
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()
    const cutoff = await daysAgo(now, PLAYGROUND_RUN_RETENTION_DAYS)

    const atCutoff = await insertRun(org, {
      templateId: inserted.template.id,
      versionId,
      source: 'playground',
      createdAt: cutoff
    })

    await runRetentionPurge(now)

    expect(
      await db.query.decisionRuns.findFirst({ where: { id: atCutoff.id } })
    ).toBeDefined()

    // This row is *deliberately* left just past the cutoff (kept, not
    // purged) — clean it up explicitly rather than leaving it in the shared
    // table: a later test's purge (unscoped by organization, like the real
    // job) would otherwise catch it once real wall-clock time nudges it
    // past that later test's own, slightly-later `now - retentionDays` cutoff.
    await db.delete(decisionRuns).where(eq(decisionRuns.id, atCutoff.id))
  })

  test('batches across more than one statement (BATCH_SIZE + a few rows all get deleted)', async () => {
    const org = await createOrg()
    const inserted = await templateWithRetention(org, null)
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const now = new Date()
    const createdAt = await daysAgo(now, PLAYGROUND_RUN_RETENTION_DAYS + 1)
    const definitionHash = 'test-definition-hash'

    const BATCH_SIZE = 1_000
    const count = BATCH_SIZE + 7
    await db.insert(decisionRuns).values(
      Array.from({ length: count }, () => ({
        id: Id.generate(),
        organizationId: org.id,
        templateId: inserted.template.id,
        versionId,
        definitionHash,
        engineVersion: '1',
        mode: 'test' as const,
        source: 'playground' as const,
        status: 'succeeded' as const,
        input: null,
        policyInput: {},
        createdAt,
        completedAt: createdAt
      }))
    )

    const result = await runRetentionPurge(now)
    // `>=`, not `===`: the purge isn't scoped to this org (real periodic
    // job, matching production), so any other old playground run elsewhere
    // in this shared test database adds to the total. The org-scoped check
    // below is the actual proof that every one of *this* test's `count`
    // rows was deleted, which only happens if the batching loop iterates
    // past its first `BATCH_SIZE`-row statement.
    expect(result.playgroundRunsDeleted).toBeGreaterThanOrEqual(count)

    const remaining = await db.query.decisionRuns.findMany({
      where: { organizationId: org.id }
    })
    expect(remaining).toHaveLength(0)
  }, 20_000)
})

describe('runRetentionPurge — idempotency keys', () => {
  test('deletes expired idempotency keys via purgeExpiredIdempotencyKeys, keeps live ones', async () => {
    const org = await createOrg()
    const now = new Date()

    await db.insert(idempotencyKeys).values({
      organizationId: org.id,
      key: 'expired',
      requestHash: 'h1',
      status: 'completed',
      expiresAt: await daysAgo(now, 1)
    })
    await db.insert(idempotencyKeys).values({
      organizationId: org.id,
      key: 'live',
      requestHash: 'h2',
      status: 'in_progress',
      expiresAt: new Date(now.getTime() + DAY_MS)
    })

    const result = await runRetentionPurge(now)
    expect(result.idempotencyKeysDeleted).toBeGreaterThanOrEqual(1)

    const expiredRow = await db.query.idempotencyKeys.findFirst({
      where: { organizationId: org.id, key: 'expired' }
    })
    expect(expiredRow).toBeUndefined()
    const liveRow = await db.query.idempotencyKeys.findFirst({
      where: { organizationId: org.id, key: 'live' }
    })
    expect(liveRow).toBeDefined()
  })
})

describe('runRetentionPurge — effect executions', () => {
  async function realRun(org: TestOrg) {
    const inserted = await insertTemplate(org, { definition: classifySupport })
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const run = await insertRun(org, {
      templateId: inserted.template.id,
      versionId,
      createdAt: new Date()
    })
    return { runId: run.id, templateId: inserted.template.id }
  }

  test('deletes succeeded/dead executions older than 30 days; keeps recent ones and queued/running/canceled ones', async () => {
    const org = await createOrg()
    const { runId, templateId } = await realRun(org)
    const { endpoint } = await insertWebhookEndpoint(org, {
      url: 'http://127.0.0.1:1'
    })
    const now = new Date()
    const oldCompletedAt = await daysAgo(
      now,
      EFFECT_EXECUTION_RETENTION_DAYS + 1
    )
    const recentCompletedAt = await daysAgo(
      now,
      EFFECT_EXECUTION_RETENTION_DAYS - 1
    )

    async function insertWithCompletedAt(
      status: 'succeeded' | 'dead' | 'queued' | 'running' | 'canceled',
      completedAt: Date | null
    ) {
      const execution = await insertEffectExecution(org, {
        runId,
        templateId,
        type: 'webhook',
        event: 'decision.made',
        target: 'test',
        endpointId: endpoint.id,
        status,
        payload: testEffectPayload(runId)
      })
      if (completedAt) {
        await db
          .update(effectExecutions)
          .set({ completedAt })
          .where(eq(effectExecutions.id, execution.id))
      }
      return execution
    }

    const oldSucceeded = await insertWithCompletedAt(
      'succeeded',
      oldCompletedAt
    )
    const oldDead = await insertWithCompletedAt('dead', oldCompletedAt)
    const recentSucceeded = await insertWithCompletedAt(
      'succeeded',
      recentCompletedAt
    )
    const stillQueued = await insertWithCompletedAt('queued', null)
    const stillRunning = await insertWithCompletedAt('running', null)
    const canceled = await insertWithCompletedAt('canceled', oldCompletedAt)

    const result = await runRetentionPurge(now)
    expect(result.effectExecutionsDeleted).toBe(2)

    const remainingIds = (
      await db.query.effectExecutions.findMany({
        where: { runId }
      })
    ).map(row => row.id)
    expect(remainingIds).not.toContain(oldSucceeded.id)
    expect(remainingIds).not.toContain(oldDead.id)
    expect(remainingIds).toContain(recentSucceeded.id)
    expect(remainingIds).toContain(stillQueued.id)
    expect(remainingIds).toContain(stillRunning.id)
    // `canceled` is neither `succeeded` nor `dead` — outside this job's scope.
    expect(remainingIds).toContain(canceled.id)
  })
})

describe('runRetentionPurge — jobs', () => {
  test('deletes succeeded jobs older than 7 days; keeps recent, failed and queued jobs', async () => {
    const now = new Date()
    const oldCompletedAt = await daysAgo(now, JOB_RETENTION_DAYS + 1)
    const recentCompletedAt = await daysAgo(now, JOB_RETENTION_DAYS - 1)

    const [oldSucceeded] = await db
      .insert(jobs)
      .values({
        type: 'test.retention.old-succeeded',
        payload: {},
        status: 'succeeded',
        runAt: oldCompletedAt,
        completedAt: oldCompletedAt
      })
      .returning()
    const [recentSucceeded] = await db
      .insert(jobs)
      .values({
        type: 'test.retention.recent-succeeded',
        payload: {},
        status: 'succeeded',
        runAt: recentCompletedAt,
        completedAt: recentCompletedAt
      })
      .returning()
    const [oldFailed] = await db
      .insert(jobs)
      .values({
        type: 'test.retention.old-failed',
        payload: {},
        status: 'failed',
        runAt: oldCompletedAt,
        completedAt: oldCompletedAt
      })
      .returning()
    const [oldQueued] = await db
      .insert(jobs)
      .values({
        type: 'test.retention.old-queued',
        payload: {},
        status: 'queued',
        runAt: oldCompletedAt
      })
      .returning()
    if (!oldSucceeded || !recentSucceeded || !oldFailed || !oldQueued) {
      throw new Error('expected all job rows to be inserted')
    }

    const result = await runRetentionPurge(now)
    expect(result.jobsDeleted).toBeGreaterThanOrEqual(1)

    const remainingIds = (
      await db.query.jobs.findMany({
        where: {
          type: {
            in: [
              'test.retention.old-succeeded',
              'test.retention.recent-succeeded',
              'test.retention.old-failed',
              'test.retention.old-queued'
            ]
          }
        }
      })
    ).map(row => row.id)
    expect(remainingIds).not.toContain(oldSucceeded.id)
    expect(remainingIds).toContain(recentSucceeded.id)
    expect(remainingIds).toContain(oldFailed.id)
    expect(remainingIds).toContain(oldQueued.id)
  })
})

describe('retentionPurgeHandler', () => {
  test('runs the whole purge using the JS clock (new Date()), so setSystemTime moves it', async () => {
    const org = await createOrg()
    const inserted = await templateWithRetention(org, null)
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')

    const future = new Date(Date.now() + 100 * DAY_MS)
    setSystemTime(future)

    const oldPlayground = await insertRun(org, {
      templateId: inserted.template.id,
      versionId,
      source: 'playground',
      createdAt: await daysAgo(future, PLAYGROUND_RUN_RETENTION_DAYS + 1)
    })

    const [jobRow] = await db
      .insert(jobs)
      .values({ type: RETENTION_JOB_TYPE, payload: {}, runAt: future })
      .returning()
    if (!jobRow) throw new Error('expected a job row')

    await retentionPurgeHandler(jobRow as JobRow)

    expect(
      await db.query.decisionRuns.findFirst({ where: { id: oldPlayground.id } })
    ).toBeUndefined()
  })
})

describe('processJobs — retention.purge end to end', () => {
  test('a queued retention.purge job is claimed and completed by the registered handler', async () => {
    registerJobHandler(RETENTION_JOB_TYPE, retentionPurgeHandler)

    const [jobRow] = await db
      .insert(jobs)
      .values({ type: RETENTION_JOB_TYPE, payload: {}, runAt: new Date() })
      .returning()
    if (!jobRow) throw new Error('expected a job row')

    const result = await processJobs({ now: new Date(), limit: 10 })
    expect(result.succeeded).toBeGreaterThanOrEqual(1)

    const row = await db.query.jobs.findFirst({ where: { id: jobRow.id } })
    expect(row?.status).toBe('succeeded')
  })
})

describe('scheduler — generic registerPeriodicJob / runDuePeriodicJobs API', () => {
  afterEach(() => {
    clearPeriodicJobs()
    registerRetentionJobs()
  })

  test('enqueues a freshly registered definition on its first check (never run before)', async () => {
    clearPeriodicJobs()
    // `type` doubles as `dedupeKeyPrefix`: unique per test run (unlike a
    // fixed literal), so a leftover `queued` row from an earlier run of
    // this very test — within the same `intervalMs` window, e.g. re-running
    // `bun test` twice within a minute — can never collide with this one's
    // `dedupeKey` and silently swallow its insert (see the "two DIFFERENT
    // definitions that share a dedupeKeyPrefix" test below for exactly that
    // failure mode, provoked on purpose).
    const type = `test.periodic.${Id.generate()}`
    registerPeriodicJob({
      dedupeKeyPrefix: type,
      intervalMs: 60_000,
      type,
      payloadFor: () => ({ marker: true })
    })

    const now = new Date()
    const enqueued = await runDuePeriodicJobs(now)
    expect(enqueued).toBe(1)

    const rows = await db.query.jobs.findMany({ where: { type } })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.payload).toEqual({ marker: true })
    expect(rows[0]?.dedupeKey).toStartWith(`${type}:`)
    expect(rows[0]?.organizationId).toBeNull()
  })

  test('does not enqueue again before intervalMs has elapsed', async () => {
    clearPeriodicJobs()
    const type = `test.periodic.${Id.generate()}`
    registerPeriodicJob({
      dedupeKeyPrefix: type,
      intervalMs: 3_600_000,
      type,
      payloadFor: () => ({})
    })

    const now = new Date()
    expect(await runDuePeriodicJobs(now)).toBe(1)
    expect(await runDuePeriodicJobs(new Date(now.getTime() + 1_000))).toBe(0)

    const rows = await db.query.jobs.findMany({ where: { type } })
    expect(rows).toHaveLength(1)
  })

  test('enqueues again once intervalMs has elapsed since the last one', async () => {
    clearPeriodicJobs()
    const type = `test.periodic.${Id.generate()}`
    const intervalMs = 60_000
    registerPeriodicJob({
      dedupeKeyPrefix: type,
      intervalMs,
      type,
      payloadFor: () => ({})
    })

    const now = new Date()
    expect(await runDuePeriodicJobs(now)).toBe(1)
    const later = new Date(now.getTime() + intervalMs + 1)
    expect(await runDuePeriodicJobs(later)).toBe(1)

    const rows = await db.query.jobs.findMany({ where: { type } })
    expect(rows).toHaveLength(2)
  })

  test('a still-pending job (still queued, never processed) does not get a duplicate before intervalMs elapses', async () => {
    clearPeriodicJobs()
    const type = `test.periodic.${Id.generate()}`
    registerPeriodicJob({
      dedupeKeyPrefix: type,
      intervalMs: 3_600_000,
      type,
      payloadFor: () => ({})
    })
    const now = new Date()
    expect(await runDuePeriodicJobs(now)).toBe(1)
    // Unlike `retention.purge` in other tests, this job is never processed —
    // it just sits `queued`. Due-ness is based on when it was created, not
    // its status, so a slow/backlogged queue never causes a pile-up either.
    expect(await runDuePeriodicJobs(new Date(now.getTime() + 30_000))).toBe(0)
  })

  test('two callers racing the same due window only enqueue one job (dedupeKey de-dupes the insert)', async () => {
    clearPeriodicJobs()
    const type = `test.periodic.${Id.generate()}`
    registerPeriodicJob({
      dedupeKeyPrefix: type,
      intervalMs: 3_600_000,
      type,
      payloadFor: () => ({})
    })

    const now = new Date()
    const [a, b] = await Promise.all([
      runDuePeriodicJobs(now),
      runDuePeriodicJobs(now)
    ])
    expect(a + b).toBe(1)

    const rows = await db.query.jobs.findMany({ where: { type } })
    expect(rows).toHaveLength(1)
  })

  test('two DIFFERENT definitions that share a dedupeKeyPrefix collide within the same window — only one is enqueued (document the contract: pick a prefix unique per definition, e.g. derived from `type`)', async () => {
    clearPeriodicJobs()
    const sharedPrefix = `shared-${Id.generate()}`
    const typeA = `test.periodic.collide-a.${Id.generate()}`
    const typeB = `test.periodic.collide-b.${Id.generate()}`
    // Same prefix AND same intervalMs → both compute the exact same
    // `dedupeKey` for `now`'s window, regardless of their different `type`.
    registerPeriodicJob({
      dedupeKeyPrefix: sharedPrefix,
      intervalMs: 3_600_000,
      type: typeA,
      payloadFor: () => ({})
    })
    registerPeriodicJob({
      dedupeKeyPrefix: sharedPrefix,
      intervalMs: 3_600_000,
      type: typeB,
      payloadFor: () => ({})
    })

    const enqueued = await runDuePeriodicJobs(new Date())
    expect(enqueued).toBe(1)

    const rowsA = await db.query.jobs.findMany({ where: { type: typeA } })
    const rowsB = await db.query.jobs.findMany({ where: { type: typeB } })
    // Whichever of the two definitions is iterated first wins the insert;
    // the other's `onConflictDoNothing` silently loses the race — exactly
    // why `dedupeKeyPrefix` must be chosen unique per definition.
    expect(rowsA.length + rowsB.length).toBe(1)
  })

  test('multiple registered definitions (each with its own dedupeKeyPrefix) are checked and enqueued independently', async () => {
    clearPeriodicJobs()
    const typeA = `test.periodic.a.${Id.generate()}`
    const typeB = `test.periodic.b.${Id.generate()}`
    registerPeriodicJob({
      dedupeKeyPrefix: typeA,
      intervalMs: 60_000,
      type: typeA,
      payloadFor: () => ({ which: 'a' })
    })
    registerPeriodicJob({
      dedupeKeyPrefix: typeB,
      intervalMs: 60_000,
      type: typeB,
      payloadFor: () => ({ which: 'b' })
    })

    const enqueued = await runDuePeriodicJobs(new Date())
    expect(enqueued).toBe(2)

    expect(
      await db.query.jobs.findFirst({ where: { type: typeA } })
    ).toMatchObject({ payload: { which: 'a' } })
    expect(
      await db.query.jobs.findFirst({ where: { type: typeB } })
    ).toMatchObject({ payload: { which: 'b' } })
  })

  test('clearPeriodicJobs empties the registry; registerPeriodicJob adds to it', () => {
    clearPeriodicJobs()
    expect(periodicJobDefinitions()).toHaveLength(0)
    registerPeriodicJob({
      dedupeKeyPrefix: 'x',
      intervalMs: 1_000,
      type: 'test.periodic.x',
      payloadFor: () => ({})
    })
    expect(periodicJobDefinitions()).toHaveLength(1)
  })
})

describe('wired into the real worker', () => {
  test('`retention.purge` is registered on the real (non-test) handler/periodic-job registries as soon as `#/worker` is imported', () => {
    // `beforeEach` above already re-registers it defensively, so this checks
    // the module-load side effect itself: `worker.ts`'s side-effect import of
    // `#modules/retention/retention` (this file's own `import { startWorker }
    // from '#/worker'` triggered it, same as it will for the real process).
    const definitions = periodicJobDefinitions()
    expect(definitions.some(d => d.type === RETENTION_JOB_TYPE)).toBe(true)
  })

  test('a real worker tick enqueues and runs the due retention.purge job on its own, before the next effects/jobs claim', async () => {
    // A clean slate for this type only — otherwise an earlier test's
    // freshly-created row (this run, well under the 1-day interval) would
    // make it "not due" and this test would see nothing happen.
    await db.delete(jobs).where(eq(jobs.type, RETENTION_JOB_TYPE))

    const org = await createOrg()
    const inserted = await templateWithRetention(org, null)
    const versionId = inserted.versions[0]?.id
    if (!versionId) throw new Error('expected a published version')
    const run = await insertRun(org, {
      templateId: inserted.template.id,
      versionId,
      source: 'playground',
      createdAt: await daysAgo(new Date(), PLAYGROUND_RUN_RETENTION_DAYS + 1)
    })

    const worker = startWorker({ pollMs: 50 })
    try {
      // Generous under a full `bun test` run (dozens of files' worth of DB
      // load/CPU contention, vs. this file alone) — see worker.test.ts's own
      // multi-tick tests, which allow a similarly wide margin for the same
      // reason.
      const deadline = Date.now() + 25_000
      let gone = false
      while (Date.now() < deadline && !gone) {
        await sleep(50)
        const row = await db.query.decisionRuns.findFirst({
          where: { id: run.id }
        })
        gone = row === undefined
      }
      expect(gone).toBe(true)
    } finally {
      await worker.stop()
    }

    const jobRows = await db.query.jobs.findMany({
      where: { type: RETENTION_JOB_TYPE }
    })
    expect(jobRows.length).toBeGreaterThanOrEqual(1)
    expect(jobRows.some(row => row.status === 'succeeded')).toBe(true)
  }, 30_000)
})

describe('cleanup hygiene', () => {
  afterEach(() => clearJobHandlers())

  test("clearJobHandlers wiping the shared map doesn't strand retention.purge for later tests in this file", async () => {
    clearJobHandlers()
    // `beforeEach` above will restore it before the *next* test, but prove
    // the restoration function itself is what does it (not some other
    // leftover registration), by calling it here explicitly.
    registerRetentionJobs()

    const [jobRow] = await db
      .insert(jobs)
      .values({ type: RETENTION_JOB_TYPE, payload: {}, runAt: new Date() })
      .returning()
    if (!jobRow) throw new Error('expected a job row')

    const result = await processJobs({ now: new Date(), limit: 10 })
    expect(result.succeeded).toBeGreaterThanOrEqual(1)
  })
})

describe('org isolation', () => {
  test("purging one organization's old input/playground runs never touches another's recent data", async () => {
    const orgA = await createOrg()
    const orgB = await createOrg()
    const now = new Date()

    const templateA = await templateWithRetention(orgA, 1)
    const versionA = templateA.versions[0]?.id
    if (!versionA) throw new Error('expected a published version')
    const templateB = await templateWithRetention(orgB, null)
    const versionB = templateB.versions[0]?.id
    if (!versionB) throw new Error('expected a published version')

    const runA = await insertRun(orgA, {
      templateId: templateA.template.id,
      versionId: versionA,
      createdAt: await daysAgo(now, 10)
    })
    await db
      .update(decisionRuns)
      .set({ input: { ticket: { message: 'org a' } } })
      .where(eq(decisionRuns.id, runA.id))

    const runB = await insertRun(orgB, {
      templateId: templateB.template.id,
      versionId: versionB,
      createdAt: await daysAgo(now, 10)
    })
    await db
      .update(decisionRuns)
      .set({ input: { ticket: { message: 'org b' } } })
      .where(eq(decisionRuns.id, runB.id))

    await runRetentionPurge(now)

    const rowA = await db.query.decisionRuns.findFirst({
      where: { id: runA.id }
    })
    expect(rowA?.input).toBeNull()

    const rowB = await db.query.decisionRuns.findFirst({
      where: { id: runB.id }
    })
    expect(rowB?.input).toEqual({ ticket: { message: 'org b' } })
  })
})
