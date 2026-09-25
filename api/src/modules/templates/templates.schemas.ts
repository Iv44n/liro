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
import { organizations, users } from '#modules/auth/auth.schemas'
import type { ModelRef } from '#modules/engine/evaluator/port'
import { Id } from '#shared/core/base'
import { TEMPLATE_KINDS, type TemplateDefinition } from './definition'

export const TEMPLATE_STATUSES = ['active', 'archived'] as const
/** What a run keeps of its input: all of it (minus `pii` fields), only what the policy reads, or nothing. */
export const STORE_INPUT_MODES = ['full', 'policy', 'none'] as const
export const VERSION_STATUSES = [
  'draft',
  'published',
  'deprecated',
  /** The provider no longer serves the pinned model; runs are refused. */
  'model_unavailable'
] as const

export type StoreInputMode = (typeof STORE_INPUT_MODES)[number]
export type VersionStatus = (typeof VERSION_STATUSES)[number]

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull()
}

export const decisionTemplates = pgTable(
  'decision_templates',
  {
    id: text('id').primaryKey().$defaultFn(Id.generate),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    /** Unique per organization; immutable once a version is published. */
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    kind: text('kind', { enum: TEMPLATE_KINDS }).notNull(),
    status: text('status', { enum: TEMPLATE_STATUSES })
      .default('active')
      .notNull(),
    storeInput: text('store_input', { enum: STORE_INPUT_MODES })
      .default('full')
      .notNull(),
    /** Days runs keep their stored input; `null` = forever. */
    retentionDays: integer('retention_days'),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    ...timestamps
  },
  table => [
    uniqueIndex('decision_templates_org_slug_uidx').on(
      table.organizationId,
      table.slug
    ),
    index('decision_templates_org_status_idx').on(
      table.organizationId,
      table.status
    )
  ]
)

/**
 * A template's versions, plus at most one `draft`. A published definition
 * never changes: publishing freezes the draft into a new `major.minor` row.
 */
export const decisionTemplateVersions = pgTable(
  'decision_template_versions',
  {
    id: text('id').primaryKey().$defaultFn(Id.generate),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    templateId: text('template_id')
      .notNull()
      .references(() => decisionTemplates.id, { onDelete: 'cascade' }),
    /** `null` while draft. */
    major: integer('major'),
    minor: integer('minor'),
    status: text('status', { enum: VERSION_STATUSES }).notNull(),
    definition: jsonb('definition').$type<TemplateDefinition>().notNull(),
    /** JSON Schema of the input contract, computed at publish time. */
    inputJsonSchema:
      jsonb('input_json_schema').$type<Record<string, unknown>>(),
    /** `hashJson(definition)`: the draft's ETag, and publish's no-op guard. */
    definitionHash: text('definition_hash').notNull(),
    modelRef: jsonb('model_ref').$type<ModelRef>().notNull(),
    changelog: text('changelog'),
    createdBy: text('created_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    publishedBy: text('published_by').references(() => users.id, {
      onDelete: 'set null'
    }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    deprecatedAt: timestamp('deprecated_at', { withTimezone: true }),
    ...timestamps
  },
  table => [
    uniqueIndex('decision_template_versions_draft_uidx')
      .on(table.templateId)
      .where(sql`status = 'draft'`),
    uniqueIndex('decision_template_versions_number_uidx')
      .on(table.templateId, table.major, table.minor)
      .where(sql`status <> 'draft'`),
    index('decision_template_versions_org_template_idx').on(
      table.organizationId,
      table.templateId
    )
  ]
)

export const templatesRelations = defineRelationsPart(
  { decisionTemplates, decisionTemplateVersions, organizations },
  r => ({
    decisionTemplates: {
      organization: r.one.organizations({
        from: r.decisionTemplates.organizationId,
        to: r.organizations.id
      }),
      versions: r.many.decisionTemplateVersions({
        from: r.decisionTemplates.id,
        to: r.decisionTemplateVersions.templateId
      })
    },
    decisionTemplateVersions: {
      template: r.one.decisionTemplates({
        from: r.decisionTemplateVersions.templateId,
        to: r.decisionTemplates.id
      })
    }
  })
)
