import { and, desc, eq, gte, isNotNull, lte, type SQL, sql } from 'drizzle-orm'
import { reviewTasks } from '#modules/reviews/reviews.schemas'
import { decisionRuns, type RunSource } from '#modules/runs/runs.schemas'
import { NEEDS_REVIEW } from '#modules/templates/definition'
import { decisionTemplates } from '#modules/templates/templates.schemas'
import { getTemplate } from '#modules/templates/templates.service'
import { db } from '#shared/db/config'

/**
 * Per-template and org-wide (`overview`) aggregates for the dashboard. Every
 * query is scoped to one organization, filtered to `source: 'api'` unless
 * the caller names another one (so dashboard-triggered playground/review
 * runs don't skew production numbers by default), and computed against the
 * JS `now` the route hands in — never `new Date()`/SQL `now()` here — so
 * tests can hold it fixed with `setSystemTime` and get reproducible bucket
 * boundaries.
 */

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export const STATS_RANGES = ['24h', '7d', '30d', '90d'] as const
export type StatsRange = (typeof STATS_RANGES)[number]

export const STATS_MODES = ['live', 'test', 'all'] as const
export type StatsMode = (typeof STATS_MODES)[number]

interface RangeConfig {
  windowMs: number
  bucketMs: number
  buckets: number
}

const RANGE_CONFIG: Record<StatsRange, RangeConfig> = {
  '24h': { windowMs: 24 * HOUR_MS, bucketMs: HOUR_MS, buckets: 24 },
  '7d': { windowMs: 7 * DAY_MS, bucketMs: DAY_MS, buckets: 7 },
  '30d': { windowMs: 30 * DAY_MS, bucketMs: DAY_MS, buckets: 30 },
  '90d': { windowMs: 90 * DAY_MS, bucketMs: DAY_MS, buckets: 90 }
}

export interface StatsFilters {
  range: StatsRange
  mode: StatsMode
  /** Default `'api'`. */
  source?: RunSource
}

const round2 = (value: number) => Math.round(value * 100) / 100
const round4 = (value: number) => Math.round(value * 10_000) / 10_000
const round2OrNull = (value: number | null) =>
  value === null ? null : round2(value)
const round4OrNull = (value: number | null) =>
  value === null ? null : round4(value)

/** `from` (inclusive) is `windowMs` before `now`; `to` (inclusive) is `now` itself. */
function rangeOf(range: StatsRange, now: Date): { from: Date; to: Date } {
  return {
    from: new Date(now.getTime() - RANGE_CONFIG[range].windowMs),
    to: now
  }
}

/** Every query's `WHERE`: org, the range, the mode (unless `all`) and the source. */
function baseConditions(
  organizationId: string,
  filters: StatsFilters,
  from: Date,
  to: Date,
  extra: { templateId?: string; versionId?: string } = {}
): SQL[] {
  const conditions: SQL[] = [
    eq(decisionRuns.organizationId, organizationId),
    gte(decisionRuns.createdAt, from),
    lte(decisionRuns.createdAt, to),
    eq(decisionRuns.source, filters.source ?? 'api')
  ]
  if (filters.mode !== 'all')
    conditions.push(eq(decisionRuns.mode, filters.mode))
  if (extra.templateId) {
    conditions.push(eq(decisionRuns.templateId, extra.templateId))
  }
  if (extra.versionId) {
    conditions.push(eq(decisionRuns.versionId, extra.versionId))
  }
  return conditions
}

// ── Totals (+ latency, tokens) ──────────────────────────────────────────

export interface TotalsView {
  runs: number
  succeeded: number
  failed: number
  /** Succeeded and not `needs_review`. */
  decided: number
  /** Succeeded and `needs_review`. */
  needsReview: number
  reviewRate: number
  autoDecisionRate: number
  avgConfidence: number | null
}

interface AggregateRow {
  runs: number
  succeeded: number
  failed: number
  decided: number
  needsReview: number
  avgConfidence: number | null
  confidenceNullCount: number
  inputTokens: number
  outputTokens: number
  latencyP50: number | null
  latencyP95: number | null
  latencyP99: number | null
  evalP50: number | null
  evalP95: number | null
}

