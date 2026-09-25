import type { HttpClient } from '#/sdk/http/http-client'
import { routes } from './routes'
import type { Me } from './types'

/** The current user, active organization, role and permissions (`/api/me`). */
export function meClient(http: HttpClient) {
  return {
    async get() {
      return await http.get<Me>(routes.get)
    }
  }
}
