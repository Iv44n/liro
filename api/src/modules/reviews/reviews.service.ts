import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  lt,
  type SQL,
  sql
} from 'drizzle-orm'
import z from 'zod'
import { users } from '#modules/auth/auth.schemas'
import { enqueueEffects } from '#modules/effects/dispatcher'
import { buildEffectPayload } from '#modules/effects/payload'
import type { ReviewRow, RunRow } from '#modules/engine/executor'
import { decisionRuns } from '#modules/runs/runs.schemas'
import type { TemplateDefinition } from '#modules/templates/definition'
import {
  decisionTemplates,
  decisionTemplateVersions
} from '#modules/templates/templates.schemas'
import { db } from '#shared/db/config'
import { ApiError } from '#shared/http/errors'
import { REVIEW_STATUSES, reviewTasks } from './reviews.schemas'
import { type ReviewRecord, type ReviewView, reviewView } from './reviews.views'

/**
 * The human review inbox. Every query is scoped to one organization; a
 * review only leaves `pending` through one guarded `UPDATE … WHERE status =
 * 'pending'`, so concurrent reviewers can't both close it.
 */

type Database = typeof db
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]
type Queryable = Database | Transaction

export const REVIEWS_PAGE_LIMIT = { default: 50, max: 100 } as const
export const REVIEW_COMMENT_MAX_LENGTH = 2_000

/**
 * Postgres `text` can't hold NUL (`\u0000`): a query that carries one fails
 * outright, which would surface as a 500. Every client string that reaches
 * SQL is checked first — a 422 for query and body fields, a 404 for ids.
 */
const hasNul = (value: string) => value.includes('\u0000')
const noNul = (value: string) => !hasNul(value)
const NUL_MESSAGE = 'Must not contain NUL characters'

/** `all` lists every status. */
export const REVIEW_LIST_STATUSES = [...REVIEW_STATUSES, 'all'] as const
export type ReviewListStatus = (typeof REVIEW_LIST_STATUSES)[number]

export const listReviewsQuerySchema = z.object({
  status: z.enum(REVIEW_LIST_STATUSES).default('pending'),
  templateId: z.string().min(1).max(64).refine(noNul, NUL_MESSAGE).optional(),
  cursor: z.string().min(1).max(64).refine(noNul, NUL_MESSAGE).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(REVIEWS_PAGE_LIMIT.max)
    .default(REVIEWS_PAGE_LIMIT.default)
})

export type ListReviewsQuery = z.output<typeof listReviewsQuerySchema>

/** Blank comments are stored as `null`. */
const commentSchema = z
  .string()
  .trim()
  .max(REVIEW_COMMENT_MAX_LENGTH)
  .refine(noNul, NUL_MESSAGE)
  .nullish()
  .transform(comment => comment || null)

/** Whether `decision` is allowed is checked against the review (422 `INVALID_DECISION`). */
export const resolveReviewSchema = z.object({
  decision: z.string().min(1).max(255).refine(noNul, NUL_MESSAGE),
  comment: commentSchema
})

export const dismissReviewSchema = z.object({ comment: commentSchema })

export type ResolveReviewInput = z.output<typeof resolveReviewSchema>
export type DismissReviewInput = z.output<typeof dismissReviewSchema>

// ── Reads ────────────────────────────────────────────────────────────────

/**
 * Reviews matching `where` (which must scope the organization), with their
 * run, template, version and resolver. Version definitions are loaded once
 * per distinct version, not once per review.
 */
