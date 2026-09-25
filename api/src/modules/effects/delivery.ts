import { and, asc, eq, inArray, lt, lte, sql } from 'drizzle-orm'
import { Id } from '#shared/core/base'
import { db } from '#shared/db/config'
import { backoffMs, runWithConcurrency } from '#shared/jobs/queue'
import { effectExecutions, webhookEndpoints } from './effects.schemas'
import { deliverEmail } from './handlers/email'
import { deliverSlack } from './handlers/slack'
import type { Deliver, DeliverResult, ExecutionRow } from './handlers/types'
import { deliverWebhook } from './handlers/webhook'

/**
 * Claims, delivers and completes/fails `effect_executions` — the same
 * claim/backoff/reap shape as `shared/jobs/queue.ts`'s generic jobs queue,
 * but fair across organizations (a busy org's backlog never starves a quiet
 * one's single delivery) and dispatching to a type-specific handler.
 */

const DEFAULT_LEASE_MS = 60_000
const MAX_RESPONSE_BODY_CHARS = 2_048
const ENDPOINT_DISABLE_THRESHOLD = 50

const truncate = (value: string, max: number): string =>
  value.length > max ? value.slice(0, max) : value

// ── Claim ────────────────────────────────────────────────────────────────

export interface ClaimExecutionsOptions {
  limit: number
  now: Date
  leaseMs?: number
  /** This worker instance's id, stamped onto every row it claims — see `releaseRunningExecutions`. Default: a fresh id per call. */
  workerId?: string
  /**
   * Test-only: awaited right after the unlocked candidate scan (step 1),
   * before the row-level lock (step 2). Lets a test deterministically
   * reproduce the exact TOCTOU window a separate, fully-committing
   * transaction could otherwise exploit between those two statements.
   * Never passed in production code.
   */
  afterCandidateSelect?: () => Promise<void> | void
}

/**
 * Claims up to `limit` due executions (`queued`, `run_at <= now`), fairly
 * interleaved across organizations — ranked by `row_number() OVER (PARTITION
 * BY organization_id ORDER BY run_at, id)`, so a busy org's backlog can't
 * starve a quiet org's single queued delivery. `id` (a time-ordered UUIDv7)
 * breaks ties deterministically — both within a partition (same `run_at`)
 * and across organizations tied at the same rank — so which subset is
 * claimed in a tick is reproducible and rotates as earlier-tied rows are
 * claimed, rather than depending on incidental physical row order (which
 * offers no such rotation guarantee and could starve a tied-out organization
 * indefinitely). One short transaction:
 *   1. Rank candidates (no lock — window functions can't combine with `FOR
 *      UPDATE` in the same query).
 *   2. Re-select those ids directly against the table `FOR UPDATE SKIP
 *      LOCKED`, re-checking `status`/`run_at` so a row a *separate*
 *      transaction already claimed-and-completed between steps 1 and 2 can't
 *      be resurrected (SKIP LOCKED alone only skips rows still locked by
 *      someone else — a completed transaction holds no lock).
 *   3. `UPDATE … RETURNING` the ones still available and still due:
 *      `running`, `locked_until = now + lease`, `locked_by = workerId`,
 *      `attempts + 1`, `last_attempt_at = now`.
 * The HTTP call happens outside this transaction (in `processEffects`).
 */
export async function claimExecutions(
  options: ClaimExecutionsOptions
): Promise<ExecutionRow[]> {
  const {
    limit,
    now,
    leaseMs = DEFAULT_LEASE_MS,
    workerId = Id.generate()
  } = options
  if (limit <= 0) return []

  return db.transaction(async tx => {
    const dueQueued = and(
      eq(effectExecutions.status, 'queued'),
      lte(effectExecutions.runAt, now)
    )

    const ranked = tx
      .select({
        id: effectExecutions.id,
        runAt: effectExecutions.runAt,
        rank: sql<number>`row_number() over (partition by ${effectExecutions.organizationId} order by ${effectExecutions.runAt}, ${effectExecutions.id})`.as(
          'rank'
        )
      })
      .from(effectExecutions)
      .where(dueQueued)
      .as('ranked')

    const candidates = await tx
      .select({ id: ranked.id })
      .from(ranked)
      .orderBy(asc(ranked.rank), asc(ranked.runAt), asc(ranked.id))
      .limit(limit)
    if (candidates.length === 0) return []

    const candidateIds = candidates.map(row => row.id)
    if (options.afterCandidateSelect) await options.afterCandidateSelect()
    // Re-checks `status`/`run_at`, not just the id list: a candidate that a
    // separate transaction claimed *and completed* between the select above
    // and this one is no longer locked by anyone (SKIP LOCKED wouldn't skip
    // it), but it's also no longer `queued` — so it's correctly excluded here
    // instead of being resurrected by the blind UPDATE below.
    const lockable = await tx
      .select({ id: effectExecutions.id })
      .from(effectExecutions)
      .where(and(inArray(effectExecutions.id, candidateIds), dueQueued))
      .for('update', { of: effectExecutions, skipLocked: true })
    if (lockable.length === 0) return []

    const lockedIds = lockable.map(row => row.id)
    return tx
      .update(effectExecutions)
      .set({
        status: 'running',
        lockedUntil: new Date(now.getTime() + leaseMs),
        lockedBy: workerId,
        attempts: sql`${effectExecutions.attempts} + 1`,
        lastAttemptAt: now,
        updatedAt: now
      })
      .where(and(inArray(effectExecutions.id, lockedIds), dueQueued))
      .returning()
  })
}

