import { createFileRoute } from '@tanstack/react-router'
import RunsListPage from '#/features/runs/pages/runs-list'

export const Route = createFileRoute('/_protected/runs/')({
  head: () => ({ meta: [{ title: 'Ejecuciones · Liro' }] }),
  component: RunsListPage
})
