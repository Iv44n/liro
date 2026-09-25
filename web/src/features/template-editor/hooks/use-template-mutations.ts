import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { EffectWarning } from '#/features/effects/types'
import { useActiveOrganizationId } from '#/features/templates/hooks/use-templates'
import type { TemplateDefinition } from '#/features/templates/types/definition'
import { api } from '#/sdk'
import type {
  PublishRequest,
  TemplateView,
  UpdateTemplateRequest,
  VersionView
} from '#/sdk/modules/templates/types'
import { errorText } from '../utils/errors'
import { plural } from '../utils/format'
import {
  invalidateTemplateListings,
  templateKeys
} from './use-template-queries'

/**
 * `PUT /draft` with `If-Match`. Errors are handled by the caller (conflicts
 * open a dialog, 422s go to the lint panel), so this hook doesn't toast them.
 */
export function useSaveDraft(templateId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      definition,
      etag
    }: {
      definition: TemplateDefinition
      etag: string
    }) => api.templates.saveDraft(templateId, definition, etag),
    onSuccess: async saved => {
      queryClient.setQueryData(templateKeys.draft(templateId), saved)
      await invalidateTemplateListings(queryClient)
    }
  })
}

/** Publishes the draft. Errors are shown inside the publish dialog. */
export function usePublishDraft(templateId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: PublishRequest) =>
      api.templates.publish(templateId, request),
    onSuccess: async result => {
      const { version } = result
      toast.success(`Versión ${version.version} publicada`, {
        description: 'Ya se puede ejecutar desde la API.'
      })
      // Shared-file note (W2-B): on a major publish the API also returns
      // `effectWarnings` (bindings the new major leaves stale — an orphaned
      // label or one pinned to the superseded major). The SDK's
      // `PublishResponse` doesn't declare that field yet (`effects` is W2-A's
      // SDK scope, built concurrently), so it's read here through a local,
      // optional-cast type instead of editing
      // `src/sdk/modules/templates/types.ts`.
      const effectWarnings = (result as { effectWarnings?: EffectWarning[] })
        .effectWarnings
      if (effectWarnings && effectWarnings.length > 0) {
        toast.warning(
          `${plural(effectWarnings.length, 'aviso', 'avisos')} sobre los efectos tras el cambio de versión mayor`,
          {
            description:
              'Revisa la pestaña Efectos: puede haber vínculos a la versión anterior o etiquetas sin cubrir.'
          }
        )
      }
      await Promise.all([
        invalidateTemplateListings(queryClient),
        // The draft became the version: the next GET creates a fresh one.
        queryClient.invalidateQueries({
          queryKey: templateKeys.draft(templateId)
        })
      ])
    }
  })
}

/** `PATCH /api/templates/:id` (name, slug, description, storage). */
export function useUpdateTemplate(templateId: string) {
  const queryClient = useQueryClient()
  const organizationId = useActiveOrganizationId()
  return useMutation({
    mutationFn: (request: UpdateTemplateRequest) =>
      api.templates.update(templateId, request),
    onSuccess: async updated => {
      queryClient.setQueryData<TemplateView>(
        templateKeys.detail(organizationId, templateId),
        updated
      )
      await invalidateTemplateListings(queryClient)
      toast.success('Ajustes guardados', {
        description: `Se actualizaron los ajustes de "${updated.name}".`
      })
    }
  })
}

/** Deprecates (or restores) a published version. */
export function useVersionDeprecation(templateId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      version,
      deprecated
    }: {
      version: VersionView
      deprecated: boolean
    }) =>
      deprecated
        ? api.templates.deprecate(templateId, version.id)
        : api.templates.undeprecate(templateId, version.id),
    onSuccess: async (updated, { deprecated }) => {
      toast.success(
        deprecated
          ? `Versión ${updated.version} marcada como obsoleta`
          : `Versión ${updated.version} reactivada`
      )
      await invalidateTemplateListings(queryClient)
    },
    onError: (error: Error, { deprecated }) => {
      toast.error(
        deprecated
          ? 'No se pudo marcar la versión como obsoleta'
          : 'No se pudo reactivar la versión',
        { description: errorText(error) }
      )
    }
  })
}
