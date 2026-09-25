import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm'
import { effectExecutions } from '#modules/effects/effects.schemas'
import {
  purgeExpiredIdempotencyKeys,
  type Queryable
} from '#modules/runs/idempotency'
import { decisionRuns } from '#modules/runs/runs.schemas'
import { decisionTemplates } from '#modules/templates/templates.schemas'
import { log } from '#shared/config/logger'
import { db } from '#shared/db/config'
import { jobs } from '#shared/jobs/jobs.schemas'
import { type JobHandler, registerJobHandler } from '#shared/jobs/queue'
import { registerPeriodicJob } from '#shared/jobs/scheduler'

/**
 * The daily `retention.purge` job: bounds how much a template's runs, and
 * the internal queues, grow forever. Nothing here is org-scoped work done
 * inline in a request — it all runs on the worker, batched.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** Fixed retention windows (unlike a run's `input`, which is per-template — see `purgeOldInput`). */
export const PLAYGROUND_RUN_RETENTION_DAYS = 7
export const EFFECT_EXECUTION_RETENTION_DAYS = 30
export const JOB_RETENTION_DAYS = 7

/** Rows touched per statement in a purge loop — bounds each one to a short lock instead of one giant statement over the whole table. */
const BATCH_SIZE = 1_000

export const RETENTION_JOB_TYPE = 'retention.purge'
const RETENTION_INTERVAL_MS = DAY_MS

/** Runs `step` (one bounded statement) until it reports fewer than `BATCH_SIZE` rows, i.e. it has caught up. Returns the total rows affected. */
async function runInBatches(step: () => Promise<number>): Promise<number> {
  let total = 0
  for (;;) {
    const affected = await step()
    total += affected
    if (affected < BATCH_SIZE) return total
  }
}

// ── Per-template input purge ────────────────────────────────────────────

async function purgeOldInputBatch(
  templateId: string,
  cutoff: Date,
  executor: Queryable
): Promise<number> {
  const candidates = await executor
    .select({ id: decisionRuns.id })
    .from(decisionRuns)
    .where(
      and(
        eq(decisionRuns.templateId, templateId),
        lt(decisionRuns.createdAt, cutoff),
        isNotNull(decisionRuns.input)
      )
    )
    .limit(BATCH_SIZE)
  if (candidates.length === 0) return 0

  const ids = candidates.map(row => row.id)
  await executor
    .update(decisionRuns)
    .set({ input: null })
    .where(inArray(decisionRuns.id, ids))
  return ids.length
}

/**
 * For every template with a `retentionDays`, nulls out `input` (never
 * `policyInput` — the policy-relevant subset a run needs to stay replayable)
 * on its runs older than that many days. `retentionDays: null` means "keep
 * forever" and is skipped entirely.
 *
 * Not retroactive the other way either: changing a template's `storeInput`
 * to `'none'` only stops *new* runs from storing input — it does not purge
 * what's already stored on older runs. Only this job's `retentionDays`
 * cutoff (or a later change to it) does that.
 */
async function purgeOldInput(now: Date, executor: Queryable): Promise<number> {
  const templates = await executor
    .select({
      id: decisionTemplates.id,
      retentionDays: decisionTemplates.retentionDays
    })
    .from(decisionTemplates)
    .where(isNotNull(decisionTemplates.retentionDays))

  let total = 0
  for (const template of templates) {
    const retentionDays = template.retentionDays
    if (retentionDays === null) continue // narrows the type; the query above already filters these out
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS)
    total += await runInBatches(() =>
      purgeOldInputBatch(template.id, cutoff, executor)
    )
  }
  return total
}

// ── Playground runs ──────────────────────────────────────────────────────

async function purgePlaygroundRunsBatch(
  cutoff: Date,
  executor: Queryable
): Promise<number> {
  const candidates = await executor
    .select({ id: decisionRuns.id })
    .from(decisionRuns)
    .where(
      and(
        eq(decisionRuns.source, 'playground'),
        lt(decisionRuns.createdAt, cutoff)
      )
    )
    .limit(BATCH_SIZE)
  if (candidates.length === 0) return 0

  const ids = candidates.map(row => row.id)
  await executor.delete(decisionRuns).where(inArray(decisionRuns.id, ids))
  return ids.length
}

// ── Effect executions ────────────────────────────────────────────────────

