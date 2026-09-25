import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useOrganization } from '#/features/organization/store/organization'
import { api } from '#/sdk'
import { useAuth } from '../store/auth'

export const useSignOut = () => {
  const clearAuth = useAuth(state => state.clearAuth)
  const clearOrganizations = useOrganization(state => state.clearOrganizations)
  const queryClient = useQueryClient()
  const router = useRouter()

  const mutation = useMutation({
    mutationFn: api.auth.signOut,
    onSuccess: async () => {
      queryClient.clear()

      clearAuth()
      clearOrganizations()

      await router.invalidate({ sync: true })

      toast.success('Sesión cerrada correctamente')
    },
    onError: err => {
      toast.error('Error al cerrar sesión', {
        description: err.message || 'Error al cerrar sesión'
      })
    }
  })

  return {
    signOut: mutation.mutate,
    isPending: mutation.isPending
  }
}