async function loadReviews(
  executor: Queryable,
  organizationId: string,
  where: SQL | undefined,
  options: { orderBy: SQL; limit: number }
): Promise<ReviewRecord[]> {
  const rows = await executor
    .select({
      review: reviewTasks,
      run: decisionRuns,
      templateSlug: decisionTemplates.slug,
      templateName: decisionTemplates.name,
      major: decisionTemplateVersions.major,
      minor: decisionTemplateVersions.minor,
      resolverId: users.id,
      resolverName: users.name
    })
    .from(reviewTasks)
    .innerJoin(
      decisionRuns,
      and(
        eq(decisionRuns.id, reviewTasks.runId),
        eq(decisionRuns.organizationId, reviewTasks.organizationId)
      )
    )
    .innerJoin(
      decisionTemplates,
      and(
        eq(decisionTemplates.id, reviewTasks.templateId),
        eq(decisionTemplates.organizationId, reviewTasks.organizationId)
      )
    )
    .innerJoin(
      decisionTemplateVersions,
      eq(decisionTemplateVersions.id, decisionRuns.versionId)
    )
    .leftJoin(users, eq(users.id, reviewTasks.resolvedBy))
    .where(where)
    .orderBy(options.orderBy)
    .limit(options.limit)
  if (rows.length === 0) return []

  const versionIds = [
    ...new Set(
      rows.filter(row => !row.run.definition).map(row => row.run.versionId)
    )
  ]
  const definitions = new Map<string, TemplateDefinition>()
  if (versionIds.length > 0) {
    const versions = await executor
      .select({
        id: decisionTemplateVersions.id,
        definition: decisionTemplateVersions.definition
      })
      .from(decisionTemplateVersions)
      .where(
        and(
          eq(decisionTemplateVersions.organizationId, organizationId),
          inArray(decisionTemplateVersions.id, versionIds)
        )
      )
    for (const version of versions) {
      definitions.set(version.id, version.definition)
    }
  }

  return rows.map(row => ({
    review: row.review,
    run: row.run,
    template: {
      id: row.review.templateId,
      slug: row.templateSlug,
      name: row.templateName
    },
    version: { major: row.major, minor: row.minor },
    definition:
      row.run.definition ?? definitions.get(row.run.versionId) ?? null,
    resolver:
      row.resolverId === null
        ? null
        : { id: row.resolverId, name: row.resolverName ?? '' }
  }))
}

const notFound = () => new ApiError(404, 'NOT_FOUND', 'Review not found')

/** An id with a NUL can't name a stored review (and can't be queried). */
function assertQueryableId(id: string): void {
  if (hasNul(id)) throw notFound()
}

/** `GET /api/reviews/:id` (404 outside the caller's organization). */
export async function getReview(
  organizationId: string,
  id: string,
  executor: Queryable = db
): Promise<ReviewView> {
  assertQueryableId(id)
  const [record] = await loadReviews(
    executor,
    organizationId,
    and(eq(reviewTasks.id, id), eq(reviewTasks.organizationId, organizationId)),
    { orderBy: asc(reviewTasks.id), limit: 1 }
  )
  if (!record) throw notFound()
  return reviewView(record)
}

export interface ReviewPage {
  data: ReviewView[]
  /** Pass as `cursor` for the next page; `null` on the last one. */
  nextCursor: string | null
}

/**
 * `GET /api/reviews`. `pending` is a work queue, so it is oldest first (the
 * review that has waited longest comes first); every other status, and
 * `all`, is newest first. Both orders are by creation (UUIDv7 ids) and
 * paginate by id.
 */
export async function listReviews(
  organizationId: string,
  query: ListReviewsQuery
): Promise<ReviewPage> {
  const oldestFirst = query.status === 'pending'
  const conditions: SQL[] = [eq(reviewTasks.organizationId, organizationId)]
  if (query.status !== 'all') {
    conditions.push(eq(reviewTasks.status, query.status))
  }
  if (query.templateId) {
    conditions.push(eq(reviewTasks.templateId, query.templateId))
  }
  if (query.cursor) {
    conditions.push(
      oldestFirst
        ? gt(reviewTasks.id, query.cursor)
        : lt(reviewTasks.id, query.cursor)
    )
  }

  const records = await loadReviews(db, organizationId, and(...conditions), {
    orderBy: oldestFirst ? asc(reviewTasks.id) : desc(reviewTasks.id),
    limit: query.limit + 1
  })
  const page = records.slice(0, query.limit)
  return {
    data: page.map(reviewView),
    nextCursor:
      records.length > query.limit ? (page.at(-1)?.review.id ?? null) : null
  }
}

/** `GET /api/reviews/stats`: the inbox badge. */
export async function reviewStats(
  organizationId: string
): Promise<{ pending: number }> {
  const [row] = await db
    .select({ pending: count() })
    .from(reviewTasks)
    .where(
      and(
        eq(reviewTasks.organizationId, organizationId),
        eq(reviewTasks.status, 'pending')
      )
    )
  return { pending: row?.pending ?? 0 }
}

// ── Transitions ──────────────────────────────────────────────────────────

/**
 * Why a guarded transition matched no row: the review isn't in the
 * organization (404), the decision isn't one of its allowed ones (422), or
 * it was already closed (409).
 */
async function transitionError(
  executor: Queryable,
  organizationId: string,
  id: string,
  decision?: string
): Promise<ApiError> {
  const review = await executor.query.reviewTasks.findFirst({
    where: { id, organizationId },
    columns: { status: true, allowedDecisions: true }
  })
  if (!review) return notFound()
  if (decision !== undefined && !review.allowedDecisions.includes(decision)) {
    return new ApiError(
      422,
      'INVALID_DECISION',
      'The decision is not one of the allowed decisions of this review',
      { details: { decision, allowedDecisions: review.allowedDecisions } }
    )
  }
  return new ApiError(
    409,
    'REVIEW_NOT_PENDING',
    'This review is no longer pending',
    { details: { status: review.status } }
  )
}