async function purgeEffectExecutionsBatch(
  cutoff: Date,
  executor: Queryable
): Promise<number> {
  const candidates = await executor
    .select({ id: effectExecutions.id })
    .from(effectExecutions)
    .where(
      and(
        inArray(effectExecutions.status, ['succeeded', 'dead']),
        lt(effectExecutions.completedAt, cutoff)
      )
    )
    .limit(BATCH_SIZE)
  if (candidates.length === 0) return 0

  const ids = candidates.map(row => row.id)
  await executor
    .delete(effectExecutions)
    .where(inArray(effectExecutions.id, ids))
  return ids.length
}

// ── Jobs ─────────────────────────────────────────────────────────────────

async function purgeOldJobsBatch(
  cutoff: Date,
  executor: Queryable
): Promise<number> {
  const candidates = await executor
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.status, 'succeeded'), lt(jobs.completedAt, cutoff)))
    .limit(BATCH_SIZE)
  if (candidates.length === 0) return 0

  const ids = candidates.map(row => row.id)
  await executor.delete(jobs).where(inArray(jobs.id, ids))
  return ids.length
}

// ── The whole purge ──────────────────────────────────────────────────────

export interface RetentionPurgeResult {
  /** Runs whose `input` was nulled out, past their template's `retentionDays`. */
  inputNulled: number
  /** Playground runs deleted, past `PLAYGROUND_RUN_RETENTION_DAYS`. */
  playgroundRunsDeleted: number
  /** Expired `idempotency_keys` rows deleted (`purgeExpiredIdempotencyKeys`). */
  idempotencyKeysDeleted: number
  /** Succeeded/dead `effect_executions` deleted, past `EFFECT_EXECUTION_RETENTION_DAYS`. */
  effectExecutionsDeleted: number
  /** Succeeded `jobs` deleted, past `JOB_RETENTION_DAYS`. */
  jobsDeleted: number
}

/**
 * The whole daily purge, computed with the JS clock's `now` (tests move it
 * with `setSystemTime`). Every delete/update is batched — `BATCH_SIZE` rows
 * per statement, looping until a batch comes back short — so no single
 * statement holds a lock over the whole table. Order doesn't matter between
 * steps (they touch disjoint rows), so they simply run one after another.
 */
export async function runRetentionPurge(
  now: Date,
  executor: Queryable = db
): Promise<RetentionPurgeResult> {
  const inputNulled = await purgeOldInput(now, executor)

  const playgroundRunsDeleted = await runInBatches(() =>
    purgePlaygroundRunsBatch(
      new Date(now.getTime() - PLAYGROUND_RUN_RETENTION_DAYS * DAY_MS),
      executor
    )
  )

  const idempotencyKeysDeleted = await purgeExpiredIdempotencyKeys(
    now,
    executor
  )

  const effectExecutionsDeleted = await runInBatches(() =>
    purgeEffectExecutionsBatch(
      new Date(now.getTime() - EFFECT_EXECUTION_RETENTION_DAYS * DAY_MS),
      executor
    )
  )

  const jobsDeleted = await runInBatches(() =>
    purgeOldJobsBatch(
      new Date(now.getTime() - JOB_RETENTION_DAYS * DAY_MS),
      executor
    )
  )

  return {
    inputNulled,
    playgroundRunsDeleted,
    idempotencyKeysDeleted,
    effectExecutionsDeleted,
    jobsDeleted
  }
}

/** The `jobs` handler for `RETENTION_JOB_TYPE` — exported for tests to call directly, bypassing the queue. */
export const retentionPurgeHandler: JobHandler = async () => {
  const now = new Date()
  const result = await runRetentionPurge(now)
  log.logger.info('[retention] purge complete', { ...result })
}

/**
 * Wires this module into the worker: the `retention.purge` handler
 * (`shared/jobs/queue.ts`) and its daily cadence (`shared/jobs/scheduler.ts`).
 * Called once below, at module load, for production — both registries are
 * plain in-memory `Map`/array state for the process, so a test that clears
 * them (`clearJobHandlers`, `clearPeriodicJobs`) must call this again
 * afterwards to restore it for the rest of the suite.
 */
export function registerRetentionJobs(): void {
  registerJobHandler(RETENTION_JOB_TYPE, retentionPurgeHandler)
  registerPeriodicJob({
    dedupeKeyPrefix: 'retention',
    intervalMs: RETENTION_INTERVAL_MS,
    type: RETENTION_JOB_TYPE,
    payloadFor: () => ({})
  })
}

registerRetentionJobs()
