import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import type {
  DraftConflictDetails,
  DraftWithEtag
} from '#/sdk/modules/templates/types'
import { validateDefinition } from '../schemas/definition'
import { useEditorStoreApi } from '../store/editor-context'
import { selectIsDirty } from '../store/editor-store'
import {
  draftValidationIssues,
  errorCode,
  errorDetails,
  errorText
} from '../utils/errors'
import { plural } from '../utils/format'
import { useSaveDraft } from './use-template-mutations'
import { draftQueryOptions } from './use-template-queries'

/**
 * - `saved`: the draft was saved.
 * - `clean`: nothing to save.
 * - `invalid`: not sent — a JSON editor or the structure has errors.
 * - `conflict`: someone else saved first (the conflict dialog is open).
 * - `failed`: any other error (already toasted).
 */
export type SaveResult = 'saved' | 'clean' | 'invalid' | 'conflict' | 'failed'

export interface DraftConflict {
  /** The draft's hash on the server now (`null` if unknown). */
  currentHash: string | null
}

/**
 * Saving the draft with `If-Match` and resolving `DRAFT_CONFLICT`s: reload
 * the saved draft (dropping local edits), or overwrite it with the local
 * edits after re-fetching its ETag.
 */
export function useDraftSaving(templateId: string) {
  const store = useEditorStoreApi()
  const queryClient = useQueryClient()
  const mutation = useSaveDraft(templateId)
  const [conflict, setConflict] = useState<DraftConflict | null>(null)
  const [resolving, setResolving] = useState<'reload' | 'overwrite' | null>(
    null
  )
  const inFlight = useRef<Promise<SaveResult> | null>(null)

  const run = useCallback(async (): Promise<SaveResult> => {
    const state = store.getState()
    const { definition, base, invalid } = state
    if (!definition || !base) return 'failed'

    const invalidLabels = Object.values(invalid)
    if (invalidLabels.length > 0) {
      toast.error('Hay JSON sin aplicar', {
        description: `Corrige ${invalidLabels.join(', ')} antes de guardar.`
      })
      return 'invalid'
    }
    if (!selectIsDirty(state)) return 'clean'

    const issues = validateDefinition(definition)
    if (issues.length > 0) {
      toast.error('Todavía no se puede guardar', {
        description: `${plural(issues.length, 'problema de estructura', 'problemas de estructura')}: revísalos en el panel de problemas.`
      })
      return 'invalid'
    }

    try {
      const saved = await mutation.mutateAsync({
        definition,
        etag: base.etag
      })
      store.getState().saved(saved)
      toast.success('Borrador guardado', { id: `draft-saved-${templateId}` })
      return 'saved'
    } catch (error) {
      const code = errorCode(error)
      if (code === 'DRAFT_CONFLICT') {
        const details = errorDetails<DraftConflictDetails>(error)
        setConflict({
          currentHash:
            typeof details?.currentHash === 'string'
              ? details.currentHash
              : null
        })
        return 'conflict'
      }
      if (code === 'VALIDATION_FAILED') {
        const serverIssues = draftValidationIssues(error)
        store.getState().setServerIssues(serverIssues)
        toast.error('El servidor rechazó el borrador', {
          description: `${plural(serverIssues.length, 'problema', 'problemas')} de estructura: revísalos en el panel de problemas.`
        })
        return 'invalid'
      }
      toast.error('No se pudo guardar el borrador', {
        description: errorText(error)
      })
      return 'failed'
    }
  }, [mutation, store, templateId])

  /** Saves the local changes; concurrent calls share the in-flight save. */
  const save = useCallback((): Promise<SaveResult> => {
    if (!inFlight.current) {
      inFlight.current = run().finally(() => {
        inFlight.current = null
      })
    }
    return inFlight.current
  }, [run])

  const fetchLatest = useCallback(
    (): Promise<DraftWithEtag> =>
      queryClient.fetchQuery({
        ...draftQueryOptions(templateId),
        staleTime: 0
      }),
    [queryClient, templateId]
  )

  /** Drops the local edits and loads the draft as saved on the server. */
  const reloadSaved = useCallback(async () => {
    setResolving('reload')
    try {
      store.getState().load(await fetchLatest())
      setConflict(null)
      toast.info('Se cargó el borrador guardado', {
        description: 'Tus cambios sin guardar se descartaron.'
      })
    } catch (error) {
      toast.error('No se pudo recargar el borrador', {
        description: errorText(error)
      })
    } finally {
      setResolving(null)
    }
  }, [fetchLatest, store])

  /** Re-fetches the draft's ETag and saves the local edits over it. */
  const overwrite = useCallback(async () => {
    setResolving('overwrite')
    try {
      store.getState().rebase(await fetchLatest())
      setConflict(null)
      const result = await save()
      if (result === 'clean') {
        toast.info('No había diferencias', {
          description: 'El borrador guardado ya tenía tus cambios.'
        })
      }
    } catch (error) {
      toast.error('No se pudo sobrescribir el borrador', {
        description: errorText(error)
      })
    } finally {
      setResolving(null)
    }
  }, [fetchLatest, save, store])

  return {
    save,
    isSaving: mutation.isPending,
    conflict,
    dismissConflict: () => setConflict(null),
    reloadSaved,
    overwrite,
    resolving
  }
}

export type DraftSaving = ReturnType<typeof useDraftSaving>
