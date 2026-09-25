import { createFileRoute } from '@tanstack/react-router'
import TemplatesListPage from '#/features/templates/pages/templates-list'

export const Route = createFileRoute('/_protected/decisions/')({
  head: () => ({ meta: [{ title: 'Decisiones · Liro' }] }),
  component: TemplatesListPage
})