/**
 * `POST /api/reviews/:id/resolve`: closes a pending review with one of its
 * allowed decisions and sets the run's `finalDecision`, in one transaction.
 * The `UPDATE` checks the status and the decision itself, so of two
 * concurrent resolves exactly one wins; the other gets 409.
 */
export async function resolveReview(
  organizationId: string,
  id: string,
  userId: string,
  input: ResolveReviewInput
): Promise<ReviewView> {
  assertQueryableId(id)
  const { decision, comment } = input
  const now = new Date()
  return db.transaction(async tx => {
    const [resolved] = await tx
      .update(reviewTasks)
      .set({
        status: 'resolved',
        resolvedDecision: decision,
        resolvedBy: userId,
        resolvedAt: now,
        comment
      })
      .where(
        and(
          eq(reviewTasks.id, id),
          eq(reviewTasks.organizationId, organizationId),
          eq(reviewTasks.status, 'pending'),
          sql`${decision} = any(${reviewTasks.allowedDecisions})`
        )
      )
      .returning()
    if (!resolved) {
      throw await transitionError(tx, organizationId, id, decision)
    }

    const [run] = await tx
      .update(decisionRuns)
      .set({ finalDecision: decision })
      .where(
        and(
          eq(decisionRuns.id, resolved.runId),
          eq(decisionRuns.organizationId, organizationId)
        )
      )
      .returning()
    if (!run) {
      throw new Error(
        `Resolved review ${id} points to a missing run ${resolved.runId}`
      )
    }

    await enqueueReviewedEffects(
      tx,
      organizationId,
      run,
      resolved,
      decision,
      now
    )

    return getReview(organizationId, id, tx)
  })
}

/**
 * Fires `decision.reviewed` (label = the resolved decision) in the review's
 * own transaction — the transactional outbox, same as the run's own
 * `decision.made`/`decision.review_requested` (see `engine/executor.ts`).
 * `enqueueEffects` itself skips test-mode runs, so a review of a test-mode
 * run (created before this endpoint existed, or via a test key) enqueues
 * nothing here either.
 */
async function enqueueReviewedEffects(
  tx: Transaction,
  organizationId: string,
  run: RunRow,
  review: ReviewRow,
  decision: string,
  now: Date
): Promise<void> {
  const [info] = await tx
    .select({
      templateSlug: decisionTemplates.slug,
      templateName: decisionTemplates.name,
      major: decisionTemplateVersions.major,
      minor: decisionTemplateVersions.minor
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
    .where(
      and(
        eq(decisionRuns.id, run.id),
        eq(decisionRuns.organizationId, organizationId)
      )
    )
    .limit(1)
  // Defense in depth: the run's own template/version rows always exist
  // (both are cascade-referenced), so this can't actually happen.
  if (!info) return

  await enqueueEffects(tx, {
    organizationId,
    runId: run.id,
    templateId: run.templateId,
    major: info.major,
    mode: run.mode,
    event: 'decision.reviewed',
    label: decision,
    now,
    payloadFor: binding =>
      buildEffectPayload({
        event: 'decision.reviewed',
        now,
        run,
        context: {
          templateSlug: info.templateSlug,
          templateName: info.templateName,
          major: info.major,
          minor: info.minor
        },
        review,
        includeInput: binding.includeInput
      })
  })
}

/**
 * `POST /api/reviews/:id/dismiss`: closes a pending review without a
 * decision — the run's `finalDecision` stays `null`. `resolvedBy`/`resolvedAt`
 * record who dismissed it and when.
 */
export async function dismissReview(
  organizationId: string,
  id: string,
  userId: string,
  input: DismissReviewInput
): Promise<ReviewView> {
  assertQueryableId(id)
  const [dismissed] = await db
    .update(reviewTasks)
    .set({
      status: 'dismissed',
      resolvedBy: userId,
      resolvedAt: new Date(),
      comment: input.comment
    })
    .where(
      and(
        eq(reviewTasks.id, id),
        eq(reviewTasks.organizationId, organizationId),
        eq(reviewTasks.status, 'pending')
      )
    )
    .returning({ id: reviewTasks.id })
  if (!dismissed) throw await transitionError(db, organizationId, id)

  return getReview(organizationId, id)
}
