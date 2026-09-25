import { and, desc, eq, inArray, ne, type SQL, sql } from 'drizzle-orm'
import z from 'zod'
import { effectBindings } from '#modules/effects/effects.schemas'
import { effectWarningsFor } from '#modules/effects/effects.service'
import type { EffectWarning } from '#modules/effects/effects.views'
import {
  type EvaluatorCapabilities,
  getEvaluator
} from '#modules/engine/evaluator'
import { Id } from '#shared/core/base'
import { hashJson } from '#shared/core/hash'
import { db } from '#shared/db/config'
import { ApiError } from '#shared/http/errors'
import {
  DEFINITION_LIMITS,
  decisionLabels,
  entrySchema,
  inputFieldSchema,
  keySchema,
  labelSchema,
  TEMPLATE_KINDS,
  type TemplateDefinition,
  type TemplateKind,
  templateDefinitionSchema
} from './definition'
import { GALLERY, galleryTemplate } from './gallery'
import { inputJsonSchema } from './input-schema'
import { hasLintErrors, type LintIssue, lintDefinition } from './lint'
import {
  decisionTemplates,
  decisionTemplateVersions,
  STORE_INPUT_MODES,
  TEMPLATE_STATUSES
} from './templates.schemas'
import {
  type DraftView,
  draftView,
  isReleased,
  type ReleasedVersionRow,
  type TemplateRow,
  type TemplateView,
  type TemplateWarning,
  templateView,
  type VersionDetailView,
  type VersionRow,
  type VersionSummary,
  type VersionView,
  versionDetailView,
  versionView
} from './templates.views'
import {
  breakingChanges,
  type DefinitionChange,
  diffDefinitions,
  formatVersion,
  nextVersion,
  SLUG_MAX_LENGTH,
  SLUG_PATTERN,
  slugify
} from './versioning'
import {
  classifyDefinition,
  decideDefinition,
  scoreDefinition
} from './wizards'

/**
 * Template management: templates, their single draft and their immutable
 * published versions. Every query is scoped by organization; a row of
 * another organization is indistinguishable from a missing one (404).
 */

type Database = typeof db
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
/** The database, or a transaction on it. */
export type DbExecutor = Database | Transaction

const templates = decisionTemplates
const versions = decisionTemplateVersions

const SLUG_INDEX = 'decision_templates_org_slug_uidx'
const DRAFT_INDEX = 'decision_template_versions_draft_uidx'
const NUMBER_INDEX = 'decision_template_versions_number_uidx'

// ── Request bodies ───────────────────────────────────────────────────────

/** Postgres `integer`: larger values would fail in the database. */
const MAX_INT = 2_147_483_647

/**
 * Postgres `text` and `jsonb` can't hold NUL (`\u0000`): a query carrying one
 * fails outright, which would surface as a 500. Every client string that
 * reaches SQL is checked first: a 422 for body fields, a 404 for ids.
 */
const hasNul = (value: string) => value.includes('\u0000')
const NUL_MESSAGE = 'Must not contain NUL characters'

/** The path of every string in `value` (object keys included) holding a NUL. */
function nulPaths(
  value: unknown,
  path: (string | number)[] = [],
  found: (string | number)[][] = []
): (string | number)[][] {
  if (typeof value === 'string') {
    if (hasNul(value)) found.push(path)
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      nulPaths(item, [...path, index], found)
    })
  } else if (typeof value === 'object' && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      if (hasNul(key)) found.push([...path, key])
      else nulPaths(item, [...path, key], found)
    }
  }
  return found
}

/**
 * `schema`, also refusing a NUL in any string it holds (reported at that
 * string's path), so the value can be stored in `text`/`jsonb` columns.
 */
export const withoutNul = <T extends z.ZodType>(schema: T): T =>
  schema.superRefine((value, ctx) => {
    for (const path of nulPaths(value)) {
      ctx.addIssue({ code: 'custom', path, message: NUL_MESSAGE })
    }
  })

/** A definition that can be stored: `templateDefinitionSchema` without NULs. */
export const storableDefinitionSchema = withoutNul(templateDefinitionSchema)

const nameSchema = z.string().trim().min(1).max(120)
const descriptionSchema = z.string().max(2_000).nullable()
export const slugSchema = z
  .string()
  .max(SLUG_MAX_LENGTH)
  .regex(
    SLUG_PATTERN,
    'Use lowercase letters and digits, separated by single hyphens'
  )
