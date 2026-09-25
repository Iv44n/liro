import type {
  JsonValue,
  TemplateKind
} from '#/features/templates/types/definition'
import type { ApiKeyMode } from '#/sdk/modules/api-keys/types'

export type { PublicRunView } from '#/sdk/modules/runs/types'

/**
 * The public runtime (`/v1`, mirrors `api/src/modules/runs/public.routes.ts`,
 * `runs.views.ts` and `identity.routes.ts`). The dashboard calls it with the
 * session cookie, which acts as a `live` caller.
 */

export type Whoami =
  | {
      type: 'api_key'
      organizationId: string
      mode: ApiKeyMode
      apiKeyId: string
    }
  | { type: 'user'; organizationId: string; mode: 'live' }

export interface DecisionSummaryView {
  slug: string
  name: string
  description: string | null
  kind: TemplateKind
  /** `M.m` of the version the ref resolves to. */
  version: string
  labels: string[]
  /** JSON Schema of the input contract. */
  inputSchema: Record<string, unknown>
  deprecated: boolean
}

export interface DecisionContractView extends DecisionSummaryView {
  decisions: { label: string; description: string | null }[]
}

export interface RunDecisionRequest {
  /** Checked against the version's input contract (422 `VALIDATION_FAILED`, paths `input.…`). */
  input: Record<string, unknown>
  /** ≤ 50 keys, ≤ 8 KiB of JSON; stored and echoed back. */
  metadata?: Record<string, JsonValue> | null
}

export interface RunDecisionOptions {
  /** 1..255 printable ASCII chars; makes retries safe for 24 h. */
  idempotencyKey?: string
}
