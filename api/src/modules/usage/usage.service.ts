import { and, eq, gte, lt } from 'drizzle-orm'
import z from 'zod'
import {
  type RunMode,
  type RunSource,
  usageDaily
} from '#modules/runs/runs.schemas'
import { decisionTemplates } from '#modules/templates/templates.schemas'
import { db } from '#shared/db/config'

/**
 * Monthly usage/metering for the dashboard (`/api/usage`), read straight
 * from `usage_daily` (the rollup `engine/executor.ts` maintains in each
 * run's transaction — see its own docs for what counts as a "run" vs an
 * "evaluation"). Unlike `stats`, which aggregates `decision_runs` and is
 * purge-sensitive, this survives run purges and retention: it's the source
 * for billing.
 */

// ── Query ────────────────────────────────────────────────────────────────

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export const usageQuerySchema = z.object({
  /** `YYYY-MM`; defaults to the current UTC month. */
  month: z.string().regex(MONTH_PATTERN, 'Must be YYYY-MM').optional()
})

export type UsageQuery = z.output<typeof usageQuerySchema>

/** The current UTC month, `YYYY-MM`. */
function currentMonth(now: Date): string {
  return now.toISOString().slice(0, 7)
}

/**
 * `[start, end)` as `usage_daily.day` strings (`date` column, `'YYYY-MM-DD'`
 * text, so lexicographic bounds are also chronological bounds) for `month`
 * (`YYYY-MM`, already validated by `usageQuerySchema`).
 */
function monthBounds(month: string): { start: string; end: string } {
  const year = Number(month.slice(0, 4))
  // `monthOfYear` is 1-based (01–12); `Date.UTC`'s month index is 0-based,
  // so passing it straight through lands on the *next* month's day 1 —
  // exactly the exclusive upper bound (December correctly rolls into
  // January of `year + 1`).
  const monthOfYear = Number(month.slice(5, 7))
  const start = `${month}-01`
  const end = new Date(Date.UTC(year, monthOfYear, 1))
    .toISOString()
    .slice(0, 10)
  return { start, end }
}

// ── Response shape ──────────────────────────────────────────────────────

export interface UsageTotals {
  runs: number
  evaluations: number
  inputTokens: number
  outputTokens: number
  /** `inputTokens × 0.042 / 1e6`, rounded to 1e-6 USD. */
  estimatedCostUsd: number
}

/** Shared shape of every breakdown row: counts, never `outputTokens` (only `totals` has it). */
interface UsageCounts {
  runs: number
  evaluations: number
  inputTokens: number
}

export interface UsageByDay extends UsageCounts {
  day: string
}

export interface UsageByTemplate extends UsageCounts {
  templateId: string
  name: string
  slug: string
}

export interface UsageBySource extends UsageCounts {
  source: RunSource
}

export interface UsageByMode extends UsageCounts {
  mode: RunMode
}

export interface UsageByProvider extends UsageCounts {
  provider: string
}

export interface UsageSummary {
  month: string
  totals: UsageTotals
  /** Chronological (ascending `day`). */
  byDay: UsageByDay[]
  /** Busiest first (`runs` descending), ties broken by `name`. */
  byTemplate: UsageByTemplate[]
  /** Busiest first (`runs` descending), ties broken by the key. */
  bySource: UsageBySource[]
  byMode: UsageByMode[]
  byProvider: UsageByProvider[]
}

const INPUT_TOKEN_COST_PER_MILLION_USD = 0.042

/** Rounded to 1e-6 USD — precise enough for a monthly estimate, no float noise. */
const roundCost = (value: number) => Math.round(value * 1_000_000) / 1_000_000

const emptyCounts = (): UsageCounts => ({
  runs: 0,
  evaluations: 0,
  inputTokens: 0
})

