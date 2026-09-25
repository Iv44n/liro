import { sql } from 'drizzle-orm'
import { organizations } from '#modules/auth/auth.schemas'
import { db } from '#shared/db/config'
import { jobs } from '#shared/jobs/jobs.schemas'

/**
 * Preloaded once, before the whole `bun test` run (see `[test].preload` in
 * bunfig.toml — Bun loads it a single time for the process, not per file).
 * `bun test` loads `.env.test` on top of `.env`; this guard makes sure that
 * actually happened before any test can touch a database.
 */
const databaseUrl = process.env.DATABASE_URL ?? ''
const database = databaseUrl ? new URL(databaseUrl).pathname.slice(1) : ''

if (!database.endsWith('_test')) {
  throw new Error(
    `Tests must run against a *_test database (DATABASE_URL points to "${database || 'nothing'}"). ` +
      'Check .env.test and run `bun run test:db`.'
  )
}

if (process.env.EMAIL_PROVIDER !== 'memory') {
  throw new Error('Tests require EMAIL_PROVIDER=memory (see .env.test)')
}

// Every test creates its own org (`test_<random>`, see factories.ts) instead
// of truncating tables, which keeps tests parallel-safe and self-contained.
// That only works if each run starts from a clean slate: a run that crashes,
// gets killed, or fails mid-suite leaves its orgs behind, and every table
// scoped by `organizationId` — crucially the effect/job queues, which are
// claimed *across* organizations for fairness — silently accumulates rows
// that skew later runs (e.g. a "queued" row from months ago competing with a
// fairness test's own rows). Deleting here, once, before any test file runs
// (not in an `afterAll`, which never fires if the process is killed) cascades
// through every dependent table and gives each run a clean queue.
await db
  .delete(organizations)
  .where(sql`left(${organizations.name}, 5) = 'test_'`)

// `jobs` rows are not all tied to an organization (a platform-wide job has
// `organizationId: null`), so the cascade above doesn't reach them. Nothing
// in this `_test` database is real data, so it's simplest to clear the whole
// table rather than track down every insert site.
await db.delete(jobs)