const retentionDaysSchema = z.number().int().min(1).max(MAX_INT).nullable()

const wizardLabelSchema = z.object({
  label: labelSchema,
  description: z.string().max(2_000).optional(),
  criteria: entrySchema.nullable().optional()
})

const wizardFieldsSchema = z.array(inputFieldSchema).optional()

export const templateSourceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('blank'), kind: z.enum(TEMPLATE_KINDS) }),
  z.object({
    type: z.literal('gallery'),
    id: z
      .string()
      .refine(
        id => GALLERY.some(template => template.id === id),
        'Unknown gallery template'
      )
  }),
  z.object({
    type: z.literal('classify'),
    fields: wizardFieldsSchema,
    instructions: entrySchema,
    labels: z.array(wizardLabelSchema),
    minConfidence: z.number().optional(),
    questionId: keySchema.optional()
  }),
  z.object({
    type: z.literal('decide'),
    fields: wizardFieldsSchema,
    instructions: entrySchema,
    yes: wizardLabelSchema,
    no: wizardLabelSchema,
    yesThreshold: z.number().optional(),
    noThreshold: z.number().optional(),
    questionId: keySchema.optional()
  }),
  z.object({
    type: z.literal('score'),
    fields: wizardFieldsSchema,
    instructions: entrySchema,
    levels: z.array(wizardLabelSchema),
    minConfidence: z.number().optional(),
    questionId: keySchema.optional()
  }),
  z.object({
    type: z.literal('definition'),
    definition: templateDefinitionSchema
  })
])

export type TemplateSource = z.output<typeof templateSourceSchema>

/** The whole body is checked for NULs: wizard fields end up in the definition too. */
export const createTemplateSchema = withoutNul(
  z.object({
    name: nameSchema,
    slug: slugSchema.optional(),
    description: descriptionSchema.optional(),
    storeInput: z.enum(STORE_INPUT_MODES).optional(),
    retentionDays: retentionDaysSchema.optional(),
    source: templateSourceSchema
  })
)

export type CreateTemplateBody = z.output<typeof createTemplateSchema>

export const updateTemplateSchema = withoutNul(
  z.object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    slug: slugSchema.optional(),
    storeInput: z.enum(STORE_INPUT_MODES).optional(),
    retentionDays: retentionDaysSchema.optional()
  })
)

export type UpdateTemplateBody = z.output<typeof updateTemplateSchema>

export const listTemplatesQuerySchema = z.object({
  status: z.enum([...TEMPLATE_STATUSES, 'all']).default('active')
})

export type TemplateStatusFilter = z.output<
  typeof listTemplatesQuerySchema
>['status']

export const saveDraftSchema = z.object({
  definition: storableDefinitionSchema
})

export const publishSchema = withoutNul(
  z.object({
    expectedDraftHash: z.string().min(1),
    major: z.boolean().optional(),
    changelog: z.string().max(2_000).optional()
  })
)

export type PublishBody = z.output<typeof publishSchema>

// ── Errors ───────────────────────────────────────────────────────────────

interface Issue {
  path: string
  message: string
  code: string
}

const validationFailed = (issues: Issue[]) =>
  new ApiError(422, 'VALIDATION_FAILED', 'Request validation failed', {
    details: { issues }
  })

const templateNotFound = () =>
  new ApiError(404, 'NOT_FOUND', 'Template not found')

const versionNotFound = () =>
  new ApiError(404, 'NOT_FOUND', 'Version not found')

const slugTaken = (slug: string) =>
  new ApiError(
    409,
    'SLUG_TAKEN',
    `Another template of this organization already uses the slug "${slug}"`,
    { details: { slug } }
  )

const draftConflict = (currentHash: string | null) =>
  new ApiError(
    409,
    'DRAFT_CONFLICT',
    'The draft changed since you loaded it; reload it and apply your changes again',
    { details: { currentHash } }
  )

/** Whether `error` (or the driver error it wraps) violates `constraint`. */
function isUniqueViolation(error: unknown, constraint: string): boolean {
  for (let current = error, depth = 0; depth < 3; depth++) {
    if (typeof current !== 'object' || current === null) return false
    const { errno, constraint: violated } = current as {
      errno?: unknown
      constraint?: unknown
    }
    if (errno === '23505') return violated === constraint
    current = (current as { cause?: unknown }).cause
  }
  return false
}