/** Every scalar aggregate in one round trip: totals, latency/evaluator-latency percentiles, tokens. */
async function computeAggregate(conditions: SQL[]): Promise<AggregateRow> {
  const succeeded = sql`${decisionRuns.status} = 'succeeded'`
  const [row] = await db
    .select({
      runs: sql<number>`count(*)`.mapWith(Number),
      succeeded: sql<number>`count(*) filter (where ${succeeded})`.mapWith(
        Number
      ),
      failed:
        sql<number>`count(*) filter (where ${decisionRuns.status} = 'failed')`.mapWith(
          Number
        ),
      decided:
        sql<number>`count(*) filter (where ${succeeded} and ${decisionRuns.decision} <> ${NEEDS_REVIEW})`.mapWith(
          Number
        ),
      needsReview:
        sql<number>`count(*) filter (where ${succeeded} and ${decisionRuns.decision} = ${NEEDS_REVIEW})`.mapWith(
          Number
        ),
      avgConfidence: sql<
        number | null
      >`avg(${decisionRuns.confidence}) filter (where ${succeeded})`.mapWith(
        Number
      ),
      confidenceNullCount:
        sql<number>`count(*) filter (where ${succeeded} and ${decisionRuns.confidence} is null)`.mapWith(
          Number
        ),
      inputTokens:
        sql<number>`coalesce(sum(${decisionRuns.inputTokens}), 0)`.mapWith(
          Number
        ),
      outputTokens:
        sql<number>`coalesce(sum(${decisionRuns.outputTokens}), 0)`.mapWith(
          Number
        ),
      latencyP50: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${decisionRuns.latencyMs}) filter (where ${succeeded})`.mapWith(
        Number
      ),
      latencyP95: sql<
        number | null
      >`percentile_cont(0.95) within group (order by ${decisionRuns.latencyMs}) filter (where ${succeeded})`.mapWith(
        Number
      ),
      latencyP99: sql<
        number | null
      >`percentile_cont(0.99) within group (order by ${decisionRuns.latencyMs}) filter (where ${succeeded})`.mapWith(
        Number
      ),
      evalP50: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${decisionRuns.evaluatorLatencyMs}) filter (where ${succeeded})`.mapWith(
        Number
      ),
      evalP95: sql<
        number | null
      >`percentile_cont(0.95) within group (order by ${decisionRuns.evaluatorLatencyMs}) filter (where ${succeeded})`.mapWith(
        Number
      )
    })
    .from(decisionRuns)
    .where(and(...conditions))
  return (
    row ?? {
      runs: 0,
      succeeded: 0,
      failed: 0,
      decided: 0,
      needsReview: 0,
      avgConfidence: null,
      confidenceNullCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      latencyP50: null,
      latencyP95: null,
      latencyP99: null,
      evalP50: null,
      evalP95: null
    }
  )
}

function totalsView(row: AggregateRow): TotalsView {
  return {
    runs: row.runs,
    succeeded: row.succeeded,
    failed: row.failed,
    decided: row.decided,
    needsReview: row.needsReview,
    reviewRate: row.succeeded > 0 ? round4(row.needsReview / row.succeeded) : 0,
    autoDecisionRate:
      row.succeeded > 0 ? round4(row.decided / row.succeeded) : 0,
    avgConfidence: round4OrNull(row.avgConfidence)
  }
}

// ── Decisions / final decisions ─────────────────────────────────────────

export interface LabelCount {
  label: string
  count: number
}

export interface DecisionShare extends LabelCount {
  share: number
}

