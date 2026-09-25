import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  type SQL
} from 'drizzle-orm'
import type { ReviewRow, RunRow } from '#modules/engine/executor'
import {
  type ReviewStatus,
  reviewTasks
} from '#modules/reviews/reviews.schemas'
import {
  decisionTemplates,
  decisionTemplateVersions,
  type VersionStatus
} from '#modules/templates/templates.schemas'
import { compareVersions } from '#modules/templates/versioning'
import { db } from '#shared/db/config'
import { ApiError } from '#shared/http/errors'
import type { TemplateRow, VersionRow } from './resolve'
import {
  decisionRuns,
  type RunMode,
  type RunSource,
  type RunStatus
} from './runs.schemas'
import {
  type DecisionSummaryView,
  decisionSummaryView,
  type PublicRunView,
  publicRunView,
  type RunContext,
  type RunDetailView,
  type RunSummaryView,
  runDetailView,
  runSummaryView
} from './runs.views'

/** Reads of stored runs, always scoped to one organization. */

export interface RunRecord {
  run: RunRow
  context: RunContext
  review: ReviewRow | null
  /** The run's version status now (e.g. deprecated since the run). */
  versionStatus: VersionStatus
}

/**
 * Postgres `text` can't hold NUL (`\u0000`): a query carrying one fails
 * outright (a 500), so such an id simply names no run.
 */
const isQueryableId = (id: string) => !id.includes('\u0000')

/** A run of the organization with its template, version and review; `null` if there is none. */
export async function findRun(
  organizationId: string,
  id: string
): Promise<RunRecord | null> {
  if (!isQueryableId(id)) return null
  const [row] = await db
    .select({
      run: decisionRuns,
      templateSlug: decisionTemplates.slug,
      templateName: decisionTemplates.name,
      major: decisionTemplateVersions.major,
      minor: decisionTemplateVersions.minor,
      versionStatus: decisionTemplateVersions.status,
      review: reviewTasks
    })
    .from(decisionRuns)
    .innerJoin(
      decisionTemplates,
      eq(decisionTemplates.id, decisionRuns.templateId)
    )
    .innerJoin(
      decisionTemplateVersions,
      eq(decisionTemplateVersions.id, decisionRuns.versionId)
    )
    .leftJoin(reviewTasks, eq(reviewTasks.runId, decisionRuns.id))
    .where(
      and(
        eq(decisionRuns.id, id),
        eq(decisionRuns.organizationId, organizationId)
      )
    )
    .limit(1)
  if (!row) return null

  const { run, review, versionStatus, ...context } = row
  return { run, context, review, versionStatus }
}

async function getRun(organizationId: string, id: string): Promise<RunRecord> {
  const record = await findRun(organizationId, id)
  if (!record) throw new ApiError(404, 'NOT_FOUND', 'Run not found')
  return record
}

/** `GET /v1/runs/:id` (404 outside the caller's organization). */
export async function getPublicRun(
  organizationId: string,
  id: string
): Promise<PublicRunView> {
  const { run, context, review } = await getRun(organizationId, id)
  return publicRunView(run, context, review)
}

export interface ReplayedRun {
  view: PublicRunView
  /** Of the run's own version, as it is now — not of what the ref resolves to today. */
  slug: string
  major: number | null
  deprecated: boolean
}

/** The stored run an `Idempotency-Key` replays, with what its headers need. */
export async function getReplayedRun(
  organizationId: string,
  id: string
): Promise<ReplayedRun> {
  const { run, context, review, versionStatus } = await getRun(
    organizationId,
    id
  )
  return {
    view: publicRunView(run, context, review),
    slug: context.templateSlug,
    major: context.major,
    deprecated: versionStatus === 'deprecated'
  }
}

/** `GET /api/runs/:id` (404 outside the caller's organization). */
export async function getRunDetail(
  organizationId: string,
  id: string
): Promise<RunDetailView> {
  const { run, context, review } = await getRun(organizationId, id)
  return runDetailView(run, context, review)
}

export interface RunFilters {
  templateId?: string
  decision?: string
  mode?: RunMode
  source?: RunSource
  status?: RunStatus
  reviewStatus?: ReviewStatus
  /** Inclusive bounds on `createdAt`. */
  from?: Date
  to?: Date
  /** Exclusive upper bound on `createdAt` (a date-only `to` is the next day's midnight). */
  before?: Date
  /** The last id of the previous page. */
  cursor?: string
  limit: number
}

export interface RunPage {
  data: RunSummaryView[]
  /** Pass as `cursor` for the next page; `null` on the last one. */
  nextCursor: string | null
}

