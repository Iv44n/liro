import type { HttpClient } from '#/sdk/http/http-client'
import { routes } from './routes'
import type { ApiKeyView, CreateApiKeyRequest, CreatedApiKey } from './types'

/** Organization API keys for `/v1` (`/api/api-keys`). */
export function apiKeysClient(http: HttpClient) {
  return {
    /** Newest first. */
    async list() {
      const { data } = await http.get<{ data: ApiKeyView[] }>(routes.list)
      return data
    },
    /** 201; the response's `key` is shown once. */
    async create(request: CreateApiKeyRequest) {
      return await http.post<CreatedApiKey, CreateApiKeyRequest>(
        routes.create,
        { body: request }
      )
    },
    /** 204; 404 `NOT_FOUND` for a key of another organization. */
    async revoke(id: string) {
      await http.delete<void>(routes.revoke(id))
    }
  }
}
