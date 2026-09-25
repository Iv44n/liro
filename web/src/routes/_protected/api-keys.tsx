import { createFileRoute } from '@tanstack/react-router'
import ApiKeysPage from '#/features/api-keys/pages/api-keys'

export const Route = createFileRoute('/_protected/api-keys')({
  head: () => ({ meta: [{ title: 'API keys · Liro' }] }),
  component: ApiKeysPage
})
