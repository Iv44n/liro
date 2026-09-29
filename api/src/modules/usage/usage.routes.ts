import { Arcton } from '@arcton/core'
import { withOrgSession } from '#shared/http/session'
import { getUsage, usageQuerySchema } from './usage.service'

const tags = ['Usage']

/** Monthly usage/metering for the dashboard (`/api/usage`). */
export const usageModule = Arcton({ prefix: '/api/usage' }).provide(
  withOrgSession
)

usageModule.get('/', {
  query: usageQuerySchema,
  detail: {
    summary: 'Get monthly usage',
    tags,
    description:
      '`month` (`YYYY-MM`, default: the current UTC month). Reads the `usage_daily` rollup, so it survives run purges and retention — the source for billing. `totals.estimatedCostUsd` is `inputTokens × 0.042 / 1e6`; `byTemplate` joins in template names (archived templates included).'
  },
  handler: ({ organizationId, query }) => getUsage(organizationId, query)
})