/** Succeeded runs grouped by `decision` (`needs_review` included as a label). */
async function computeDecisions(
  conditions: SQL[],
  succeededTotal: number
): Promise<DecisionShare[]> {
  const rows = await db
    .select({
      label: decisionRuns.decision,
      count: sql<number>`count(*)`.mapWith(Number)
    })
    .from(decisionRuns)
    .where(
      and(
        ...conditions,
        eq(decisionRuns.status, 'succeeded'),
        isNotNull(decisionRuns.decision)
      )
    )
    .groupBy(decisionRuns.decision)
    .orderBy(desc(sql`count(*)`), decisionRuns.decision)
  return rows.map(row => ({
    // Filtered `is not null` above.
    label: row.label ?? '',
    count: row.count,
    share: succeededTotal > 0 ? round4(row.count / succeededTotal) : 0
  }))
}

/** Runs grouped by `finalDecision` (only those a review resolved, or that never needed one). */
async function computeFinalDecisions(conditions: SQL[]): Promise<LabelCount[]> {
  const rows = await db
    .select({
      label: decisionRuns.finalDecision,
      count: sql<number>`count(*)`.mapWith(Number)
    })
    .from(decisionRuns)
    .where(and(...conditions, isNotNull(decisionRuns.finalDecision)))
    .groupBy(decisionRuns.finalDecision)
    .orderBy(desc(sql`count(*)`), decisionRuns.finalDecision)
  return rows.map(row => ({ label: row.label ?? '', count: row.count }))
}

// ── Confidence histogram ────────────────────────────────────────────────

export interface ConfidenceBin {
  from: number
  to: number
  count: number
}

export interface ConfidenceHistogram {
  bins: ConfidenceBin[]
  nullCount: number
}

/** 10 bins on `[0, 1]`; `confidence = 1` falls in the last bin, not an 11th. */
const CONFIDENCE_BIN_EXPR = sql`least(9, greatest(0, floor(${decisionRuns.confidence} * 10)))::int`

async function computeConfidenceHistogram(
  conditions: SQL[],
  nullCount: number
): Promise<ConfidenceHistogram> {
  const rows = await db
    .select({
      bin: sql<number>`${CONFIDENCE_BIN_EXPR}`.mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number)
    })
    .from(decisionRuns)
    .where(
      and(
        ...conditions,
        eq(decisionRuns.status, 'succeeded'),
        isNotNull(decisionRuns.confidence)
      )
    )
    // Position 1 (`bin`) — see `computeSeries` for why not `CONFIDENCE_BIN_EXPR` again.
    .groupBy(sql`1`)

  const bins: ConfidenceBin[] = Array.from({ length: 10 }, (_, index) => ({
    from: round2(index / 10),
    to: round2((index + 1) / 10),
    count: 0
  }))
  for (const row of rows) {
    const bin = bins[row.bin]
    if (bin) bin.count = row.count
  }
  return { bins, nullCount }
}

// ── Errors / flags ───────────────────────────────────────────────────────

/** Failed runs grouped by `errorCode`. */
async function computeErrors(conditions: SQL[]): Promise<LabelCount[]> {
  const rows = await db
    .select({
      code: decisionRuns.errorCode,
      count: sql<number>`count(*)`.mapWith(Number)
    })
    .from(decisionRuns)
    .where(
      and(
        ...conditions,
        eq(decisionRuns.status, 'failed'),
        isNotNull(decisionRuns.errorCode)
      )
    )
    .groupBy(decisionRuns.errorCode)
    .orderBy(desc(sql`count(*)`), decisionRuns.errorCode)
  return rows.map(row => ({ label: row.code ?? '', count: row.count }))
}

export interface FlagCount {
  flag: string
  count: number
}

/**
 * Succeeded runs' `flags` (a `text[]`), counted per flag. Read as plain rows
 * and reduced in JS rather than `unnest` in SQL: simpler to keep correct
 * than a `GROUP BY` over a set-returning expression, and flag lists are
 * short, so this stays cheap at dashboard scale.
 */
