import { desc, eq, sql } from 'drizzle-orm'
import type { JsonObject } from '#modules/templates/paths'
import { db } from '#shared/db/config'
import { jobs } from './jobs.schemas'

/**
 * A small reusable scheduler for periodic jobs (`retention.purge`,
 * `alerts.evaluate`, future rollups): a job definition registers itself once
 * with {@link registerPeriodicJob}, and {@link runDuePeriodicJobs} — called
 * once per worker tick, before the effects/jobs claim (see `worker.ts`) —
 * enqueues the due ones. A periodic job's own module never needs to touch
 * `worker.ts`: it registers its `jobs`-queue handler with
 * `registerJobHandler` (`shared/jobs/queue.ts`) as usual, and its cadence
 * with `registerPeriodicJob` here, both at module load.
 *
 * ## Due-ness and de-duplication
 * A definition is *due* when no `jobs` row of its `type` was created within
 * the last `intervalMs` (checked against the most recent one, whatever its
 * status) — so a slow-to-process or still-`queued` run never causes a second
 * one to be enqueued early, and a permanently `failed` one is simply retried
 * at the next window rather than immediately. Once due, the enqueued row's
 * `dedupeKey` is `` `${dedupeKeyPrefix}:${windowStartIso}` `` — the ISO
 * instant of the current `intervalMs`-wide window's start (e.g. midnight UTC
 * for a daily job) — so two worker instances racing the same due check at
 * the same moment (the normal single-instance path already only has one tick
 * in flight at a time — see `worker.ts`) compute the identical key and only
 * one insert wins, via `jobs`'s partial unique index on `dedupeKey` (unique
 * while `queued`/`running`; see `jobs.schemas.ts`). That index is this
 * function's *only* safety net against a double-enqueue race — the due
 * check above is what stops it from firing again every tick.
 */

export interface PeriodicJobDefinition {
  /**
   * Combined with the current window's start to build the enqueued row's
   * `dedupeKey` — e.g. `'retention'` → `retention:2026-09-22T00:00:00.000Z`.
   * Must be unique to this definition (typically derived from `type`, as
   * `'retention'` is for `'retention.purge'`): two definitions that share a
   * prefix and happen to compute the same window (same `intervalMs`,
   * checked in the same window) collide on `dedupeKey` and only one of them
   * gets enqueued that window.
   */
  dedupeKeyPrefix: string
  /** How often this job is due, in ms (e.g. a day, 5 minutes). */
  intervalMs: number
  /** The `jobs.type` enqueued — its handler is registered separately with `registerJobHandler`. */
  type: string
  /** The payload for a run starting at `now`. */
  payloadFor: (now: Date) => JsonObject
}

const registry: PeriodicJobDefinition[] = []

/**
 * Registers a periodic job definition; `runDuePeriodicJobs` enqueues it once
 * per `intervalMs` window from then on. Call once at module load (registering
 * the same `type` again just adds a second entry — call at most once per
 * `type`, or use {@link clearPeriodicJobs} first, e.g. in a test).
 */
export function registerPeriodicJob(definition: PeriodicJobDefinition): void {
  registry.push(definition)
}

/** Test-only: clears every registered periodic job definition. */
export function clearPeriodicJobs(): void {
  registry.length = 0
}

/** Test-only: the currently registered definitions, in registration order. */
export function periodicJobDefinitions(): readonly PeriodicJobDefinition[] {
  return registry
}

/** No `jobs` row of `type` was created within the last `intervalMs`, as of `now`. */
async function isDue(
  definition: PeriodicJobDefinition,
  now: Date
): Promise<boolean> {
  const [last] = await db
    .select({ createdAt: jobs.createdAt })
    .from(jobs)
    .where(eq(jobs.type, definition.type))
    .orderBy(desc(jobs.createdAt))
    .limit(1)
  if (!last) return true
  return now.getTime() - last.createdAt.getTime() >= definition.intervalMs
}

function dedupeKeyFor(definition: PeriodicJobDefinition, now: Date): string {
  const windowStart =
    Math.floor(now.getTime() / definition.intervalMs) * definition.intervalMs
  return `${definition.dedupeKeyPrefix}:${new Date(windowStart).toISOString()}`
}

/**
 * Enqueues a `jobs` row for every registered definition that is due at `now`
 * (see the module doc for what "due" means and how the race with a second
 * worker instance is handled). Never throws — a single definition's due
 * check or insert failing is logged by the caller's own `safely` wrapper in
 * `worker.ts`'s `tick`, same as the other stages; this function itself has
 * nothing further to catch per-definition, so one definition's failure does
 * propagate and skip the rest — callers that register several definitions
 * and want one's failure to never block another's should catch per
 * definition themselves. Returns how many were newly enqueued.
 */
export async function runDuePeriodicJobs(now: Date): Promise<number> {
  let enqueued = 0
  for (const definition of registry) {
    if (!(await isDue(definition, now))) continue

    const inserted = await db
      .insert(jobs)
      .values({
        type: definition.type,
        payload: definition.payloadFor(now),
        runAt: now,
        dedupeKey: dedupeKeyFor(definition, now)
      })
      .onConflictDoNothing({
        target: jobs.dedupeKey,
        where: sql`${jobs.dedupeKey} is not null and ${jobs.status} in ('queued', 'running')`
      })
      .returning({ id: jobs.id })
    if (inserted.length > 0) enqueued++
  }
  return enqueued
}
