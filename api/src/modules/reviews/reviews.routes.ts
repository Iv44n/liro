import { Arcton } from '@arcton/core'
import { requirePermission, withOrgSession } from '#shared/http/session'
import {
  dismissReview,
  dismissReviewSchema,
  getReview,
  listReviews,
  listReviewsQuerySchema,
  resolveReview,
  resolveReviewSchema,
  reviewStats
} from './reviews.service'

const tags = ['Reviews']

/** Human review inbox (`/api/reviews`). */
export const reviewsModule = Arcton({ prefix: '/api/reviews' }).provide(
  withOrgSession
)

reviewsModule.get('/', {
  query: listReviewsQuerySchema,
  detail: {
    summary: 'List reviews',
    tags,
    description:
      '`status`: `pending` (default), `resolved`, `dismissed`, `expired` or `all`; `templateId` filters by template. `pending` is oldest first (a work queue); every other status is newest first. Paginate by passing the previous `nextCursor` as `cursor`; `limit` ≤ 100 (default 50).'
  },
  handler: ({ organizationId, query }) => listReviews(organizationId, query)
})

// Registered before `/:id`, which would otherwise read "stats" as an id.
reviewsModule.get('/stats', {
  detail: {
    summary: 'Count pending reviews',
    tags,
    description: 'For the inbox badge.'
  },
  handler: ({ organizationId }) => reviewStats(organizationId)
})

reviewsModule.get('/:id', {
  detail: { summary: 'Get a review', tags },
  handler: async ({ organizationId, params }) => ({
    review: await getReview(organizationId, params.id)
  })
})

reviewsModule.post('/:id/resolve', {
  body: resolveReviewSchema,
  detail: {
    summary: 'Resolve a review',
    tags,
    description:
      "Body `{ decision, comment? }`. `decision` must be one of the review's `allowedDecisions` (422 `INVALID_DECISION`). Sets the run's `finalDecision`. 409 `REVIEW_NOT_PENDING` once the review is closed — of two concurrent resolves, exactly one wins."
  },
  middleware: [requirePermission({ review: ['resolve'] })],
  handler: async ({ organizationId, params, body, user }) => ({
    review: await resolveReview(organizationId, params.id, user.id, body)
  })
})

reviewsModule.post('/:id/dismiss', {
  body: { schema: dismissReviewSchema, optional: true },
  detail: {
    summary: 'Dismiss a review',
    tags,
    description:
      "Body `{ comment? }` (optional). Closes the review without a decision: the run's `finalDecision` stays `null`. 409 `REVIEW_NOT_PENDING` once the review is closed."
  },
  middleware: [requirePermission({ review: ['resolve'] })],
  handler: async ({ organizationId, params, body, user }) => ({
    review: await dismissReview(
      organizationId,
      params.id,
      user.id,
      body ?? { comment: null }
    )
  })
})
