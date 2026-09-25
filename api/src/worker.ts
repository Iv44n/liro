import {
  processEffects,
  reapExpiredLeases,
  releaseRunningExecutions
} from '#modules/effects/delivery'
// Side-effect import: registers `retention.purge`'s handler and daily
// cadence (see `registerRetentionJobs` there) so this worker actually runs
// it — `runDuePeriodicJobs` below only enqueues what's registered.
import '#modules/retention/retention'
import { log } from '#shared/config/logger'
import { Id } from '#shared/core/base'
import { processJobs, releaseRunningJobs } from '#shared/jobs/queue'
import { runDuePeriodicJobs } from '#shared/jobs/scheduler'

/**
 * The background worker: reaps expired leases, then delivers due effects,
 * then runs due jobs, on a fixed poll interval. Started in-process by
 * `index.ts` (`RUN_WORKER=true`) or standalone (`bun src/worker.ts` /
 * `bun run worker`).
 */

export interface StartWorkerOptions {
  /** Delay between ticks, once one finishes. Default 750 ms. */
  pollMs?: number
  /** This instance's id, stamped on every row it claims so its own graceful shutdown never releases a sibling worker's in-flight row. Default: a fresh id. */
  workerId?: string
}

export interface Worker {
  /** This instance's id — the `lockedBy` every row it claims is stamped with. Mostly for tests exercising more than one instance. */
  readonly id: string
  /**
   * Stops claiming new work, waits up to 10 s for the in-flight tick to
   * finish, then force-releases anything still `running` (this worker's own
   * claimed-but-unfinished rows) back to `queued`.
   */
  stop(): Promise<void>
}

const DEFAULT_POLL_MS = 750
const SHUTDOWN_GRACE_MS = 10_000

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms))

/** Never throws: logs and moves on, so one stage's failure doesn't stop the others. */
async function safely<T>(
  name: string,
  fn: () => Promise<T>
): Promise<T | null> {
  try {
    return await fn()
  } catch (error) {
    log.logger.error(`[worker] ${name} failed`, {
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

async function tick(workerId: string): Promise<void> {
  const now = new Date()

  const reaped = await safely('reaper', () => reapExpiredLeases(now))
  if (reaped) log.logger.info('[worker] reaped expired leases', { reaped })

  // Enqueues any due periodic job (`retention.purge`, and future ones —
  // `shared/jobs/scheduler.ts`) before the claims below, so one claimed this
  // tick can be picked up by `processJobs` in the very same tick.
  const scheduled = await safely('scheduler', () => runDuePeriodicJobs(now))
  if (scheduled)
    log.logger.info('[worker] scheduled periodic jobs', { scheduled })

  const effects = await safely('effects', () =>
    processEffects({ now, workerId })
  )
  if (effects && effects.claimed > 0) {
    // Never logs payload/input: only counts and ids-free aggregates.
    log.logger.info('[worker] processed effects', { ...effects })
  }

  const jobs = await safely('jobs', () => processJobs({ now, workerId }))
  if (jobs && jobs.claimed > 0) {
    log.logger.info('[worker] processed jobs', { ...jobs })
  }
}

export function startWorker(options: StartWorkerOptions = {}): Worker {
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS
  const workerId = options.workerId ?? Id.generate()
  let stopping = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let currentTick: Promise<void> = Promise.resolve()

  function scheduleTick(): void {
    if (stopping) return
    currentTick = tick(workerId)
    currentTick.finally(() => {
      if (!stopping) timer = setTimeout(scheduleTick, pollMs)
    })
  }

  scheduleTick()

  async function stop(): Promise<void> {
    if (stopping) return
    stopping = true
    if (timer) clearTimeout(timer)

    await Promise.race([currentTick, sleep(SHUTDOWN_GRACE_MS)])

    const now = new Date()
    // Scoped to this instance's own `workerId`: a sibling worker instance
    // (concurrent standalone `worker` service replicas, an old/new pair
    // during a rolling deploy, or `RUN_WORKER=true` alongside the standalone
    // service) keeps its own in-flight rows locked — see
    // `releaseRunningExecutions`/`releaseRunningJobs`.
    const releasedEffects = await safely('release effects', () =>
      releaseRunningExecutions(now, workerId)
    )
    const releasedJobs = await safely('release jobs', () =>
      releaseRunningJobs(now, workerId)
    )
    if ((releasedEffects ?? 0) > 0 || (releasedJobs ?? 0) > 0) {
      log.logger.info(
        '[worker] released claimed-but-unfinished rows on shutdown',
        {
          effects: releasedEffects ?? 0,
          jobs: releasedJobs ?? 0
        }
      )
    }
  }

  return { id: workerId, stop }
}

if (import.meta.main) {
  const worker = startWorker()
  log.logger.info('[worker] started', {})

  const shutdown = (signal: string) => {
    log.logger.info(`[worker] received ${signal}, shutting down`, {})
    worker
      .stop()
      .catch(error =>
        log.logger.error('[worker] shutdown failed', { error: String(error) })
      )
      .finally(() => process.exit(0))
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}
