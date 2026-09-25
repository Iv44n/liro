import { segment } from '#/sdk/http/query'

/**
 * Relative to the dashboard client's base URL (`…/api`). Under two
 * resources (a run's effects, and retrying one execution) rather than a
 * dedicated prefix, mirroring `api/src/modules/effects/executions.routes.ts`.
 */
export const routes = {
  runEffects: (runId: string) => `/runs/${segment(runId)}/effects`,
  retry: (executionId: string) =>
    `/effect-executions/${segment(executionId)}/retry`
} as const
