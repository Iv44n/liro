import { Link } from '@tanstack/react-router'
import {
  ActivityIcon,
  InboxIcon,
  KeyRoundIcon,
  PlusIcon,
  WorkflowIcon
} from 'lucide-react'
import { useApiKeys } from '#/features/api-keys/hooks/use-api-keys'
import { usePermissions } from '#/features/auth/hooks/use-me'
import { useAuth } from '#/features/auth/store/auth'
import { useReviewStats } from '#/features/reviews/hooks/use-review-stats'
import {
  useHasApiRuns,
  useRecentRunsStats
} from '#/features/runs/hooks/use-run-stats'
import { formatNumber } from '#/features/runs/utils/format'
import { useTemplates } from '#/features/templates/hooks/use-templates'
import { Button } from '#/shared/components/ui/button'
import type { ChecklistStep } from '../components/getting-started-checklist'
import { GettingStartedChecklist } from '../components/getting-started-checklist'
import { StatCard } from '../components/stat-card'

/** `/dashboard`: quick stats, shortcuts and the onboarding checklist. */
export default function DashboardPage() {
  const user = useAuth(state => state.auth?.user)
  const permissions = usePermissions()
  const canCreateTemplate = permissions?.template.create ?? false
  const canCreateApiKey = permissions?.apiKey.create ?? false

  const templates = useTemplates('active')
  const reviewStats = useReviewStats()
  const recentRuns = useRecentRunsStats()
  const apiKeys = useApiKeys()
  const hasApiRuns = useHasApiRuns()

  const templatesCount = templates.data?.length ?? 0
  const publishedCount =
    templates.data?.filter(template => template.latestVersion !== null)
      .length ?? 0
  const apiKeysCount = apiKeys.data?.length ?? 0

  const checklistLoading =
    templates.isPending || apiKeys.isPending || hasApiRuns.isPending

  const steps: ChecklistStep[] = [
    {
      title: 'Crea tu primera decisión',
      description: 'Elige una plantilla, la galería o empieza en blanco.',
      done: templatesCount > 0,
      to: canCreateTemplate ? '/decisions/new' : undefined
    },
    {
      title: 'Publícala',
      description: 'Sin publicar, solo funciona en el playground.',
      done: publishedCount > 0,
      to: '/decisions'
    },
    {
      title: 'Crea una API key',
      description: 'Con ella tu backend puede llamar a Liro.',
      done: apiKeysCount > 0,
      to: canCreateApiKey ? '/api-keys' : undefined
    },
    {
      title: 'Haz tu primera ejecución',
      description: 'Llama a `/v1/decisions/:ref/run` con tu API key.',
      done: hasApiRuns.data ?? false,
      to: '/decisions'
    }
  ]

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          Hola, {user?.name || user?.email || 'de nuevo'}
        </h1>
        <p className="text-sm text-muted-foreground">
          Este es el panel de tu organización en Liro.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          icon={<WorkflowIcon aria-hidden="true" />}
          label="Decisiones activas"
          value={formatNumber(templatesCount, 0)}
          loading={templates.isPending}
        />
        <StatCard
          icon={<InboxIcon aria-hidden="true" />}
          label="Revisiones pendientes"
          value={formatNumber(reviewStats.data?.pending ?? 0, 0)}
          loading={reviewStats.isPending}
          tone={
            reviewStats.data && reviewStats.data.pending > 0
              ? 'warning'
              : 'default'
          }
        />
        <StatCard
          icon={<ActivityIcon aria-hidden="true" />}
          label="Ejecuciones (24 h)"
          value={
            recentRuns.data
              ? `${recentRuns.data.more ? '+' : ''}${formatNumber(recentRuns.data.count, 0)}`
              : '0'
          }
          hint={
            recentRuns.data && recentRuns.data.needsReview > 0
              ? `${formatNumber(recentRuns.data.needsReview, 0)} a revisión`
              : undefined
          }
          loading={recentRuns.isPending}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {canCreateTemplate ? (
          <Button nativeButton={false} render={<Link to="/decisions/new" />}>
            <PlusIcon aria-hidden="true" />
            Nueva decisión
          </Button>
        ) : null}
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/reviews" />}
        >
          <InboxIcon aria-hidden="true" />
          Revisión
        </Button>
        <Button
          variant="outline"
          nativeButton={false}
          render={<Link to="/api-keys" />}
        >
          <KeyRoundIcon aria-hidden="true" />
          API keys
        </Button>
      </div>

      <GettingStartedChecklist steps={steps} loading={checklistLoading} />
    </div>
  )
}
