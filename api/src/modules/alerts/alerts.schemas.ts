import { defineRelationsPart } from 'drizzle-orm'
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp
} from 'drizzle-orm/pg-core'
import { organizations, users } from '#modules/auth/auth.schemas'
import { decisionTemplates } from '#modules/templates/templates.schemas'
import { Id } from '#shared/core/base'

/**
 * Alerting: an organization's `alert_rules` are evaluated on a 5-minute
 * cadence (`alerts.evaluate`, registered in `alerts.service.ts`) against
 * `decision_runs`/`webhook_endpoints`; a rule that trips fires an
 * `alert_events` row and a notification (email or webhook).
 */

export const ALERT_METRICS = [
  /** Share of succeeded runs that ended `needs_review`, in the window. */
  'review_rate',
  /** Share of all runs that ended `failed`, in the window. */
  'failure_rate',
  /** Count of failed (evaluator-error) runs in the window. */
  'jev_errors',
  /** The highest current `webhook_endpoints.failure_count` in scope — already a running consecutive-failure counter, not windowed. */
  'endpoint_failing'
] as const
export type AlertMetric = (typeof ALERT_METRICS)[number]

export const ALERT_CHANNELS = ['email', 'webhook'] as const
export type AlertChannel = (typeof ALERT_CHANNELS)[number]

/** Shaped by `channel`: member emails for `email`, a `webhook_endpoints` id for `webhook`. */
export type AlertTarget = { to: string[] } | { endpointId: string }

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull()
}

/** One alerting rule of an organization. */
export const alertRules = pgTable(
  'alert_rules',
  {
    id: text('id').primaryKey().$defaultFn(Id.generate),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** `null` = every template of the organization. */
    templateId: text('template_id').references(() => decisionTemplates.id, {
      onDelete: 'cascade'
    }),
    metric: text('metric', { enum: ALERT_METRICS }).notNull(),
    /** A rate in `[0, 1]` for `review_rate`/`failure_rate`; a count (>= 1) for `jev_errors`/`endpoint_failing`. */
    threshold: doublePrecision('threshold').notNull(),
    windowMinutes: integer('window_minutes').default(60).notNull(),
    /** Minimum sample size (succeeded runs for `review_rate`, all runs for `failure_rate`) before a rate metric is judged; unused by `jev_errors`/`endpoint_failing`. */
    minRuns: integer('min_runs').default(20).notNull(),
    channel: text('channel', { enum: ALERT_CHANNELS }).notNull(),
    target: jsonb('target').$type<AlertTarget>().notNull(),
    enabled: boolean('enabled').default(true).notNull(),
    cooldownMinutes: integer('cooldown_minutes').default(60).notNull(),
    /** Set on every trip (whether or not the notification itself succeeded) — gates the next one via `cooldownMinutes`. */
    lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    ...timestamps
  },
  table => [
    index('alert_rules_org_enabled_idx').on(table.organizationId, table.enabled)
  ]
)

/** One trip of an `alert_rules` row. */
export const alertEvents = pgTable(
  'alert_events',
  {
    id: text('id').primaryKey().$defaultFn(Id.generate),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    ruleId: text('rule_id')
      .notNull()
      .references(() => alertRules.id, { onDelete: 'cascade' }),
    /** The computed metric value at trip time (rate or count — see `alertRules.metric`). */
    value: doublePrecision('value').notNull(),
    /** The rule's `threshold` at trip time (rules can change afterwards; the event keeps what actually tripped it). */
    threshold: doublePrecision('threshold').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>(),
    triggeredAt: timestamp('triggered_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    /** Set once the notification (email or webhook) is confirmed sent. */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    /** Set instead of `notifiedAt` when the notification itself failed (the trip is still recorded). */
    notifyError: text('notify_error')
  },
  table => [
    index('alert_events_org_rule_triggered_idx').on(
      table.organizationId,
      table.ruleId,
      table.triggeredAt.desc()
    )
  ]
)

export const alertsRelations = defineRelationsPart(
  { alertRules, alertEvents, organizations, decisionTemplates },
  r => ({
    alertRules: {
      organization: r.one.organizations({
        from: r.alertRules.organizationId,
        to: r.organizations.id
      }),
      template: r.one.decisionTemplates({
        from: r.alertRules.templateId,
        to: r.decisionTemplates.id
      })
    },
    alertEvents: {
      organization: r.one.organizations({
        from: r.alertEvents.organizationId,
        to: r.organizations.id
      }),
      rule: r.one.alertRules({
        from: r.alertEvents.ruleId,
        to: r.alertRules.id
      })
    }
  })
)