// ── Complete / fail ──────────────────────────────────────────────────────

export interface CompleteExecutionResult {
  status: number
  body: string
  durationMs: number
}

/** Success: `succeeded`, and (webhook only) resets the endpoint's `failureCount` and stamps `lastSuccessAt`. */
export async function completeExecution(
  execution: ExecutionRow,
  result: CompleteExecutionResult,
  now: Date
): Promise<void> {
  await db.transaction(async tx => {
    await tx
      .update(effectExecutions)
      .set({
        status: 'succeeded',
        lastAttemptAt: now,
        lastResponseStatus: result.status,
        lastResponseBody: truncate(result.body, MAX_RESPONSE_BODY_CHARS),
        lastDurationMs: Math.round(result.durationMs),
        lastError: null,
        lockedUntil: null,
        completedAt: now,
        updatedAt: now
      })
      .where(eq(effectExecutions.id, execution.id))

    if (execution.endpointId) {
      await tx
        .update(webhookEndpoints)
        .set({ failureCount: 0, lastSuccessAt: now, updatedAt: now })
        .where(eq(webhookEndpoints.id, execution.endpointId))
    }
  })
}

export interface FailExecutionResult {
  error: string
  status?: number
  body?: string
  durationMs?: number
  /** No further retries, whatever `attempts` is left (e.g. a permanently invalid URL). */
  permanent?: boolean
}

/**
 * Failure: stores the error/response, and either `dead` (permanent, or
 * `attempts >= maxAttempts`) or `queued` again with backoff. A webhook
 * failure also increments the endpoint's `failureCount` and, at
 * {@link ENDPOINT_DISABLE_THRESHOLD} consecutive failures, disables it
 * (`disabledReason: 'too_many_failures'`).
 */
export async function failExecution(
  execution: ExecutionRow,
  result: FailExecutionResult,
  now: Date,
  random?: () => number
): Promise<void> {
  const permanent =
    result.permanent === true || execution.attempts >= execution.maxAttempts
  const delayMs = permanent ? 0 : backoffMs(execution.attempts, random)

  await db.transaction(async tx => {
    await tx
      .update(effectExecutions)
      .set({
        status: permanent ? 'dead' : 'queued',
        lastAttemptAt: now,
        lastError: truncate(result.error, 2_000),
        lastResponseStatus: result.status ?? null,
        lastResponseBody:
          result.body === undefined
            ? null
            : truncate(result.body, MAX_RESPONSE_BODY_CHARS),
        lastDurationMs:
          result.durationMs === undefined
            ? null
            : Math.round(result.durationMs),
        lockedUntil: null,
        runAt: permanent ? execution.runAt : new Date(now.getTime() + delayMs),
        completedAt: permanent ? now : null,
        updatedAt: now
      })
      .where(eq(effectExecutions.id, execution.id))

    if (!execution.endpointId) return

    const [endpoint] = await tx
      .update(webhookEndpoints)
      .set({
        failureCount: sql`${webhookEndpoints.failureCount} + 1`,
        lastFailureAt: now,
        updatedAt: now
      })
      .where(eq(webhookEndpoints.id, execution.endpointId))
      .returning({
        failureCount: webhookEndpoints.failureCount,
        enabled: webhookEndpoints.enabled
      })

    if (
      endpoint?.enabled &&
      endpoint.failureCount >= ENDPOINT_DISABLE_THRESHOLD
    ) {
      await tx
        .update(webhookEndpoints)
        .set({
          enabled: false,
          disabledReason: 'too_many_failures',
          updatedAt: now
        })
        .where(eq(webhookEndpoints.id, execution.endpointId))
    }
  })
}

