import type { HttpClient } from '#/sdk/http/http-client'
import { routes } from './routes'
import type {
  DecisionContractView,
  DecisionSummaryView,
  PublicRunView,
  RunDecisionOptions,
  RunDecisionRequest,
  Whoami
} from './types'

/**
 * The public runtime (`/v1`), called with the session cookie — the same
 * endpoints integrators call with an API key.
 */
export function v1Client(http: HttpClient) {
  return {
    async whoami() {
      return await http.get<Whoami>(routes.whoami)
    },
    decisions: {
      /** Active templates with a runnable version. */
      async list() {
        const { data } = await http.get<{ data: DecisionSummaryView[] }>(
          routes.decisions
        )
        return data
      },
      /** `ref`: `slug`, `slug@major` or `slug@major.minor`. 400 `INVALID_REF`, 404. */
      async get(ref: string) {
        return await http.get<DecisionContractView>(routes.decision(ref))
      },
      /**
       * Runs the version `ref` resolves to. A `needs_review` result creates a
       * review task; poll `runs.get(id)` for the final decision.
       */
      async run(
        ref: string,
        body: RunDecisionRequest,
        options: RunDecisionOptions = {}
      ) {
        return await http.post<PublicRunView, RunDecisionRequest>(
          routes.runDecision(ref),
          {
            body,
            headers: options.idempotencyKey
              ? { 'Idempotency-Key': options.idempotencyKey }
              : undefined
          }
        )
      }
    },
    runs: {
      async get(id: string) {
        return await http.get<PublicRunView>(routes.run(id))
      }
    }
  }
}