async function computeFlags(conditions: SQL[]): Promise<FlagCount[]> {
  const rows = await db
    .select({ flags: decisionRuns.flags })
    .from(decisionRuns)
    .where(and(...conditions, eq(decisionRuns.status, 'succeeded')))

  const counts = new Map<string, number>()
  for (const row of rows) {
    for (const flag of row.flags) counts.set(flag, (counts.get(flag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([flag, count]) => ({ flag, count }))
    .sort((a, b) => b.count - a.count || a.flag.localeCompare(b.flag))
}

// ── Time series ──────────────────────────────────────────────────────────

export interface SeriesPoint {
  bucket: Date
  runs: number
  needsReview: number
  failed: number
  avgLatencyMs: number | null
}

/** Fixed-width buckets anchored at `from` (not calendar-aligned): `[from + i·bucketMs, from + (i+1)·bucketMs)`. */
function bucketStarts(range: StatsRange, from: Date): Date[] {
  const { buckets, bucketMs } = RANGE_CONFIG[range]
  return Array.from(
    { length: buckets },
    (_, i) => new Date(from.getTime() + i * bucketMs)
  )
}

/** 0-based bucket index of `createdAt`, clamped into range (a row at exactly `to` would otherwise overflow by one). */
function bucketIndexExpr(from: Date, bucketMs: number, buckets: number) {
  const raw = sql`floor(extract(epoch from (${decisionRuns.createdAt} - ${from.toISOString()}::timestamptz)) / ${bucketMs / 1000})`
  return sql`least(${buckets - 1}, greatest(0, ${raw}))::int`
}

async function computeSeries(
  conditions: SQL[],
  range: StatsRange,
  from: Date
): Promise<SeriesPoint[]> {
  const { bucketMs, buckets } = RANGE_CONFIG[range]
  const bucketExpr = bucketIndexExpr(from, bucketMs, buckets)
  const succeeded = sql`${decisionRuns.status} = 'succeeded'`

  const rows = await db
    .select({
      bucket: sql<number>`${bucketExpr}`.mapWith(Number),
      runs: sql<number>`count(*)`.mapWith(Number),
      needsReview:
        sql<number>`count(*) filter (where ${succeeded} and ${decisionRuns.decision} = ${NEEDS_REVIEW})`.mapWith(
          Number
        ),
      failed:
        sql<number>`count(*) filter (where ${decisionRuns.status} = 'failed')`.mapWith(
          Number
        ),
      latencySum:
        sql<number>`coalesce(sum(${decisionRuns.latencyMs}) filter (where ${succeeded}), 0)`.mapWith(
          Number
        ),
      succeededCount: sql<number>`count(*) filter (where ${succeeded})`.mapWith(
        Number
      )
    })
    .from(decisionRuns)
    .where(and(...conditions))
    // Grouped by ordinal position (`bucket`, the 1st selected column), not by
    // repeating `bucketExpr`: each appearance of a parameterized expression
    // gets its own placeholders, so Postgres would no longer see the `GROUP
    // BY` as the same expression as the one in the `SELECT` list.
    .groupBy(sql`1`)

  const points = bucketStarts(range, from).map(bucket => ({
    bucket,
    runs: 0,
    needsReview: 0,
    failed: 0,
    latencySum: 0,
    succeededCount: 0
  }))
  for (const row of rows) {
    const point = points[row.bucket]
    if (!point) continue
    point.runs += row.runs
    point.needsReview += row.needsReview
    point.failed += row.failed
    point.latencySum += row.latencySum
    point.succeededCount += row.succeededCount
  }
  return points.map(({ latencySum, succeededCount, ...point }) => ({
    ...point,
    avgLatencyMs:
      succeededCount > 0 ? round2(latencySum / succeededCount) : null
  }))
}

// ── Reviews ──────────────────────────────────────────────────────────────

export interface ReviewsSummary {
  pending: number
  resolved: number
  agreedWithSuggestion: number
  agreementRate: number
  medianTimeToResolveMs: number | null
}

/** `review_tasks` of the runs `conditions` selects (joined — reviews carry no mode/source/versionId of their own). */
async function computeReviews(conditions: SQL[]): Promise<ReviewsSummary> {
  const pending = sql`${reviewTasks.status} = 'pending'`
  const resolved = sql`${reviewTasks.status} = 'resolved'`
  const agreed = sql`${resolved} and ${reviewTasks.suggestedDecision} is not null and ${reviewTasks.resolvedDecision} = ${reviewTasks.suggestedDecision}`
  const resolveMs = sql`extract(epoch from (${reviewTasks.resolvedAt} - ${reviewTasks.createdAt})) * 1000`

  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${pending})`.mapWith(Number),
      resolved: sql<number>`count(*) filter (where ${resolved})`.mapWith(
        Number
      ),
      agreed: sql<number>`count(*) filter (where ${agreed})`.mapWith(Number),
      medianResolveMs: sql<
        number | null
      >`percentile_cont(0.5) within group (order by ${resolveMs}) filter (where ${resolved})`.mapWith(
        Number
      )
    })
    .from(reviewTasks)
    .innerJoin(decisionRuns, eq(decisionRuns.id, reviewTasks.runId))
    .where(and(...conditions))

  const resolvedCount = row?.resolved ?? 0
  const agreedCount = row?.agreed ?? 0
  return {
    pending: row?.pending ?? 0,
    resolved: resolvedCount,
    agreedWithSuggestion: agreedCount,
    agreementRate: resolvedCount > 0 ? round4(agreedCount / resolvedCount) : 0,
    medianTimeToResolveMs: round2OrNull(row?.medianResolveMs ?? null)
  }
}

// ── `GET /api/stats/templates/:id` ──────────────────────────────────────

export interface TemplateStatsView {
  range: StatsRange
  from: Date
  to: Date
  totals: TotalsView
  decisions: DecisionShare[]
  finalDecisions: LabelCount[]
  confidenceHistogram: ConfidenceHistogram
  latency: { p50: number | null; p95: number | null; p99: number | null }
  evaluatorLatency: { p50: number | null; p95: number | null }
  tokens: { input: number; output: number }
  errors: LabelCount[]
  flags: FlagCount[]
  series: SeriesPoint[]
  reviews: ReviewsSummary
}

export interface TemplateStatsQuery extends StatsFilters {
  versionId?: string
}

/** `GET /api/stats/templates/:id` (404 outside the caller's organization). */
export async function getTemplateStats(
  organizationId: string,
  templateId: string,
  query: TemplateStatsQuery,
  now: Date
): Promise<TemplateStatsView> {
  await getTemplate(organizationId, templateId)

  const { from, to } = rangeOf(query.range, now)
  const conditions = baseConditions(organizationId, query, from, to, {
    templateId,
    versionId: query.versionId
  })

  const aggregate = await computeAggregate(conditions)
  const [
    decisions,
    finalDecisions,
    confidenceHistogram,
    errors,
    flags,
    series,
    reviews
  ] = await Promise.all([
    computeDecisions(conditions, aggregate.succeeded),
    computeFinalDecisions(conditions),
    computeConfidenceHistogram(conditions, aggregate.confidenceNullCount),
    computeErrors(conditions),
    computeFlags(conditions),
    computeSeries(conditions, query.range, from),
    computeReviews(conditions)
  ])

  return {
    range: query.range,
    from,
    to,
    totals: totalsView(aggregate),
    decisions,
    finalDecisions,
    confidenceHistogram,
    latency: {
      p50: round2OrNull(aggregate.latencyP50),
      p95: round2OrNull(aggregate.latencyP95),
      p99: round2OrNull(aggregate.latencyP99)
    },
    evaluatorLatency: {
      p50: round2OrNull(aggregate.evalP50),
      p95: round2OrNull(aggregate.evalP95)
    },
    tokens: { input: aggregate.inputTokens, output: aggregate.outputTokens },
    errors,
    flags,
    series,
    reviews
  }
}

// ── `GET /api/stats/overview` ───────────────────────────────────────────

export interface OverviewTemplateRow {
  id: string
  slug: string
  name: string
  runs: number
  reviewRate: number
  failureRate: number
  p95LatencyMs: number | null
  trend: number[]
}

export interface OverviewStatsView {
  range: StatsRange
  from: Date
  to: Date
  totals: TotalsView
  templates: OverviewTemplateRow[]
}

interface PerTemplateRow {
  templateId: string
  slug: string
  name: string
  runs: number
  succeeded: number
  needsReview: number
  failed: number
  p95LatencyMs: number | null
}

/** One row per template with at least one matching run, newest-template-first ties broken by id. */
async function computePerTemplate(
  conditions: SQL[]
): Promise<PerTemplateRow[]> {
  const succeeded = sql`${decisionRuns.status} = 'succeeded'`
  return db
    .select({
      templateId: decisionRuns.templateId,
      slug: decisionTemplates.slug,
      name: decisionTemplates.name,
      runs: sql<number>`count(*)`.mapWith(Number),
      succeeded: sql<number>`count(*) filter (where ${succeeded})`.mapWith(
        Number
      ),
      needsReview:
        sql<number>`count(*) filter (where ${succeeded} and ${decisionRuns.decision} = ${NEEDS_REVIEW})`.mapWith(
          Number
        ),
      failed:
        sql<number>`count(*) filter (where ${decisionRuns.status} = 'failed')`.mapWith(
          Number
        ),
      p95LatencyMs: sql<
        number | null
      >`percentile_cont(0.95) within group (order by ${decisionRuns.latencyMs}) filter (where ${succeeded})`.mapWith(
        Number
      )
    })
    .from(decisionRuns)
    .innerJoin(
      decisionTemplates,
      eq(decisionTemplates.id, decisionRuns.templateId)
    )
    .where(and(...conditions))
    .groupBy(
      decisionRuns.templateId,
      decisionTemplates.slug,
      decisionTemplates.name
    )
}

/** Run counts per template per bucket, for each template's `trend`. */
async function computeTemplateTrends(
  conditions: SQL[],
  range: StatsRange,
  from: Date
): Promise<Map<string, number[]>> {
  const { bucketMs, buckets } = RANGE_CONFIG[range]
  const bucketExpr = bucketIndexExpr(from, bucketMs, buckets)

  const rows = await db
    .select({
      templateId: decisionRuns.templateId,
      bucket: sql<number>`${bucketExpr}`.mapWith(Number),
      runs: sql<number>`count(*)`.mapWith(Number)
    })
    .from(decisionRuns)
    .where(and(...conditions))
    // Position 2 (`bucket`), not `bucketExpr` again — see `computeSeries`.
    .groupBy(decisionRuns.templateId, sql`2`)

  const trends = new Map<string, number[]>()
  for (const row of rows) {
    const trend = trends.get(row.templateId) ?? Array(buckets).fill(0)
    trend[row.bucket] = (trend[row.bucket] ?? 0) + row.runs
    trends.set(row.templateId, trend)
  }
  return trends
}

/** `GET /api/stats/overview`: every template with traffic in range, busiest first. */
export async function getOverviewStats(
  organizationId: string,
  query: StatsFilters,
  now: Date
): Promise<OverviewStatsView> {
  const { from, to } = rangeOf(query.range, now)
  const conditions = baseConditions(organizationId, query, from, to)

  const [aggregate, perTemplate, trends] = await Promise.all([
    computeAggregate(conditions),
    computePerTemplate(conditions),
    computeTemplateTrends(conditions, query.range, from)
  ])

  const templates: OverviewTemplateRow[] = perTemplate
    .map(row => ({
      id: row.templateId,
      slug: row.slug,
      name: row.name,
      runs: row.runs,
      reviewRate:
        row.succeeded > 0 ? round4(row.needsReview / row.succeeded) : 0,
      failureRate: row.runs > 0 ? round4(row.failed / row.runs) : 0,
      p95LatencyMs: round2OrNull(row.p95LatencyMs),
      trend:
        trends.get(row.templateId) ??
        Array(RANGE_CONFIG[query.range].buckets).fill(0)
    }))
    .sort((a, b) => b.runs - a.runs || a.id.localeCompare(b.id))

  return {
    range: query.range,
    from,
    to,
    totals: totalsView(aggregate),
    templates
  }
}
