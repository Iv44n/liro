import type { HttpClient } from '#/sdk/http/http-client'
import { routes } from './routes'
import type { EffectExecutionView } from './types'

/**
 * A run's effect executions, and retrying one (`/api/runs/:id/effects`,
 * `/api/effect-executions/:id/retry`).
 */
export function executionsClient(http: HttpClient) {
  return {
    /** Every effect execution of one run, oldest first. */
    async listByRun(runId: string) {
      const { data } = await http.get<{ data: EffectExecutionView[] }>(
        routes.runEffects(runId)
      )
      return data
    },
    /**
     * `dead`/`canceled` → `queued` (attempts reset, due now). 409
     * `EXECUTION_NOT_RETRYABLE` otherwise.
     */
    async retry(id: string) {
      const { execution } = await http.post<{
        execution: EffectExecutionView
      }>(routes.retry(id))
      return execution
    }
  }
}
