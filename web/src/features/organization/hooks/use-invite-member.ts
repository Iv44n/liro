import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '#/sdk'
import type { OrganizationRole } from '#/sdk/modules/organization/types'
import { invitationsQueryKey } from './use-invitations'

type InviteMemberInput = {
  email: string
  role: OrganizationRole
  /** Reenvía la invitación si el email ya tiene una pendiente. */
  resend?: boolean
}

/**
 * Invita a un usuario por email a la organización.
 * Sirve también para reenviar una invitación pendiente (`resend: true`). Tras
 * invitar, refresca el listado de invitaciones de esa organización.
 */
export function useInviteMember(organizationId?: string) {
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: ({ email, role, resend }: InviteMemberInput) =>
      api.organization.inviteMember({
        email: email.trim(),
        role,
        resend,
        ...(organizationId ? { organizationId } : {})
      }),
    onSuccess: async (_invitation, variables) => {
      await queryClient.invalidateQueries({
        queryKey: invitationsQueryKey(organizationId)
      })

      toast.success(
        variables.resend ? 'Invitación reenviada' : 'Invitación enviada',
        {
          description: `Se envió la invitación a ${variables.email}.`
        }
      )
    },
    onError: (err: Error) => {
      toast.error('No se pudo enviar la invitación', {
        description: err.message || 'Inténtalo de nuevo.'
      })
    }
  })

  return {
    inviteMember: mutation.mutate,
    isPending: mutation.isPending
  }
}
