import { Arcton } from '@arcton/core'
import z from 'zod'
import { NUL_MESSAGE } from '#modules/engine/compiled-cache'
import { REVIEW_STATUSES } from '#modules/reviews/reviews.schemas'
import { withOrgSession } from '#shared/http/session'
import { RUN_MODES, RUN_SOURCES, RUN_STATUSES } from './runs.schemas'
import { getRunDetail, listRuns, type RunFilters } from './runs.service'

export const RUNS_PAGE_LIMIT = { default: 50, max: 100 } as const

const DAY_MS = 24 * 60 * 60 * 1000

const dateTimeSchema = z.iso.datetime({ offset: true })
const dateSchema = z.iso.date()

/** `from`: an ISO date-time with offset, or a date (from its midnight UTC on). */
const fromSchema = z
  .union([dateTimeSchema, dateSchema])
  .transform(value => new Date(value))

/**
 * `to`, inclusive: a date-time is the last instant included; a date includes
 * that whole UTC day, so it becomes an exclusive bound at the next midnight.
 */
const toSchema = z.union([
  dateTimeSchema.transform(value => ({ to: new Date(value) })),
  dateSchema.transform(value => ({
    before: new Date(new Date(value).getTime() + DAY_MS)
  }))
])

/** Postgres `text` can't hold NUL: such a filter would fail as a 500. */
const filterSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(value => !value.includes('\u0000'), NUL_MESSAGE)

const listRunsQuerySchema = z
  .object({
    templateId: filterSchema.optional(),
    decision: filterSchema.optional(),
    mode: z.enum(RUN_MODES).optional(),
    source: z.enum(RUN_SOURCES).optional(),
    status: z.enum(RUN_STATUSES).optional(),
    reviewStatus: z.enum(REVIEW_STATUSES).optional(),
    from: fromSchema.optional(),
    to: toSchema.optional(),
    cursor: filterSchema.optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(RUNS_PAGE_LIMIT.max)
      .default(RUNS_PAGE_LIMIT.default)
  })
  .transform(({ to, ...filters }): RunFilters => ({ ...filters, ...to }))

/** Runs explorer for the dashboard (`/api/runs`). */
export const runsModule = Arcton({ prefix: '/api/runs' }).provide(
  withOrgSession
)

runsModule.get('/', {
  query: listRunsQuerySchema,
  detail: {
    summary: 'List runs',
    tags: ['Runs'],
    description:
      'Newest first. Filters: templateId, decision, mode, source, status, reviewStatus, from/to (inclusive, ISO 8601: a date-time with offset, or a date — `to=2026-09-23` includes that whole UTC day). Paginate by passing the previous `nextCursor` as `cursor`; `limit` ≤ 100 (default 50).'
  },
  handler: ({ organizationId, query }) => listRuns(organizationId, query)
})

runsModule.get('/:id', {
  detail: { summary: 'Get a run', tags: ['Runs'] },
  handler: async ({ organizationId, params }) => ({
    run: await getRunDetail(organizationId, params.id)
  })
})
