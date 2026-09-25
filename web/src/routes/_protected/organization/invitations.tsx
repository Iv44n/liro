import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuth } from '#/features/auth/store/auth'
import { activeMemberRoleQueryOptions } from '#/features/organization/hooks/use-active-member-role'
import OrganizationInvitationsPage from '#/features/organization/pages/organization-invitations'
import { can } from '#/features/organization/utils/permissions'

export const Route = createFileRoute('/_protected/organization/invitations')({
  // Listar/gestionar invitaciones requiere `invitation:create` (owner/admin).
  beforeLoad: async ({ context }) => {
    const activeOrganizationId =
      useAuth.getState().auth?.session.activeOrganizationId

    const { role } = await context.queryClient.ensureQueryData(
      activeMemberRoleQueryOptions(activeOrganizationId)
    )

    if (!can(role, 'invitation:list')) {
      throw redirect({ to: '/dashboard', replace: true })
    }
  },
  component: OrganizationInvitationsPage
})
