import { Arcton } from '@arcton/core'
import z from 'zod'
import { NUL_MESSAGE } from '#modules/engine/compiled-cache'
import { RUN_SOURCES } from '#modules/runs/runs.schemas'
import { withOrgSession } from '#shared/http/session'
import {
  getOverviewStats,
  getTemplateStats,
  STATS_MODES,
  STATS_RANGES
} from './stats.service'

const tags = ['Stats']

/** Postgres `text` can't hold NUL: such a filter would fail as a 500. */
const filterSchema = z
  .string()
  .min(1)
  .max(64)
  .refine(value => !value.includes('\u0000'), NUL_MESSAGE)

const overviewQuerySchema = z.object({
  range: z.enum(STATS_RANGES),
  mode: z.enum(STATS_MODES).default('live'),
  source: z.enum(RUN_SOURCES).optional()
})

const templateStatsQuerySchema = overviewQuerySchema.extend({
  versionId: filterSchema.optional()
})

/** Per-template and overview aggregates for the dashboard (`/api/stats`). */
export const statsModule = Arcton({ prefix: '/api/stats' }).provide(
  withOrgSession
)

statsModule.get('/overview', {
  query: overviewQuerySchema,
  detail: {
    summary: 'Organization-wide stats overview',
    tags,
    description:
      "`range`: `24h` (hourly buckets), `7d`, `30d` or `90d` (daily buckets). `mode`: `live` (default), `test` or `all`. `source` defaults to `api`. Totals and, per template with any matching run, its run count, reviewRate, failureRate, p95 latency and a run-count trend across the range's buckets, busiest first."
  },
  handler: ({ organizationId, query }) =>
    getOverviewStats(organizationId, query, new Date())
})

statsModule.get('/templates/:id', {
  query: templateStatsQuerySchema,
  detail: {
    summary: 'One template stats',
    tags,
    description:
      "`range`/`mode`/`source` as in the overview, plus an optional `versionId` to scope to one published version. Totals, decisions and finalDecisions breakdowns, a 10-bin confidence histogram, latency/evaluator-latency percentiles, token sums, failed-run errors, flag counts, a bucketed time series and the template's review-inbox summary."
  },
  handler: ({ organizationId, params, query }) =>
    getTemplateStats(organizationId, params.id, query, new Date())
})
