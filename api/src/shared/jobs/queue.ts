import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm'
import { log } from '#shared/config/logger'
import { Id } from '#shared/core/base'
import { db } from '#shared/db/config'
import { jobs } from './jobs.schemas'

/**
 * The generic internal-jobs queue (`jobs`): claim with a lease, complete or
 * fail with backoff, reap an expired lease. Used directly by `processJobs`
 * here; `modules/effects/delivery.ts` implements the parallel (org-fair)
 * queue for `effect_executions` and reuses `backoffMs` and
 * `runWithConcurrency` from this module.
 */

export type JobRow = typeof jobs.$inferSelect

const DEFAULT_LEASE_MS = 60_000

// ── Backoff ──────────────────────────────────────────────────────────────

/** 5 s, 30 s, 2 min, 10 min, 30 min, 1 h, 3 h, 6 h — indexed by attempt (1-based), capped at the last entry. */
export const BACKOFF_SCHEDULE_MS = [
  5_000, 30_000, 120_000, 600_000, 1_800_000, 3_600_000, 10_800_000, 21_600_000
] as const

/**
 * The delay before retrying after the `attempts`-th failed attempt (1-based),
 * ± up to 10% jitter. `random` is injectable so tests can pin the jitter
 * (default `Math.random`).
 */
export function backoffMs(
  attempts: number,
  random: () => number = Math.random
): number {
  const index = Math.min(Math.max(attempts, 1), BACKOFF_SCHEDULE_MS.length) - 1
  const base = BACKOFF_SCHEDULE_MS[index] as number
  const jitter = base * 0.1 * (random() * 2 - 1)
  return Math.max(0, Math.round(base + jitter))
}

// ── Bounded concurrency ─────────────────────────────────────────────────

/** Runs `fn` over `items` with at most `concurrency` in flight; never rejects (callers handle their own errors per item). */
export async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0
  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++
      if (index >= items.length) return
      // biome-ignore lint/style/noNonNullAssertion: index is bounds-checked above
      await fn(items[index]!)
    }
  }
  await Promise.all(Array.from({ length: workerCount }, worker))
}

// ── Handlers ─────────────────────────────────────────────────────────────

export type JobHandler = (job: JobRow) => Promise<void>

const handlers = new Map<string, JobHandler>()

/** Registers the handler `processJobs` calls for a job `type` (purge/rollups/evaluations/alerts register here — Phase 3/4). */
export function registerJobHandler(type: string, handler: JobHandler): void {
  handlers.set(type, handler)
}

/** Test-only: clears every registered handler between tests. */
export function clearJobHandlers(): void {
  handlers.clear()
}

// ── Claim / complete / fail / reap ──────────────────────────────────────

export interface ClaimJobsOptions {
  limit: number
  now: Date
  leaseMs?: number
  /** This worker instance's id, stamped onto every row it claims — see `releaseRunningJobs`. Default: a fresh id per call. */
  workerId?: string
}

/** Claims up to `limit` due jobs (`queued`, `runAt <= now`), oldest first, `FOR UPDATE SKIP LOCKED`. One short transaction. */
export async function claimJobs(options: ClaimJobsOptions): Promise<JobRow[]> {
  const {
    limit,
    now,
    leaseMs = DEFAULT_LEASE_MS,
    workerId = Id.generate()
  } = options
  if (limit <= 0) return []

  return db.transaction(async tx => {
    const candidates = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.status, 'queued'), lte(jobs.runAt, now)))
      .orderBy(asc(jobs.runAt))
      .limit(limit)
      .for('update', { skipLocked: true })
    if (candidates.length === 0) return []

    const ids = candidates.map(row => row.id)
    return tx
      .update(jobs)
      .set({
        status: 'running',
        lockedUntil: new Date(now.getTime() + leaseMs),
        lockedBy: workerId,
        attempts: sql`${jobs.attempts} + 1`,
        updatedAt: now
      })
      .where(inArray(jobs.id, ids))
      .returning()
  })
}

export async function completeJob(id: string, now: Date): Promise<void> {
  await db
    .update(jobs)
    .set({
      status: 'succeeded',
      lockedUntil: null,
      completedAt: now,
      updatedAt: now
    })
    .where(eq(jobs.id, id))
}