/** Accumulates one `usage_daily` row into `map[key]`, creating it from `seed` on first sight. */
function bump<K, V extends UsageCounts>(
  map: Map<K, V>,
  key: K,
  seed: () => V,
  row: { runs: number; evaluations: number; inputTokens: number }
): void {
  const entry = map.get(key) ?? seed()
  entry.runs += row.runs
  entry.evaluations += row.evaluations
  entry.inputTokens += row.inputTokens
  map.set(key, entry)
}

/** `runs` descending; ties broken by `tieBreak` (ascending) for a stable, deterministic order. */
function byRunsDesc<T extends UsageCounts>(tieBreak: (row: T) => string) {
  return (a: T, b: T) =>
    b.runs - a.runs || tieBreak(a).localeCompare(tieBreak(b))
}

// ── Read ────────────────────────────────────────────────────────────────

/**
 * `GET /api/usage?month=YYYY-MM`. Reads every `usage_daily` row of the
 * month for the organization (one row per day/template/source/mode/provider
 * combination — small even for a busy org) and folds it into the totals and
 * five breakdowns in one pass. Template names are joined in (archived
 * templates included — usage predates and outlives archiving).
 */
export async function getUsage(
  organizationId: string,
  query: UsageQuery,
  now: Date = new Date()
): Promise<UsageSummary> {
  const month = query.month ?? currentMonth(now)
  const { start, end } = monthBounds(month)

  const rows = await db
    .select({
      day: usageDaily.day,
      templateId: usageDaily.templateId,
      templateName: decisionTemplates.name,
      templateSlug: decisionTemplates.slug,
      source: usageDaily.source,
      mode: usageDaily.mode,
      provider: usageDaily.provider,
      runs: usageDaily.runs,
      evaluations: usageDaily.evaluations,
      inputTokens: usageDaily.inputTokens,
      outputTokens: usageDaily.outputTokens
    })
    .from(usageDaily)
    .leftJoin(
      decisionTemplates,
      and(
        eq(decisionTemplates.id, usageDaily.templateId),
        eq(decisionTemplates.organizationId, usageDaily.organizationId)
      )
    )
    .where(
      and(
        eq(usageDaily.organizationId, organizationId),
        gte(usageDaily.day, start),
        lt(usageDaily.day, end)
      )
    )

  const totals: UsageTotals = {
    runs: 0,
    evaluations: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0
  }
  const byDay = new Map<string, UsageByDay>()
  const byTemplate = new Map<string, UsageByTemplate>()
  const bySource = new Map<RunSource, UsageBySource>()
  const byMode = new Map<RunMode, UsageByMode>()
  const byProvider = new Map<string, UsageByProvider>()

  for (const row of rows) {
    totals.runs += row.runs
    totals.evaluations += row.evaluations
    totals.inputTokens += row.inputTokens
    totals.outputTokens += row.outputTokens

    bump(byDay, row.day, () => ({ day: row.day, ...emptyCounts() }), row)
    bump(
      byTemplate,
      row.templateId,
      () => ({
        templateId: row.templateId,
        name: row.templateName ?? row.templateId,
        slug: row.templateSlug ?? row.templateId,
        ...emptyCounts()
      }),
      row
    )
    bump(
      bySource,
      row.source,
      () => ({ source: row.source, ...emptyCounts() }),
      row
    )
    bump(byMode, row.mode, () => ({ mode: row.mode, ...emptyCounts() }), row)
    bump(
      byProvider,
      row.provider,
      () => ({ provider: row.provider, ...emptyCounts() }),
      row
    )
  }

  totals.estimatedCostUsd = roundCost(
    (totals.inputTokens * INPUT_TOKEN_COST_PER_MILLION_USD) / 1_000_000
  )

  return {
    month,
    totals,
    byDay: [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)),
    byTemplate: [...byTemplate.values()].sort(byRunsDesc(row => row.name)),
    bySource: [...bySource.values()].sort(byRunsDesc(row => row.source)),
    byMode: [...byMode.values()].sort(byRunsDesc(row => row.mode)),
    byProvider: [...byProvider.values()].sort(byRunsDesc(row => row.provider))
  }
}
