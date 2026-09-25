import { createFileRoute } from '@tanstack/react-router'
import WebhookDetailPage from '#/features/webhooks/pages/webhook-detail'

export const Route = createFileRoute('/_protected/webhooks/$endpointId')({
  head: () => ({ meta: [{ title: 'Webhook · Liro' }] }),
  component: RouteComponent
})

function RouteComponent() {
  const { endpointId } = Route.useParams()

  return <WebhookDetailPage endpointId={endpointId} />
}
