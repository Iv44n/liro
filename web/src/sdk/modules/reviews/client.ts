import type { HttpClient } from '#/sdk/http/http-client'
import { withQuery } from '#/sdk/http/query'
import { routes } from './routes'
import type {
  DismissReviewRequest,
  ListReviewsParams,
  ResolveReviewRequest,
  ReviewPage,
  ReviewStats,
  ReviewView
} from './types'

/** Human review inbox (`/api/reviews`). */
export function reviewsClient(http: HttpClient) {
  return {
    /** `status` defaults to `pending` (oldest first); pass `nextCursor` as `cursor`. */
    async list(params: ListReviewsParams = {}) {
      return await http.get<ReviewPage>(withQuery(routes.list, { ...params }))
    },
    /** Pending count, for the inbox badge. */
    async stats() {
      return await http.get<ReviewStats>(routes.stats)
    },
    async get(id: string) {
      const { review } = await http.get<{ review: ReviewView }>(routes.get(id))
      return review
    },
    /** 422 `INVALID_DECISION`, 409 `REVIEW_NOT_PENDING`. */
    async resolve(id: string, request: ResolveReviewRequest) {
      const { review } = await http.post<
        { review: ReviewView },
        ResolveReviewRequest
      >(routes.resolve(id), { body: request })
      return review
    },
    /** Closes without a decision. 409 `REVIEW_NOT_PENDING`. */
    async dismiss(id: string, request: DismissReviewRequest = {}) {
      const { review } = await http.post<
        { review: ReviewView },
        DismissReviewRequest
      >(routes.dismiss(id), { body: request })
      return review
    }
  }
}
