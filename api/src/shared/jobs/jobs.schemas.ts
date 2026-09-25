import { defineRelationsPart, sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core'
import { organizations } from '#modules/auth/auth.schemas'
import type { JsonObject } from '#modules/templates/paths'
import { Id } from '#shared/core/base'

/**
 * Internal background tasks (purge, rollups, evaluations, alerts — Phase
 * 3/4): a generic queue, claimed/completed/failed the same way as
 * `effect_executions` (see `shared/jobs/queue.ts`), but not tied to a run.
 */

export const JOB_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed'
] as const
export type JobStatus = (typeof JOB_STATUSES)[number]

export const jobs = pgTable(
  'jobs',
  {
    id: text('id').primaryKey().$defaultFn(Id.generate),
    /** The handler registered for this type (`registerJobHandler`). */
    type: text('type').notNull(),
    /** `null` for a platform-wide job (not scoped to one organization). */
    organizationId: text('organization_id').references(() => organizations.id, {
      onDelete: 'cascade'
    }),
    payload: jsonb('payload').$type<JsonObject>().notNull(),
    status: text('status', { enum: JOB_STATUSES }).default('queued').notNull(),
    runAt: timestamp('run_at', { withTimezone: true }).defaultNow().notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(5).notNull(),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    /** The claiming worker instance's id, set at claim time; scopes graceful shutdown's release to its own rows (see `worker.ts`). */
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    /**
     * Set by periodic jobs (a purge run, a daily rollup...) so the scheduler
     * can't enqueue the same pending job twice; unique only while queued/running.
     */
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true })
  },
  table => [
    index('jobs_queued_run_at_idx')
      .on(table.runAt)
      .where(sql`status = 'queued'`),
    index('jobs_org_idx').on(table.organizationId),
    uniqueIndex('jobs_dedupe_key_uidx')
      .on(table.dedupeKey)
      .where(sql`dedupe_key is not null and status in ('queued', 'running')`)
  ]
)

export const jobsRelations = defineRelationsPart(
  { jobs, organizations },
  () => ({
    jobs: {}
  })
)