/** Runs newest first (UUIDv7 ids sort by creation), paginated by id. */
export async function listRuns(
  organizationId: string,
  filters: RunFilters
): Promise<RunPage> {
  const conditions: SQL[] = [eq(decisionRuns.organizationId, organizationId)]
  if (filters.templateId) {
    conditions.push(eq(decisionRuns.templateId, filters.templateId))
  }
  if (filters.decision) {
    conditions.push(eq(decisionRuns.decision, filters.decision))
  }
  if (filters.mode) conditions.push(eq(decisionRuns.mode, filters.mode))
  if (filters.source) conditions.push(eq(decisionRuns.source, filters.source))
  if (filters.status) conditions.push(eq(decisionRuns.status, filters.status))
  if (filters.reviewStatus) {
    conditions.push(eq(reviewTasks.status, filters.reviewStatus))
  }
  if (filters.from) conditions.push(gte(decisionRuns.createdAt, filters.from))
  if (filters.to) conditions.push(lte(decisionRuns.createdAt, filters.to))
  if (filters.before) {
    conditions.push(lt(decisionRuns.createdAt, filters.before))
  }
  if (filters.cursor) conditions.push(lt(decisionRuns.id, filters.cursor))

  const rows = await db
    .select({
      id: decisionRuns.id,
      templateId: decisionRuns.templateId,
      templateSlug: decisionTemplates.slug,
      templateName: decisionTemplates.name,
      major: decisionTemplateVersions.major,
      minor: decisionTemplateVersions.minor,
      mode: decisionRuns.mode,
      source: decisionRuns.source,
      status: decisionRuns.status,
      decision: decisionRuns.decision,
      finalDecision: decisionRuns.finalDecision,
      confidence: decisionRuns.confidence,
      flags: decisionRuns.flags,
      reviewStatus: reviewTasks.status,
      latencyMs: decisionRuns.latencyMs,
      createdAt: decisionRuns.createdAt
    })
    .from(decisionRuns)
    .innerJoin(
      decisionTemplates,
      eq(decisionTemplates.id, decisionRuns.templateId)
    )
    .innerJoin(
      decisionTemplateVersions,
      eq(decisionTemplateVersions.id, decisionRuns.versionId)
    )
    .leftJoin(reviewTasks, eq(reviewTasks.runId, decisionRuns.id))
    .where(and(...conditions))
    .orderBy(desc(decisionRuns.id))
    .limit(filters.limit + 1)

  const page = rows.slice(0, filters.limit)
  return {
    data: page.map(runSummaryView),
    nextCursor: rows.length > filters.limit ? (page.at(-1)?.id ?? null) : null
  }
}

// ── Published decisions ─────────────────────────────────────────────────

interface Released {
  id: string
  templateId: string
  major: number
  minor: number
  status: 'published' | 'deprecated'
}

/**
 * The version `/v1/decisions` lists for a template: its highest published
 * one (what a bare ref runs), or — when every version is deprecated — the
 * highest deprecated one.
 */
function listedVersion(
  versions: readonly Released[]
): { version: Released; deprecated: boolean } | null {
  const highest = (status: Released['status']) =>
    versions
      .filter(version => version.status === status)
      .reduce<Released | null>(
        (best, version) =>
          !best || compareVersions(version, best) > 0 ? version : best,
        null
      )
  const published = highest('published')
  if (published) return { version: published, deprecated: false }
  const deprecated = highest('deprecated')
  return deprecated ? { version: deprecated, deprecated: true } : null
}

/** `GET /v1/decisions`: active templates with a runnable version, by slug. */
export async function listPublishedDecisions(
  organizationId: string
): Promise<DecisionSummaryView[]> {
  const templates: TemplateRow[] = await db
    .select()
    .from(decisionTemplates)
    .where(
      and(
        eq(decisionTemplates.organizationId, organizationId),
        eq(decisionTemplates.status, 'active')
      )
    )
    .orderBy(asc(decisionTemplates.slug))
  if (templates.length === 0) return []

  const candidates = await db
    .select({
      id: decisionTemplateVersions.id,
      templateId: decisionTemplateVersions.templateId,
      major: decisionTemplateVersions.major,
      minor: decisionTemplateVersions.minor,
      status: decisionTemplateVersions.status
    })
    .from(decisionTemplateVersions)
    .where(
      and(
        eq(decisionTemplateVersions.organizationId, organizationId),
        inArray(
          decisionTemplateVersions.templateId,
          templates.map(template => template.id)
        ),
        inArray(decisionTemplateVersions.status, ['published', 'deprecated'])
      )
    )

  const byTemplate = new Map<string, Released[]>()
  for (const candidate of candidates) {
    const { major, minor, status } = candidate
    if (major === null || minor === null) continue
    if (status !== 'published' && status !== 'deprecated') continue
    const list = byTemplate.get(candidate.templateId) ?? []
    list.push({ ...candidate, major, minor, status })
    byTemplate.set(candidate.templateId, list)
  }

  const listed = new Map<string, { id: string; deprecated: boolean }>()
  for (const [templateId, versions] of byTemplate) {
    const choice = listedVersion(versions)
    if (choice) {
      listed.set(templateId, {
        id: choice.version.id,
        deprecated: choice.deprecated
      })
    }
  }
  if (listed.size === 0) return []

  const versions: VersionRow[] = await db
    .select()
    .from(decisionTemplateVersions)
    .where(
      and(
        eq(decisionTemplateVersions.organizationId, organizationId),
        inArray(
          decisionTemplateVersions.id,
          [...listed.values()].map(choice => choice.id)
        )
      )
    )
  const versionById = new Map(versions.map(version => [version.id, version]))

  return templates.flatMap(template => {
    const choice = listed.get(template.id)
    const version = choice && versionById.get(choice.id)
    return choice && version
      ? [decisionSummaryView(template, version, choice.deprecated)]
      : []
  })
}
