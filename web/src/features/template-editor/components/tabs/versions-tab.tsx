import { CircleAlertIcon, EyeIcon } from 'lucide-react'
import { useState } from 'react'
import { usePermissions } from '#/features/auth/hooks/use-me'
import type { VersionView } from '#/sdk/modules/templates/types'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '#/shared/components/ui/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from '#/shared/components/ui/empty'
import { ScrollArea } from '#/shared/components/ui/scroll-area'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { useVersionDeprecation } from '../../hooks/use-template-mutations'
import { useVersion, useVersions } from '../../hooks/use-template-queries'
import { useEditorContext, useEditorStore } from '../../store/editor-context'
import { errorText } from '../../utils/errors'
import {
  formatDateTime,
  VERSION_STATUS_DESCRIPTIONS,
  VERSION_STATUS_LABELS
} from '../../utils/format'
import { ChangesList } from '../changes-list'

function DefinitionDialog({
  templateId,
  versionId,
  onOpenChange
}: {
  templateId: string
  versionId: string | null
  onOpenChange: (open: boolean) => void
}) {
  const { data, isPending, error } = useVersion(templateId, versionId)

  return (
    <Dialog
      open={versionId !== null}
      onOpenChange={open => !open && onOpenChange(false)}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Definición {data ? `· v${data.version}` : ''}
          </DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh]">
          {isPending ? (
            <Skeleton className="h-64 w-full" />
          ) : error ? (
            <p className="text-sm text-destructive">{errorText(error)}</p>
          ) : (
            <pre className="overflow-x-auto rounded-xl bg-muted p-3 text-xs">
              {JSON.stringify(data?.definition, null, 2)}
            </pre>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

function VersionRow({
  version,
  canPublish,
  onView,
  onSetStatus,
  isPending
}: {
  version: VersionView
  canPublish: boolean
  onView: () => void
  onSetStatus: (deprecated: boolean) => void
  isPending: boolean
}) {
  return (
    <div className="space-y-2 rounded-2xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-medium">
            v{version.version}
          </span>
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
        </div>
        <Button variant="ghost" size="sm" onClick={onView}>
          <EyeIcon aria-hidden="true" />
          Ver definición
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {VERSION_STATUS_DESCRIPTIONS[version.status]}
      </p>
      <p className="text-xs text-muted-foreground">
        Publicada {formatDateTime(version.publishedAt)}
      </p>
      {version.changelog ? (
        <p className="rounded-lg bg-muted/50 px-2.5 py-1.5 text-sm">
          {version.changelog}
        </p>
      ) : null}
      {canPublish &&
      (version.status === 'published' || version.status === 'deprecated') ? (
        <Button
          variant="outline"
          size="sm"
          className="rounded-md"
          disabled={isPending}
          onClick={() => onSetStatus(version.status === 'published')}
        >
          {isPending
            ? version.status === 'published'
              ? 'Marcando…'
              : 'Reactivando…'
            : version.status === 'published'
              ? 'Marcar como obsoleta'
              : 'Reactivar'}
        </Button>
      ) : null}
    </div>
  )
}

export function VersionsTab() {
  const { templateId } = useEditorContext()
  const permissions = usePermissions()
  const { data: versions, isPending, error } = useVersions(templateId)
  const base = useEditorStore(state => state.base)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const deprecation = useVersionDeprecation(templateId)

  return (
    <div className="space-y-6">
      {base && base.draft.changes.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold">Cambios del borrador</h2>
          <p className="text-xs text-muted-foreground">
            Frente a{' '}
            {base.draft.basedOn
              ? `v${base.draft.basedOn.version}`
              : 'la última versión publicada'}
            .
          </p>
          <ChangesList changes={base.draft.changes} />
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Versiones publicadas</h2>
        {isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{errorText(error)}</p>
        ) : versions && versions.length > 0 ? (
          <div className="space-y-3">
            {versions.map(version => (
              <VersionRow
                key={version.id}
                version={version}
                canPublish={permissions?.template.publish ?? false}
                onView={() => setViewingId(version.id)}
                onSetStatus={deprecated =>
                  deprecation.mutate({ version, deprecated })
                }
                isPending={
                  deprecation.isPending &&
                  deprecation.variables?.version.id === version.id
                }
              />
            ))}
          </div>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <EyeIcon />
              </EmptyMedia>
              <EmptyTitle>Todavía no se publicó ninguna versión</EmptyTitle>
              <EmptyDescription>
                Publica el borrador cuando esté listo para que otros puedan
                ejecutarlo desde la API.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>

      <DefinitionDialog
        templateId={templateId}
        versionId={viewingId}
        onOpenChange={open => !open && setViewingId(null)}
      />
    </div>
  )
}
