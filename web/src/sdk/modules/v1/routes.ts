import { segment } from '#/sdk/http/query'

/** Relative to the public client's base URL (the API origin, no `/api`). */
export const routes = {
  whoami: '/v1/whoami',
  decisions: '/v1/decisions',
  decision: (ref: string) => `/v1/decisions/${segment(ref)}`,
  runDecision: (ref: string) => `/v1/decisions/${segment(ref)}/run`,
  run: (id: string) => `/v1/runs/${segment(id)}`
} as const
