import { createFileRoute } from '@tanstack/react-router'
import RunDetailPage from '#/features/runs/pages/run-detail'

export const Route = createFileRoute('/_protected/runs/$runId')({
  head: () => ({ meta: [{ title: 'Ejecución · Liro' }] }),
  component: RouteComponent
})

function RouteComponent() {
  const { runId } = Route.useParams()

  return <RunDetailPage runId={runId} />
}
