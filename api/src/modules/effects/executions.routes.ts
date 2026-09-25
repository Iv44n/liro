import { Arcton } from '@arcton/core'
import { requirePermission, withOrgSession } from '#shared/http/session'
import { listRunEffects, retryEffectExecution } from './effects.service'

const tags = ['Effects']

/**
 * Effect executions: a run's own deliveries, and retrying one. Under `/api`
 * rather than a dedicated prefix, since it spans two resources
 * (`/api/runs/:id/effects`, `/api/effect-executions/:id/retry`).
 */
export const executionsModule = Arcton({ prefix: '/api' }).provide(
  withOrgSession
)

executionsModule.get('/runs/:id/effects', {
  detail: { summary: "List a run's effect executions", tags },
  handler: ({ params, organizationId }) =>
    listRunEffects(organizationId, params.id)
})

executionsModule.post('/effect-executions/:id/retry', {
  detail: {
    summary: 'Retry an effect execution',
    description:
      'Only a `dead` or `canceled` execution (409 otherwise); requeues it now with a fresh attempt budget.',
    tags
  },
  middleware: [requirePermission({ webhook: ['manage'] })],
  handler: async ({ params, organizationId }) => ({
    execution: await retryEffectExecution(organizationId, params.id)
  })
})
