import {
  ArchiveIcon,
  CircleAlertIcon,
  GaugeIcon,
  PencilLineIcon,
  PuzzleIcon,
  SplitIcon,
  TagsIcon
} from 'lucide-react'
import type {
  LatestVersionView,
  TemplateView
} from '#/sdk/modules/templates/types'
import { Badge } from '#/shared/components/ui/badge'
import { cn } from '#/shared/utils/shadcn.utils'
import type { TemplateKind } from '../types/definition'
import {
  formatDateTime,
  TEMPLATE_KIND_LABELS,
  VERSION_STATUS_LABELS
} from '../utils/format'

export const TEMPLATE_KIND_ICONS: Record<TemplateKind, typeof TagsIcon> = {
  classify: TagsIcon,
  decide: SplitIcon,
  score: GaugeIcon,
  custom: PuzzleIcon
}

/** What the template was created as (Clasificar, Sí/no…). */
export function KindBadge({
  kind,
  className
}: {
  kind: TemplateKind
  className?: string
}) {
  const Icon = TEMPLATE_KIND_ICONS[kind]
  return (
    <Badge variant="outline" className={className}>
      <Icon aria-hidden="true" />
      {TEMPLATE_KIND_LABELS[kind]}
    </Badge>
  )
}

function versionTitle(version: LatestVersionView) {
  const status = VERSION_STATUS_LABELS[version.status]
  return version.publishedAt
    ? `v${version.version} · ${status} el ${formatDateTime(version.publishedAt)}`
    : `v${version.version} · ${status}`
}

/** The latest released version and its status, or "Sin publicar". */
export function VersionSummary({ template }: { template: TemplateView }) {
  const version = template.latestVersion
  if (!version) {
    return <span className="text-sm text-muted-foreground">Sin publicar</span>
  }

  return (
    <span
      className="inline-flex flex-wrap items-center gap-1.5"
      title={versionTitle(version)}
    >
      <span className="font-mono text-sm tabular-nums">v{version.version}</span>
      <Badge
        variant={
          version.status === 'published'
            ? 'secondary'
            : version.status === 'model_unavailable'
              ? 'destructive'
              : 'outline'
        }
      >
        {version.status === 'model_unavailable' ? (
          <CircleAlertIcon aria-hidden="true" />
        ) : null}
        {VERSION_STATUS_LABELS[version.status]}
      </Badge>
    </span>
  )
}

/**
 * The template has an open draft: always before the first publish, and
 * after it while someone is editing (it may hold unpublished changes).
 */
export function DraftIndicator({
  template,
  className
}: {
  template: TemplateView
  className?: string
}) {
  if (!template.hasDraft) return null
  const title = template.latestVersion
    ? 'Hay un borrador abierto: puede tener cambios sin publicar.'
    : 'Todavía no se ha publicado ninguna versión.'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs text-muted-foreground',
        className
      )}
      title={title}
    >
      <PencilLineIcon className="size-3.5" aria-hidden="true" />
      Borrador
      <span className="sr-only">. {title}</span>
    </span>
  )
}

export function ArchivedBadge() {
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <ArchiveIcon aria-hidden="true" />
      Archivada
    </Badge>
  )
}
