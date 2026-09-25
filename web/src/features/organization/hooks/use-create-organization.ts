import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuth } from '#/features/auth/store/auth'
import { api } from '#/sdk'
import { useOrganization } from '../store/organization'
import { slugify } from '../utils/slug'
import { activeMemberRoleQueryKey } from './use-active-member-role'
import { organizationsQueryKey } from './use-organizations'

/**
 * Crea una organización. El backend asigna al
 * usuario como `owner` y deja la nueva organización como activa. Tras crearla
 * se refresca la sesión y el listado, y se redirige al workspace.
 */
export function useCreateOrganization() {
  const refreshAuth = useAuth(state => state.refreshAuth)
  const refreshOrganizations = useOrganization(
    state => state.refreshOrganizations
  )
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const mutation = useMutation({
    mutationFn: (input: { name: string; slug?: string; logo?: string }) => {
      const name = input.name.trim()
      const slug = input.slug?.trim() || slugify(name)
      const logo = input.logo?.trim()

      return api.organization.create({
        name,
        slug,
        ...(logo ? { logo } : {})
      })
    },
    onSuccess: async organization => {
      await refreshAuth()

      const organizations = await refreshOrganizations()
      queryClient.setQueryData(organizationsQueryKey, organizations)

      await queryClient.invalidateQueries({
        queryKey: [activeMemberRoleQueryKey()[0]]
      })

      toast.success('Organización creada', {
        description: `"${organization.name}" es ahora tu organización activa.`
      })

      await navigate({ to: '/dashboard', replace: true })
    },
    onError: (err: Error) => {
      toast.error('No se pudo crear la organización', {
        description: err.message || 'Inténtalo de nuevo.'
      })
    }
  })

  return {
    createOrganization: mutation.mutate,
    isPending: mutation.isPending
  }
}
