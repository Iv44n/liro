import { SaveIcon, UploadIcon } from 'lucide-react'
import { Badge } from '#/shared/components/ui/badge'
import { Button } from '#/shared/components/ui/button'
import { Spinner } from '#/shared/components/ui/spinner'
import { useEditorContext, useEditorStore } from '../store/editor-context'
import { selectIsDirty } from '../store/editor-store'
import { KIND_LABELS, VERSION_STATUS_LABELS } from '../utils/format'

/**
 * Name, slug, kind and latest-version badges, plus the two actions every
 * tab shares: "Guardar" (only enabled while dirty) and "Publicar".
 */
export function EditorHeader({
  onSave,
  isSaving,
  onOpenPublish,
  canPublish
}: {
  onSave: () => void
  isSaving: boolean
  onOpenPublish: () => void
  /** `permissions.template.publish`; `readOnly` (no `template.update`) already hides both actions. */
  canPublish: boolean
}) {
  const { template, readOnly } = useEditorContext()
  const isDirty = useEditorStore(selectIsDirty)
  const latest = template.latestVersion

  return (
    <header className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {template.name}
          </h1>
          {template.status === 'archived' ? (
            <Badge variant="outline" className="text-muted-foreground">
              Archivada
            </Badge>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs">
            {template.slug}
          </code>
          <Badge variant="outline">{KIND_LABELS[template.kind]}</Badge>
          {latest ? (
            <Badge
              variant={latest.status === 'published' ? 'secondary' : 'outline'}
            >
              v{latest.version} · {VERSION_STATUS_LABELS[latest.status]}
            </Badge>
          ) : (
            <span className="text-xs">Sin publicar todavía</span>
          )}
          {isDirty ? (
            <span className="text-xs font-medium text-amber-600 dark:text-amber-500">
              Cambios sin guardar
            </span>
          ) : null}
        </div>
      </div>

      {readOnly ? (
        <p className="text-xs text-muted-foreground sm:max-w-64 sm:text-end">
          Tu rol no puede editar esta decisión: se muestra en modo lectura.
        </p>
      ) : (
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            className="rounded-md"
            onClick={onSave}
            disabled={!isDirty || isSaving}
          >
            {isSaving ? <Spinner /> : <SaveIcon aria-hidden="true" />}
            Guardar
          </Button>
          <Button
            className="rounded-md"
            onClick={onOpenPublish}
            disabled={!canPublish || isSaving}
            title={
              canPublish ? undefined : 'Tu rol no puede publicar decisiones'
            }
          >
            <UploadIcon aria-hidden="true" />
            Publicar
          </Button>
        </div>
      )}
    </header>
  )
}