// ── Reap / release ───────────────────────────────────────────────────────

/** `running` executions whose lease expired → `queued` again (the attempt was already counted), whichever worker held them. Returns how many. */
export async function reapExpiredLeases(now: Date): Promise<number> {
  const rows = await db
    .update(effectExecutions)
    .set({
      status: 'queued',
      lockedUntil: null,
      lockedBy: null,
      updatedAt: now
    })
    .where(
      and(
        eq(effectExecutions.status, 'running'),
        lt(effectExecutions.lockedUntil, now)
      )
    )
    .returning({ id: effectExecutions.id })
  return rows.length
}

/**
 * This worker instance's own `running` executions (`locked_by = workerId`)
 * → `queued`: a worker's forced release of its own claimed-but-unfinished
 * rows on graceful shutdown. Scoped by `workerId` so it never touches a
 * *different* worker instance's in-flight row — unscoped, one worker's
 * shutdown could reset a sibling's row mid-delivery, letting a third worker
 * redeliver it concurrently with the sibling's still-outstanding call.
 * Returns how many.
 */
export async function releaseRunningExecutions(
  now: Date,
  workerId: string
): Promise<number> {
  const rows = await db
    .update(effectExecutions)
    .set({
      status: 'queued',
      lockedUntil: null,
      lockedBy: null,
      updatedAt: now
    })
    .where(
      and(
        eq(effectExecutions.status, 'running'),
        eq(effectExecutions.lockedBy, workerId)
      )
    )
    .returning({ id: effectExecutions.id })
  return rows.length
}

// ── processEffects ───────────────────────────────────────────────────────

const deliverers: Record<ExecutionRow['type'], Deliver> = {
  webhook: deliverWebhook,
  email: deliverEmail,
  slack: deliverSlack
}

async function deliverExecution(
  execution: ExecutionRow,
  now: Date
): Promise<DeliverResult> {
  try {
    return await deliverers[execution.type](execution, { now })
  } catch (error) {
    // A handler should never throw (it returns { ok: false, ... }); this is
    // a last-resort net so one bad delivery can't crash the worker loop.
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

export interface ProcessEffectsOptions {
  limit?: number
  now?: Date
  concurrency?: number
  leaseMs?: number
  random?: () => number
  /** Passed through to `claimExecutions` — see there. */
  workerId?: string
}

export interface ProcessEffectsResult {
  claimed: number
  succeeded: number
  failed: number
  dead: number
}

/** Claims due executions and delivers each through its type's handler (deterministic — no polling). */
export async function processEffects(
  options: ProcessEffectsOptions = {}
): Promise<ProcessEffectsResult> {
  const {
    limit = 20,
    now = new Date(),
    concurrency = 10,
    leaseMs,
    random,
    workerId
  } = options
  const claimed = await claimExecutions({
    limit,
    now,
    ...(leaseMs === undefined ? {} : { leaseMs }),
    ...(workerId === undefined ? {} : { workerId })
  })

  let succeeded = 0
  let failed = 0
  let dead = 0

  await runWithConcurrency(claimed, concurrency, async execution => {
    const completedAt = new Date()
    const outcome = await deliverExecution(execution, completedAt)

    if (outcome.ok) {
      await completeExecution(
        execution,
        {
          status: outcome.status ?? 0,
          body: outcome.body ?? '',
          durationMs: outcome.durationMs ?? 0
        },
        completedAt
      )
      succeeded++
      return
    }

    const willBeDead =
      outcome.permanent === true || execution.attempts >= execution.maxAttempts
    await failExecution(
      execution,
      {
        error: outcome.error ?? 'Delivery failed',
        ...(outcome.status === undefined ? {} : { status: outcome.status }),
        ...(outcome.body === undefined ? {} : { body: outcome.body }),
        ...(outcome.durationMs === undefined
          ? {}
          : { durationMs: outcome.durationMs }),
        ...(outcome.permanent === undefined
          ? {}
          : { permanent: outcome.permanent })
      },
      completedAt,
      random
    )
    if (willBeDead) dead++
    else failed++
  })

  return { claimed: claimed.length, succeeded, failed, dead }
}