// ── Queries ──────────────────────────────────────────────────────────────

/** `id`, or `notFound()` for an id no row can have (and SQL can't carry). */
function queryableId(id: string, notFound: () => ApiError): string {
  if (hasNul(id)) throw notFound()
  return id
}

const templateScope = (organizationId: string, id: string): SQL | undefined =>
  and(
    eq(templates.id, queryableId(id, templateNotFound)),
    eq(templates.organizationId, organizationId)
  )

const versionScope = (organizationId: string, templateId: string) =>
  and(
    eq(versions.templateId, queryableId(templateId, templateNotFound)),
    eq(versions.organizationId, organizationId)
  )

const versionIdIs = (versionId: string) =>
  eq(versions.id, queryableId(versionId, versionNotFound))

/** The template `id` of the organization, or a 404 `NOT_FOUND`. */
export async function getTemplate(
  organizationId: string,
  id: string,
  executor: DbExecutor = db
): Promise<TemplateRow> {
  const [row] = await executor
    .select()
    .from(templates)
    .where(templateScope(organizationId, id))
    .limit(1)
  if (!row) throw templateNotFound()
  return row
}

/** The same, locking the row until the transaction ends. */
async function lockTemplate(
  organizationId: string,
  id: string,
  tx: Transaction
): Promise<TemplateRow> {
  const [row] = await tx
    .select()
    .from(templates)
    .where(templateScope(organizationId, id))
    .for('update')
  if (!row) throw templateNotFound()
  return row
}

const summaryColumns = {
  id: versions.id,
  templateId: versions.templateId,
  status: versions.status,
  major: versions.major,
  minor: versions.minor,
  publishedAt: versions.publishedAt
}

async function versionSummaries(
  organizationId: string,
  templateIds: string[],
  executor: DbExecutor = db
): Promise<Map<string, VersionSummary[]>> {
  const rows = await executor
    .select(summaryColumns)
    .from(versions)
    .where(
      and(
        eq(versions.organizationId, organizationId),
        inArray(versions.templateId, templateIds)
      )
    )
  const byTemplate = new Map<string, VersionSummary[]>()
  for (const { templateId, ...summary } of rows) {
    const list = byTemplate.get(templateId) ?? []
    list.push(summary)
    byTemplate.set(templateId, list)
  }
  return byTemplate
}

async function viewOf(
  organizationId: string,
  template: TemplateRow,
  executor: DbExecutor = db
): Promise<TemplateView> {
  const summaries = await versionSummaries(
    organizationId,
    [template.id],
    executor
  )
  return templateView(template, summaries.get(template.id) ?? [])
}

async function findDraft(
  organizationId: string,
  templateId: string,
  executor: DbExecutor = db
): Promise<VersionRow | null> {
  const [row] = await executor
    .select()
    .from(versions)
    .where(
      and(
        versionScope(organizationId, templateId),
        eq(versions.status, 'draft')
      )
    )
    .limit(1)
  return row ?? null
}

/** The highest-numbered non-draft version, whatever its status. */
async function latestVersion(
  organizationId: string,
  templateId: string,
  executor: DbExecutor = db
): Promise<ReleasedVersionRow | null> {
  const [row] = await executor
    .select()
    .from(versions)
    .where(
      and(
        versionScope(organizationId, templateId),
        ne(versions.status, 'draft')
      )
    )
    .orderBy(desc(versions.major), desc(versions.minor))
    .limit(1)
  return row && isReleased(row) ? row : null
}

/** Whether a version was ever published (they are never deleted). */
async function hasReleasedVersion(
  organizationId: string,
  templateId: string,
  executor: DbExecutor
): Promise<boolean> {
  const [row] = await executor
    .select({ id: versions.id })
    .from(versions)
    .where(
      and(
        versionScope(organizationId, templateId),
        ne(versions.status, 'draft')
      )
    )
    .limit(1)
  return row !== undefined
}

