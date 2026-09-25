import type { HttpClient } from '#/sdk/http/http-client'
import { withQuery } from '#/sdk/http/query'
import { routes } from './routes'
import type { ListRunsParams, RunDetailView, RunPage } from './types'

/** Runs explorer (`/api/runs`). */
export function runsClient(http: HttpClient) {
  return {
    /** Newest first; pass the previous page's `nextCursor` as `cursor`. */
    async list(params: ListRunsParams = {}) {
      return await http.get<RunPage>(withQuery(routes.list, { ...params }))
    },
    async get(id: string) {
      const { run } = await http.get<{ run: RunDetailView }>(routes.get(id))
      return run
    }
  }
}
