import type { HttpClient } from '#/sdk/http/http-client'
import { routes } from './routes'
import type { GalleryItemView } from './types'

/** Ready-made templates (`/api/gallery`). */
export function galleryClient(http: HttpClient) {
  return {
    async list() {
      const { data } = await http.get<{ data: GalleryItemView[] }>(routes.list)
      return data
    }
  }
}
