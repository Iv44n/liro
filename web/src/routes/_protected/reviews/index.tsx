import { createFileRoute } from '@tanstack/react-router'
import ReviewsInboxPage from '#/features/reviews/pages/reviews-inbox'

export const Route = createFileRoute('/_protected/reviews/')({
  head: () => ({ meta: [{ title: 'Revisión · Liro' }] }),
  component: ReviewsInboxPage
})