async function findVersion(
  organizationId: string,
  templateId: string,
  versionId: string,
  executor: DbExecutor = db
): Promise<ReleasedVersionRow | null> {
  const [row] = await executor
    .select()
    .from(versions)
    .where(
      and(
        versionScope(organizationId, templateId),
        versionIdIs(versionId),
        ne(versions.status, 'draft')
      )
    )
    .limit(1)
  return row && isReleased(row) ? row : null
}

// ── Definitions ──────────────────────────────────────────────────────────

/** An empty definition: what a blank template starts with. */
export const blankDefinition = (kind: TemplateKind): TemplateDefinition =>
  templateDefinitionSchema.parse({ kind, input: { fields: [] }, decisions: [] })

const definitionBytes = (definition: TemplateDefinition) =>
  new TextEncoder().encode(JSON.stringify(definition)).byteLength

function assertDefinitionSize(definition: TemplateDefinition, path: string) {
  const bytes = definitionBytes(definition)
  if (bytes > DEFINITION_LIMITS.bytes) {
    throw validationFailed([
      {
        path,
        message: `The definition takes ${Math.ceil(bytes / 1024)} KiB; the limit is ${DEFINITION_LIMITS.bytes / 1024} KiB`,
        code: 'too_big'
      }
    ])
  }
}

const prefixed = (prefix: string, path: PropertyKey[]) =>
  [prefix, ...path.map(String)].join('.')

/**
 * Runs a wizard, turning its `RangeError` (a threshold out of range) and
 * `ZodError` (an invalid name) into a 422 in the public format.
 */
function runWizard(
  build: () => TemplateDefinition,
  rangePath: (message: string) => string
): TemplateDefinition {
  try {
    return build()
  } catch (error) {
    if (error instanceof RangeError) {
      throw validationFailed([
        {
          path: rangePath(error.message),
          message: error.message,
          code: 'out_of_range'
        }
      ])
    }
    if (error instanceof z.ZodError) {
      throw validationFailed(
        error.issues.map(issue => ({
          path: prefixed('definition', issue.path),
          message: issue.message,
          code: issue.code
        }))
      )
    }
    throw error
  }
}

/** The definition a new template starts from, and the slug its source suggests. */
function definitionFromSource(source: TemplateSource): {
  definition: TemplateDefinition
  slug?: string
} {
  switch (source.type) {
    case 'blank':
      return { definition: blankDefinition(source.kind) }
    case 'gallery': {
      const template = galleryTemplate(source.id)
      if (!template) {
        throw validationFailed([
          {
            path: 'source.id',
            message: 'Unknown gallery template',
            code: 'custom'
          }
        ])
      }
      return { definition: template.definition, slug: template.slug }
    }
    case 'classify':
      return {
        definition: runWizard(
          () =>
            classifyDefinition({
              fields: source.fields,
              instructions: source.instructions,
              labels: source.labels,
              minConfidence: source.minConfidence,
              questionId: source.questionId
            }),
          () => 'source.minConfidence'
        )
      }
    case 'decide':
      return {
        definition: runWizard(
          () =>
            decideDefinition({
              fields: source.fields,
              instructions: source.instructions,
              yes: source.yes,
              no: source.no,
              yesThreshold: source.yesThreshold,
              noThreshold: source.noThreshold,
              questionId: source.questionId
            }),
          message =>
            message.startsWith('noThreshold')
              ? 'source.noThreshold'
              : 'source.yesThreshold'
        )
      }
    case 'score':
      return {
        definition: runWizard(
          () =>
            scoreDefinition({
              fields: source.fields,
              instructions: source.instructions,
              levels: source.levels,
              minConfidence: source.minConfidence,
              questionId: source.questionId
            }),
          () => 'source.minConfidence'
        )
      }
    case 'definition':
      return { definition: source.definition }
  }
}

// ── Drafts ───────────────────────────────────────────────────────────────

const warningsFor = (capabilities: EvaluatorCapabilities): TemplateWarning[] =>
  capabilities.versionedModels ? [] : ['MODEL_UNPINNED']

const lintFor = (
  definition: TemplateDefinition,
  capabilities: EvaluatorCapabilities
): LintIssue[] =>
  lintDefinition(definition, {
    maxContextTokens: capabilities.maxContextTokens
  })

