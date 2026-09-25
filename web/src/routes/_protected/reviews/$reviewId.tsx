import { createFileRoute } from '@tanstack/react-router'
import ReviewDetailPage from '#/features/reviews/pages/review-detail'

export const Route = createFileRoute('/_protected/reviews/$reviewId')({
  head: () => ({ meta: [{ title: 'Revisión · Liro' }] }),
  component: RouteComponent
})

function RouteComponent() {
  const { reviewId } = Route.useParams()

  return <ReviewDetailPage reviewId={reviewId} />
}
