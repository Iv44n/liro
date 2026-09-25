import { createFileRoute } from '@tanstack/react-router'
import WebhooksPage from '#/features/webhooks/pages/webhooks'

export const Route = createFileRoute('/_protected/webhooks/')({
  head: () => ({ meta: [{ title: 'Webhooks · Liro' }] }),
  component: WebhooksPage
})