/** The draft with its lint, and its diff against the latest version. */
export async function draftViewOf(
  organizationId: string,
  draft: VersionRow,
  executor: DbExecutor = db
): Promise<DraftView> {
  const latest = await latestVersion(organizationId, draft.templateId, executor)
  const { capabilities } = getEvaluator()
  return draftView({
    draft,
    latest,
    lint: lintFor(draft.definition, capabilities),
    changes: latest ? diffDefinitions(latest.definition, draft.definition) : [],
    warnings: warningsFor(capabilities)
  })
}

// ── Lint ─────────────────────────────────────────────────────────────────

export const lintRequestSchema = withoutNul(
  z.object({
    definition: templateDefinitionSchema,
    /**
     * Also diff `definition` against this template's latest published
     * version (the same diff a draft shows), without writing anything.
     */
    templateId: z.string().optional()
  })
)

export type LintRequestBody = z.output<typeof lintRequestSchema>

export interface LintResult {
  lint: LintIssue[]
  /** Present only when the request named a `templateId`. */
  changes?: DefinitionChange[]
}

/**
 * Lints `definition` without saving it, so the visual editor can validate as
 * the author types instead of writing a draft on every keystroke. With
 * `templateId`, also returns the diff against that template's latest
 * published version; 404 for a template of another organization.
 */
export async function lintTemplateDefinition(
  organizationId: string,
  body: LintRequestBody
): Promise<LintResult> {
  const { capabilities } = getEvaluator()
  const lint = lintFor(body.definition, capabilities)
  if (body.templateId === undefined) return { lint }

  await getTemplate(organizationId, body.templateId)
  const latest = await latestVersion(organizationId, body.templateId)
  return {
    lint,
    changes: latest ? diffDefinitions(latest.definition, body.definition) : []
  }
}

export interface LoadDraftOptions {
  executor?: DbExecutor
  /** Recorded as the creator when the draft has to be created. */
  userId?: string | null
}

/**
 * The template's draft. A template has none right after a publish (the draft
 * row became the version); then one is created, copying the latest
 * version's definition (or blank, for a template that never had any).
 * Race-safe: concurrent callers converge on the same row through the
 * one-draft-per-template partial unique index. 404 for a template of
 * another organization.
 */
