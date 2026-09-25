import { createFileRoute } from '@tanstack/react-router'
import DashboardPage from '#/features/dashboard/pages/dashboard'

export const Route = createFileRoute('/_protected/dashboard')({
  head: () => ({ meta: [{ title: 'Dashboard · Liro' }] }),
  component: DashboardPage
})
