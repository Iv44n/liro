import { Link, useNavigate } from '@tanstack/react-router'
import type { MouseEvent } from 'react'
import type { TemplateView } from '#/sdk/modules/templates/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '#/shared/components/ui/table'
import { formatDateTime, formatRelativeTime } from '../utils/format'
import { TemplateActions } from './template-actions'
import {
  ArchivedBadge,
  DraftIndicator,
  KindBadge,
  VersionSummary
} from './template-badges'

function UpdatedAt({ iso }: { iso: string }) {
  return (
    <time
      dateTime={iso}
      title={formatDateTime(iso)}
      className="whitespace-nowrap text-muted-foreground"
    >
      {formatRelativeTime(iso)}
    </time>
  )
}

/** Whether a row click came from the row itself, not a control or a portal inside it. */
function isPlainRowClick(event: MouseEvent<HTMLElement>) {
  const target = event.target as HTMLElement
  return (
    event.currentTarget.contains(target) &&
    !target.closest('a, button, [role="menuitem"], input, label')
  )
}

interface TemplatesListViewProps {
  templates: TemplateView[]
  canArchive: boolean
  /** Show the "Archivada" badge (when active and archived are listed together). */
  showStatus: boolean
}

/**
 * The templates as a table on wide screens and as cards on phones. The
 * name links to the editor; a click anywhere else on a row opens it too.
 */
export function TemplatesListView({
  templates,
  canArchive,
  showStatus
}: TemplatesListViewProps) {
  const navigate = useNavigate()

  const openEditor = (templateId: string) =>
    navigate({ to: '/decisions/$templateId', params: { templateId } })

  return (
    <>
      <div className="hidden overflow-hidden rounded-2xl ring-1 ring-foreground/10 md:block">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="ps-4">Decisión</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Versión</TableHead>
              <TableHead>Actualizada</TableHead>
              <TableHead className="w-12 pe-4">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {templates.map(template => (
              <TableRow
                key={template.id}
                className="cursor-pointer"
                onClick={event => {
                  if (isPlainRowClick(event)) void openEditor(template.id)
                }}
              >
                <TableCell className="max-w-md ps-4 whitespace-normal">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link
                        to="/decisions/$templateId"
                        params={{ templateId: template.id }}
                        className="truncate font-medium hover:underline focus-visible:underline"
                      >
                        {template.name}
                      </Link>
                      {showStatus && template.status === 'archived' ? (
                        <ArchivedBadge />
                      ) : null}
                    </span>
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {template.slug}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <KindBadge kind={template.kind} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <VersionSummary template={template} />
                    {template.latestVersion ? (
                      <DraftIndicator template={template} />
                    ) : null}
                  </div>
                </TableCell>
                <TableCell className="text-sm">
                  <UpdatedAt iso={template.updatedAt} />
                </TableCell>
                <TableCell className="pe-4 text-end">
                  <TemplateActions
                    template={template}
                    canArchive={canArchive}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="grid gap-3 md:hidden">
        {templates.map(template => (
          <li
            key={template.id}
            className="relative flex gap-3 rounded-2xl bg-card p-4 ring-1 ring-foreground/10 transition-colors focus-within:ring-ring hover:bg-muted/40"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="min-w-0">
                <Link
                  to="/decisions/$templateId"
                  params={{ templateId: template.id }}
                  className="block truncate font-medium outline-none after:absolute after:inset-0 after:rounded-2xl after:content-['']"
                >
                  {template.name}
                </Link>
                <p className="truncate font-mono text-xs text-muted-foreground">
                  {template.slug}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <KindBadge kind={template.kind} />
                {showStatus && template.status === 'archived' ? (
                  <ArchivedBadge />
                ) : null}
                <VersionSummary template={template} />
                {template.latestVersion ? (
                  <DraftIndicator template={template} />
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Actualizada <UpdatedAt iso={template.updatedAt} />
              </p>
            </div>
            <div className="relative z-10 -me-1 -mt-1 shrink-0">
              <TemplateActions template={template} canArchive={canArchive} />
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