export async function loadDraft(
  organizationId: string,
  templateId: string,
  options: LoadDraftOptions = {}
): Promise<VersionRow> {
  const executor = options.executor ?? db

  // A concurrent publish can turn the draft we just lost the race to into a
  // version; each retry then copies that new version.
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await findDraft(organizationId, templateId, executor)
    if (existing) return existing

    const template = await getTemplate(organizationId, templateId, executor)
    const latest = await latestVersion(organizationId, templateId, executor)
    const definition = latest?.definition ?? blankDefinition(template.kind)
    const now = new Date()

    const [created] = await executor
      .insert(versions)
      .values({
        id: Id.generate(),
        organizationId,
        templateId,
        status: 'draft',
        definition,
        definitionHash: hashJson(definition),
        modelRef: definition.model,
        createdBy: options.userId ?? null,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoNothing({
        target: versions.templateId,
        where: sql`status = 'draft'`
      })
      .returning()
    if (created) return created
  }
  throw new Error(`Could not load the draft of template ${templateId}`)
}

// ── Templates ────────────────────────────────────────────────────────────

export async function listTemplates(
  organizationId: string,
  status: TemplateStatusFilter
): Promise<TemplateView[]> {
  const rows = await db
    .select()
    .from(templates)
    .where(
      and(
        eq(templates.organizationId, organizationId),
        status === 'all' ? undefined : eq(templates.status, status)
      )
    )
    .orderBy(desc(templates.updatedAt), desc(templates.id))

  const summaries = await versionSummaries(
    organizationId,
    rows.map(row => row.id)
  )
  return rows.map(row => templateView(row, summaries.get(row.id) ?? []))
}

export async function getTemplateView(
  organizationId: string,
  id: string
): Promise<TemplateView> {
  return viewOf(organizationId, await getTemplate(organizationId, id))
}

async function assertSlugAvailable(
  organizationId: string,
  slug: string,
  executor: DbExecutor,
  exceptId?: string
) {
  const [taken] = await executor
    .select({ id: templates.id })
    .from(templates)
    .where(
      and(
        eq(templates.organizationId, organizationId),
        eq(templates.slug, slug),
        exceptId === undefined ? undefined : ne(templates.id, exceptId)
      )
    )
    .limit(1)
  if (taken) throw slugTaken(slug)
}

export interface Caller {
  organizationId: string
  userId: string
}

/** A new template and its first draft, from a blank, gallery, wizard or raw definition. */
export async function createTemplate(
  { organizationId, userId }: Caller,
  body: CreateTemplateBody
): Promise<{ template: TemplateView; draft: DraftView }> {
  const source = definitionFromSource(body.source)
  const { definition } = source
  assertDefinitionSize(
    definition,
    body.source.type === 'definition' ? 'source.definition' : 'source'
  )
  const slug = body.slug ?? source.slug ?? slugify(body.name)
  await assertSlugAvailable(organizationId, slug, db)

  const now = new Date()
  let created: { template: TemplateRow; draft: VersionRow }
  try {
    created = await db.transaction(async tx => {
      const [template] = await tx
        .insert(templates)
        .values({
          id: Id.generate(),
          organizationId,
          slug,
          name: body.name,
          description: body.description ?? null,
          kind: definition.kind,
          storeInput: body.storeInput ?? 'full',
          retentionDays: body.retentionDays ?? null,
          createdBy: userId,
          createdAt: now,
          updatedAt: now
        })
        .returning()
      if (!template) throw new Error('Template insert returned no row')

      const [draft] = await tx
        .insert(versions)
        .values({
          id: Id.generate(),
          organizationId,
          templateId: template.id,
          status: 'draft',
          definition,
          definitionHash: hashJson(definition),
          modelRef: definition.model,
          createdBy: userId,
          createdAt: now,
          updatedAt: now
        })
        .returning()
      if (!draft) throw new Error('Draft insert returned no row')
      return { template, draft }
    })
  } catch (error) {
    if (isUniqueViolation(error, SLUG_INDEX)) throw slugTaken(slug)
    throw error
  }

  return {
    template: templateView(created.template, [created.draft]),
    draft: await draftViewOf(organizationId, created.draft)
  }
}

/** Edits a template's settings; the slug is frozen once a version was published. */
export async function updateTemplate(
  organizationId: string,
  id: string,
  body: UpdateTemplateBody
): Promise<TemplateView> {
  const set: Partial<typeof templates.$inferInsert> = {}
  if (body.name !== undefined) set.name = body.name
  if (body.description !== undefined) set.description = body.description
  if (body.storeInput !== undefined) set.storeInput = body.storeInput
  if (body.retentionDays !== undefined) set.retentionDays = body.retentionDays

  try {
    return await db.transaction(async tx => {
      // Locked like a publish, so the slug can't change while one runs.
      const template = await lockTemplate(organizationId, id, tx)

      if (body.slug !== undefined && body.slug !== template.slug) {
        if (await hasReleasedVersion(organizationId, id, tx)) {
          throw new ApiError(
            409,
            'SLUG_LOCKED',
            'The slug cannot change once a version has been published: callers reference it'
          )
        }
        await assertSlugAvailable(organizationId, body.slug, tx, id)
        set.slug = body.slug
      }

      if (Object.keys(set).length === 0) {
        return viewOf(organizationId, template, tx)
      }
      const [updated] = await tx
        .update(templates)
        .set(set)
        .where(templateScope(organizationId, id))
        .returning()
      if (!updated) throw templateNotFound()
      return viewOf(organizationId, updated, tx)
    })
  } catch (error) {
    if (body.slug !== undefined && isUniqueViolation(error, SLUG_INDEX)) {
      throw slugTaken(body.slug)
    }
    throw error
  }
}

/** Archives (`archived`) or restores (`active`) a template. */
export async function setTemplateStatus(
  organizationId: string,
  id: string,
  status: TemplateRow['status']
): Promise<TemplateView> {
  const [updated] = await db
    .update(templates)
    .set({ status })
    .where(templateScope(organizationId, id))
    .returning()
  if (!updated) throw templateNotFound()
  return viewOf(organizationId, updated)
}

// ── Draft editing ────────────────────────────────────────────────────────

export async function getDraft(
  organizationId: string,
  templateId: string,
  userId: string
): Promise<DraftView> {
  const draft = await loadDraft(organizationId, templateId, { userId })
  return draftViewOf(organizationId, draft)
}

export interface SaveDraftOptions extends Caller {
  templateId: string
  /** The `definitionHash` the editor started from (`If-Match`). */
  ifMatch: string
  definition: TemplateDefinition
}

/**
 * Replaces the draft's definition if it still has the hash the editor
 * loaded (compare-and-set), else 409 `DRAFT_CONFLICT` with the current hash.
 * Lint errors don't prevent saving; they only block publishing. Holds the
 * template's row lock, so it serializes with publishes.
 */
export async function saveDraft({
  organizationId,
  userId,
  templateId,
  ifMatch,
  definition
}: SaveDraftOptions): Promise<DraftView> {
  assertDefinitionSize(definition, 'definition')
  const draft = await loadDraft(organizationId, templateId, { userId })
  const now = new Date()

  const saved = await db.transaction(async tx => {
    // The template's row lock first, like a publish: taking the draft row
    // first and the template's second would deadlock against one.
    await lockTemplate(organizationId, templateId, tx)
    const [row] = await tx
      .update(versions)
      .set({
        definition,
        definitionHash: hashJson(definition),
        modelRef: definition.model,
        updatedAt: now
      })
      .where(
        and(
          eq(versions.id, draft.id),
          eq(versions.organizationId, organizationId),
          eq(versions.status, 'draft'),
          eq(versions.definitionHash, ifMatch)
        )
      )
      .returning()
    if (!row) return null

    await tx
      .update(templates)
      .set({ kind: definition.kind, updatedAt: now })
      .where(templateScope(organizationId, templateId))
    return row
  })

  if (!saved) {
    // Reloaded (not `draft`): a publish may have consumed it meanwhile.
    const current = await loadDraft(organizationId, templateId, { userId })
    throw draftConflict(current.definitionHash)
  }
  return draftViewOf(organizationId, saved)
}

// ── Publishing ───────────────────────────────────────────────────────────

export interface PublishResult {
  version: VersionView
  changes: DefinitionChange[]
  warnings: TemplateWarning[]
  /** Only on publishing a new major: bindings the new major leaves stale. */
  effectWarnings?: EffectWarning[]
}

/**
 * Freezes the draft into the next version, in one transaction holding the
 * template's row lock (so concurrent publishes and saves serialize: a
 * second publish finds no draft, a save's new hash is a conflict). Refuses a stale `expectedDraftHash`, lint errors, a draft
 * identical to the latest version, and breaking changes outside a major.
 */
export async function publishDraft(
  { organizationId, userId }: Caller,
  templateId: string,
  body: PublishBody
): Promise<PublishResult> {
  const { capabilities } = getEvaluator()

  try {
    const { version, changes, previousMajor } = await db.transaction(
      async tx => {
        const template = await lockTemplate(organizationId, templateId, tx)
        if (template.status === 'archived') {
          throw new ApiError(
            410,
            'TEMPLATE_ARCHIVED',
            'The template is archived; restore it before publishing'
          )
        }

        const draft = await findDraft(organizationId, templateId, tx)
        if (!draft) {
          throw new ApiError(409, 'NO_DRAFT', 'There is no draft to publish')
        }
        if (draft.definitionHash !== body.expectedDraftHash) {
          throw draftConflict(draft.definitionHash)
        }

        const lint = lintFor(draft.definition, capabilities)
        if (hasLintErrors(lint)) {
          throw new ApiError(
            422,
            'LINT_FAILED',
            'Fix the errors in the draft before publishing it',
            { details: { issues: lint } }
          )
        }

        const latest = await latestVersion(organizationId, templateId, tx)
        if (latest && latest.definitionHash === draft.definitionHash) {
          throw new ApiError(
            409,
            'NO_CHANGES',
            `The draft is identical to version ${formatVersion(latest)}`,
            { details: { version: formatVersion(latest) } }
          )
        }

        const changes = latest
          ? diffDefinitions(latest.definition, draft.definition)
          : []
        const breaking = breakingChanges(changes)
        if (breaking.length > 0 && !body.major) {
          throw new ApiError(
            422,
            'BREAKING_CHANGES',
            'The draft has breaking changes; publish it as a new major version',
            { details: { changes: breaking } }
          )
        }

        const number = nextVersion(latest, { major: body.major ?? false })
        const now = new Date()
        const [published] = await tx
          .update(versions)
          .set({
            status: 'published',
            major: number.major,
            minor: number.minor,
            inputJsonSchema: inputJsonSchema(draft.definition.input.fields),
            publishedAt: now,
            publishedBy: userId,
            changelog: body.changelog?.trim() || null,
            updatedAt: now
          })
          .where(
            and(
              eq(versions.id, draft.id),
              eq(versions.organizationId, organizationId),
              eq(versions.status, 'draft'),
              eq(versions.definitionHash, body.expectedDraftHash)
            )
          )
          .returning()
        // Defense in depth: saves hold the template lock too, so the draft
        // can't change between the read above and this update.
        if (!published || !isReleased(published)) {
          const current = await findDraft(organizationId, templateId, tx)
          throw draftConflict(current?.definitionHash ?? null)
        }

        await tx
          .update(templates)
          .set({ updatedAt: now })
          .where(templateScope(organizationId, templateId))
        return {
          version: published,
          changes,
          previousMajor: latest?.major ?? null
        }
      }
    )

    // Only on a new major: bindings pinned to the major it supersedes, or
    // whose label no longer exists, are now stale; new labels may be unbound.
    let effectWarnings: EffectWarning[] | undefined
    if (body.major) {
      const bindings = await db
        .select()
        .from(effectBindings)
        .where(
          and(
            eq(effectBindings.organizationId, organizationId),
            eq(effectBindings.templateId, templateId)
          )
        )
      effectWarnings = effectWarningsFor({
        bindings,
        labels: decisionLabels(version.definition),
        major: version.major,
        ...(previousMajor === null ? {} : { previousMajor })
      })
    }

    return {
      version: versionView(version),
      changes,
      warnings: warningsFor(capabilities),
      ...(effectWarnings ? { effectWarnings } : {})
    }
  } catch (error) {
    // Defense in depth: the row lock should make these unreachable.
    if (
      isUniqueViolation(error, NUMBER_INDEX) ||
      isUniqueViolation(error, DRAFT_INDEX)
    ) {
      throw new ApiError(
        409,
        'DRAFT_CONFLICT',
        'Another publish of this template happened at the same time'
      )
    }
    throw error
  }
}

// ── Versions ─────────────────────────────────────────────────────────────

/** Released versions, highest number first. */
export async function listVersions(
  organizationId: string,
  templateId: string
): Promise<VersionView[]> {
  await getTemplate(organizationId, templateId)
  const rows = await db
    .select()
    .from(versions)
    .where(
      and(
        versionScope(organizationId, templateId),
        ne(versions.status, 'draft')
      )
    )
    .orderBy(desc(versions.major), desc(versions.minor))
  return rows.filter(isReleased).map(versionView)
}

export async function getVersion(
  organizationId: string,
  templateId: string,
  versionId: string
): Promise<VersionDetailView> {
  const row = await findVersion(organizationId, templateId, versionId)
  if (!row) throw versionNotFound()
  return versionDetailView(row)
}

/**
 * `published` → `deprecated` (still resolvable by exact ref, with a
 * `Deprecation` header), or back. Any other status is a 409.
 */
export async function setVersionDeprecated(
  organizationId: string,
  templateId: string,
  versionId: string,
  deprecated: boolean
): Promise<VersionView> {
  const [from, to] = deprecated
    ? (['published', 'deprecated'] as const)
    : (['deprecated', 'published'] as const)

  const [updated] = await db
    .update(versions)
    .set({ status: to, deprecatedAt: deprecated ? new Date() : null })
    .where(
      and(
        versionScope(organizationId, templateId),
        versionIdIs(versionId),
        eq(versions.status, from)
      )
    )
    .returning()
  if (updated && isReleased(updated)) return versionView(updated)

  const existing = await findVersion(organizationId, templateId, versionId)
  if (!existing) throw versionNotFound()
  throw deprecated
    ? new ApiError(
        409,
        'VERSION_NOT_PUBLISHED',
        `Only a published version can be deprecated (this one is ${existing.status})`,
        { details: { status: existing.status } }
      )
    : new ApiError(
        409,
        'VERSION_NOT_DEPRECATED',
        `Only a deprecated version can be undeprecated (this one is ${existing.status})`,
        { details: { status: existing.status } }
      )
}
