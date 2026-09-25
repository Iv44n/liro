import { defineRelationsPart } from 'drizzle-orm'
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { organizations, users } from '#modules/auth/auth.schemas'
import type { ReviewReason } from '#modules/engine/types'
import { decisionRuns } from '#modules/runs/runs.schemas'
import { decisionTemplates } from '#modules/templates/templates.schemas'
import { Id } from '#shared/core/base'

export const REVIEW_STATUSES = [
  'pending',
  'resolved',
  'dismissed',
  'expired'
] as const

export const REVIEW_REASONS = [
  'low_confidence',
  'always_review',
  'rule',
  'fallback'
] as const satisfies readonly ReviewReason[]

export type ReviewStatus = (typeof REVIEW_STATUSES)[number]

/**
 * Human review of a run that ended in `needs_review`. Created in the run's
 * own transaction — a caller can't get a `needs_review` run without one.
 */
export const reviewTasks = pgTable(
  'review_tasks',
  {
    id: text('id').primaryKey().$defaultFn(Id.generate),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    runId: text('run_id')
      .notNull()
      .unique()
      .references(() => decisionRuns.id, { onDelete: 'cascade' }),
    templateId: text('template_id')
      .notNull()
      .references(() => decisionTemplates.id, { onDelete: 'cascade' }),
    status: text('status', { enum: REVIEW_STATUSES })
      .default('pending')
      .notNull(),
    reason: text('reason', { enum: REVIEW_REASONS }).notNull(),
    suggestedDecision: text('suggested_decision'),
    /** The version's labels, `needs_review` excluded. */
    allowedDecisions: text('allowed_decisions').array().notNull(),
    resolvedDecision: text('resolved_decision'),
    resolvedBy: text('resolved_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    comment: text('comment'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull()
  },
  table => [
    index('review_tasks_org_status_created_idx').on(
      table.organizationId,
      table.status,
      table.createdAt
    )
  ]
)

export const reviewsRelations = defineRelationsPart(
  { reviewTasks, decisionRuns, decisionTemplates },
  r => ({
    reviewTasks: {
      run: r.one.decisionRuns({
        from: r.reviewTasks.runId,
        to: r.decisionRuns.id
      }),
      template: r.one.decisionTemplates({
        from: r.reviewTasks.templateId,
        to: r.decisionTemplates.id
      })
    }
  })
)