export interface FailJobOptions {
  id: string
  now: Date
  error: string
  /** The job's `attempts` as claimed (already incremented) — decides `failed` vs. retry. */
  attempts: number
  maxAttempts: number
  random?: () => number
}

/** Records the failure; `failed` (permanent) once `attempts >= maxAttempts`, else `queued` again after backoff. */
export async function failJob(options: FailJobOptions): Promise<void> {
  const { id, now, error, attempts, maxAttempts, random } = options
  const permanent = attempts >= maxAttempts
  const message = error.slice(0, 2_000)

  if (permanent) {
    await db
      .update(jobs)
      .set({
        status: 'failed',
        lastError: message,
        lockedUntil: null,
        completedAt: now,
        updatedAt: now
      })
      .where(eq(jobs.id, id))
    return
  }

  await db
    .update(jobs)
    .set({
      status: 'queued',
      lastError: message,
      lockedUntil: null,
      runAt: new Date(now.getTime() + backoffMs(attempts, random)),
      updatedAt: now
    })
    .where(eq(jobs.id, id))
}

/** `running` jobs whose lease expired → `queued` again (the attempt was already counted), whichever worker held them. Returns how many. */
export async function reapExpiredJobLeases(now: Date): Promise<number> {
  const rows = await db
    .update(jobs)
    .set({
      status: 'queued',
      lockedUntil: null,
      lockedBy: null,
      updatedAt: now
    })
    .where(and(eq(jobs.status, 'running'), lt(jobs.lockedUntil, now)))
    .returning({ id: jobs.id })
  return rows.length
}

/**
 * This worker instance's own `running` jobs (`locked_by = workerId`) →
 * `queued`: a worker's forced release of its own claimed-but-unfinished rows
 * on graceful shutdown. Scoped by `workerId` so it never touches a
 * *different* worker instance's in-flight job — see
 * `releaseRunningExecutions` for the same reasoning on `effect_executions`.
 * Returns how many.
 */
export async function releaseRunningJobs(
  now: Date,
  workerId: string
): Promise<number> {
  const rows = await db
    .update(jobs)
    .set({
      status: 'queued',
      lockedUntil: null,
      lockedBy: null,
      updatedAt: now
    })
    .where(and(eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
    .returning({ id: jobs.id })
  return rows.length
}

// ── processJobs ──────────────────────────────────────────────────────────

export interface ProcessJobsOptions {
  limit?: number
  now?: Date
  concurrency?: number
  leaseMs?: number
  random?: () => number
  /** Passed through to `claimJobs` — see there. */
  workerId?: string
}

export interface ProcessJobsResult {
  claimed: number
  succeeded: number
  failed: number
  dead: number
}

/** Claims due jobs and runs each through its registered handler (deterministic — no polling). */
export async function processJobs(
  options: ProcessJobsOptions = {}
): Promise<ProcessJobsResult> {
  const {
    limit = 20,
    now = new Date(),
    concurrency = 10,
    leaseMs,
    random,
    workerId
  } = options
  const claimed = await claimJobs({
    limit,
    now,
    ...(leaseMs === undefined ? {} : { leaseMs }),
    ...(workerId === undefined ? {} : { workerId })
  })

  let succeeded = 0
  let failed = 0
  let dead = 0

  await runWithConcurrency(claimed, concurrency, async job => {
    const handler = handlers.get(job.type)
    if (!handler) {
      await failJob({
        id: job.id,
        now: new Date(),
        error: `No handler registered for job type "${job.type}"`,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        random
      })
      if (job.attempts >= job.maxAttempts) dead++
      else failed++
      return
    }

    try {
      await handler(job)
      await completeJob(job.id, new Date())
      succeeded++
    } catch (error) {
      log.logger.error('[jobs] job failed', {
        type: job.type,
        id: job.id,
        error: error instanceof Error ? error.message : String(error)
      })
      await failJob({
        id: job.id,
        now: new Date(),
        error: error instanceof Error ? error.message : String(error),
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        random
      })
      if (job.attempts >= job.maxAttempts) dead++
      else failed++
    }
  })

  return { claimed: claimed.length, succeeded, failed, dead }
}
