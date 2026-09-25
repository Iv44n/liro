import type { HttpClient } from '#/sdk/http/http-client'
import { withQuery } from '#/sdk/http/query'
import { routes } from './routes'
import type {
  CreatedWebhookEndpoint,
  CreateWebhookEndpointRequest,
  ListDeliveriesParams,
  UpdateWebhookEndpointRequest,
  WebhookDeliveriesPage,
  WebhookEndpointView,
  WebhookSecret,
  WebhookTestResult
} from './types'

/** Organization webhook endpoints and their deliveries (`/api/webhooks`). */
export function webhooksClient(http: HttpClient) {
  return {
    /** Every endpoint of the organization, alphabetically. Never the secret. */
    async list() {
      const { data } = await http.get<{ data: WebhookEndpointView[] }>(
        routes.list
      )
      return data
    },
    /** 201; the response's `secret` is shown once by the caller. */
    async create(request: CreateWebhookEndpointRequest) {
      return await http.post<
        CreatedWebhookEndpoint,
        CreateWebhookEndpointRequest
      >(routes.create, { body: request })
    },
    async get(id: string) {
      const { endpoint } = await http.get<{ endpoint: WebhookEndpointView }>(
        routes.get(id)
      )
      return endpoint
    },
    /** A changed `url` is re-validated (SSRF guard). */
    async update(id: string, request: UpdateWebhookEndpointRequest) {
      const { endpoint } = await http.patch<
        { endpoint: WebhookEndpointView },
        UpdateWebhookEndpointRequest
      >(routes.update(id), { body: request })
      return endpoint
    },
    /** 204; 409 `ENDPOINT_IN_USE` (with the referencing templates) if a binding still points at it. */
    async delete(id: string) {
      await http.delete<void>(routes.delete(id))
    },
    async secret(id: string) {
      return await http.get<WebhookSecret>(routes.secret(id))
    },
    /** The previous secret stays valid 24h more (both signatures are sent during that window). */
    async rotateSecret(id: string) {
      return await http.post<WebhookSecret>(routes.rotateSecret(id))
    },
    /** A signed `webhook.test` event, sent right now — not queued, not retried. */
    async test(id: string) {
      return await http.post<WebhookTestResult>(routes.test(id))
    },
    /** Newest first; pass the previous page's `nextCursor` as `cursor`. */
    async deliveries(id: string, params: ListDeliveriesParams = {}) {
      return await http.get<WebhookDeliveriesPage>(
        withQuery(routes.deliveries(id), { ...params })
      )
    }
  }
}
