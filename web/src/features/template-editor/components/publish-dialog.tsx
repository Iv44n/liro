import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangleIcon, CircleAlertIcon, InfoIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { hasLintErrors } from '#/features/templates/types/definition'
import type {
  BreakingChangesDetails,
  NoChangesDetails
} from '#/sdk/modules/templates/types'
import {
  Alert,
  AlertDescription,
  AlertTitle
} from '#/shared/components/ui/alert'
import { Button } from '#/shared/components/ui/button'
import { Checkbox } from '#/shared/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '#/shared/components/ui/dialog'
import { Field, FieldLabel } from '#/shared/components/ui/field'
import { ScrollArea } from '#/shared/components/ui/scroll-area'
import { Spinner } from '#/shared/components/ui/spinner'
import { Textarea } from '#/shared/components/ui/textarea'
import { usePublishDraft } from '../hooks/use-template-mutations'
import { draftQueryOptions } from '../hooks/use-template-queries'
import { useEditorStore, useEditorStoreApi } from '../store/editor-context'
import { errorCode, errorDetails, errorText } from '../utils/errors'
import { describeLintIssue } from '../utils/lint'
import { ChangesList } from './changes-list'

/**
 * Publishes the (already saved) draft: `expectedDraftHash` is its current
 * `etag`. Shows the diff against the latest version (grouped by severity),
 * requires "versión mayor" when it's breaking, and blocks on lint errors.
 * The caller only opens this once the draft has no pending edits (see the
 * editor shell's `handleOpenPublish`).
 */
export function PublishDialog({
  templateId,
  open,
  onOpenChange
}: {
  templateId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const base = useEditorStore(state => state.base)
  const store = useEditorStoreApi()
  const queryClient = useQueryClient()
  const publish = usePublishDraft(templateId)

  const [major, setMajor] = useState(false)
  const [changelog, setChangelog] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMajor(base?.draft.breaking ?? false)
    setChangelog('')
    setFormError(null)
  }, [open, base?.draft.breaking])

  if (!base) return null
  const { draft } = base
  const lintErrors = draft.lint.filter(issue => issue.severity === 'error')
  const blocked = hasLintErrors(draft.lint)
  const nextVersion = major ? draft.nextVersion.major : draft.nextVersion.minor

  const handleSubmit = async () => {
    setFormError(null)
    try {
      await publish.mutateAsync({
        expectedDraftHash: base.etag,
        major,
        ...(changelog.trim() ? { changelog: changelog.trim() } : {})
      })
      // The draft row became the version: load the fresh one the API
      // creates on demand, so the editor keeps working on a live draft.
      const fresh = await queryClient.fetchQuery({
        ...draftQueryOptions(templateId),
        staleTime: 0
      })
      store.getState().load(fresh)
      onOpenChange(false)
    } catch (error) {
      const code = errorCode(error)
      if (code === 'NO_CHANGES') {
        const details = errorDetails<NoChangesDetails>(error)
        setFormError(
          details?.version
            ? `El borrador es idéntico a la versión ${details.version} ya publicada: no hay nada que publicar.`
            : 'El borrador es idéntico a la última versión publicada.'
        )
      } else if (code === 'BREAKING_CHANGES') {
        setMajor(true)
        const details = errorDetails<BreakingChangesDetails>(error)
        setFormError(
          `El borrador tiene ${details?.changes.length ?? 'algunos'} cambios incompatibles: marca "versión mayor" para publicarlo.`
        )
      } else if (code === 'LINT_FAILED') {
        setFormError(
          'El servidor encontró errores en el borrador: revisa el panel de validación.'
        )
      } else if (code === 'DRAFT_CONFLICT') {
        setFormError(
          'El borrador cambió justo ahora. Cierra este diálogo e inténtalo de nuevo.'
        )
      } else {
        setFormError(errorText(error))
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Publicar decisión</DialogTitle>
          <DialogDescription>
            Congela el borrador guardado como la versión{' '}
            <span className="font-mono">v{nextVersion}</span>.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[50vh]">
          <div className="space-y-4 pe-3">
            {blocked ? (
              <Alert variant="destructive">
                <CircleAlertIcon aria-hidden="true" />
                <AlertTitle>El borrador tiene errores</AlertTitle>
                <AlertDescription>
                  <p>Corrígelos antes de publicar.</p>
                  <ul className="mt-1 list-disc space-y-0.5 ps-4">
                    {lintErrors.map(issue => (
                      <li key={`${issue.code}-${issue.path}-${issue.message}`}>
                        {describeLintIssue(issue).title}
                        {issue.path ? (
                          <span className="text-muted-foreground">
                            {' '}
                            · {issue.path}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}

            {draft.warnings.includes('MODEL_UNPINNED') ? (
              <Alert>
                <AlertTriangleIcon aria-hidden="true" />
                <AlertTitle>Modelo sin versión fijada</AlertTitle>
                <AlertDescription>
                  El proveedor puede cambiar el modelo en cualquier momento; el
                  comportamiento de esta decisión podría cambiar sin aviso.
                </AlertDescription>
              </Alert>
            ) : null}

            <ChangesList changes={draft.changes} />

            {draft.breaking ? (
              <Field orientation="horizontal" className="items-start">
                <Checkbox
                  id="publish-major"
                  checked={major}
                  onCheckedChange={setMajor}
                  disabled
                />
                <div>
                  <FieldLabel htmlFor="publish-major">Versión mayor</FieldLabel>
                  <p className="text-xs text-muted-foreground">
                    Obligatoria: hay cambios incompatibles (etiquetas nuevas o
                    eliminadas, entrada más estricta) que pueden romper a quien
                    ya llama a esta decisión.
                  </p>
                </div>
              </Field>
            ) : (
              <Field orientation="horizontal" className="items-start">
                <Checkbox
                  id="publish-major"
                  checked={major}
                  onCheckedChange={setMajor}
                />
                <div>
                  <FieldLabel htmlFor="publish-major">Versión mayor</FieldLabel>
                  <p className="text-xs text-muted-foreground">
                    Los cambios son compatibles: publica como versión menor (v
                    {draft.nextVersion.minor}), o marca esto para forzar una
                    mayor (v{draft.nextVersion.major}) de todos modos.
                  </p>
                </div>
              </Field>
            )}

            <Field className="gap-1.5">
              <FieldLabel htmlFor="publish-changelog">
                Notas de la versión (opcional)
              </FieldLabel>
              <Textarea
                id="publish-changelog"
                value={changelog}
                onChange={event => setChangelog(event.target.value)}
                placeholder="Qué cambió y por qué, para quien la lea después."
                rows={3}
                maxLength={2000}
              />
            </Field>

            {formError ? (
              <Alert variant="destructive">
                <InfoIcon aria-hidden="true" />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            className="rounded-md"
            onClick={() => onOpenChange(false)}
            disabled={publish.isPending}
          >
            Cancelar
          </Button>
          <Button
            className="rounded-md"
            onClick={handleSubmit}
            disabled={blocked || publish.isPending}
          >
            {publish.isPending ? <Spinner /> : null}
            Publicar v{nextVersion}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
