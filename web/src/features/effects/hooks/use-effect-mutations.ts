import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { effectsApi } from '../api/effects-client'
import type {
  CreateEffectBindingInput,
  EffectBindingView,
  UpdateEffectBindingInput
} from '../types'
import { errorText } from '../utils/errors'
import { effectBindingsQueryKey } from './use-effect-bindings'

/** `POST /api/templates/:id/effects`. */
export function useCreateEffectBinding(templateId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: CreateEffectBindingInput) =>
      effectsApi.createBinding(templateId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: effectBindingsQueryKey(templateId)
      })
      toast.success('Efecto creado')
    },
    onError: (error: Error) => {
      toast.error('No se pudo crear el efecto', {
        description: errorText(error)
      })
    }
  })
}

/** `PATCH /api/templates/:id/effects/:bindingId` — also used for the enable/disable switch. */
export function useUpdateEffectBinding(templateId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      bindingId,
      body
    }: {
      bindingId: string
      body: UpdateEffectBindingInput
    }) => effectsApi.updateBinding(templateId, bindingId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: effectBindingsQueryKey(templateId)
      })
    },
    onError: (error: Error) => {
      toast.error('No se pudo actualizar el efecto', {
        description: errorText(error)
      })
    }
  })
}

/** `DELETE /api/templates/:id/effects/:bindingId`. */
export function useDeleteEffectBinding(templateId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (binding: EffectBindingView) =>
      effectsApi.deleteBinding(templateId, binding.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: effectBindingsQueryKey(templateId)
      })
      toast.success('Efecto eliminado')
    },
    onError: (error: Error) => {
      toast.error('No se pudo eliminar el efecto', {
        description: errorText(error)
      })
    }
  })
}
