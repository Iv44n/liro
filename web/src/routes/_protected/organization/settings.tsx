import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuth } from '#/features/auth/store/auth'
import { activeMemberRoleQueryOptions } from '#/features/organization/hooks/use-active-member-role'
import OrganizationSettingsPage from '#/features/organization/pages/organization-settings'
import { can } from '#/features/organization/utils/permissions'

export const Route = createFileRoute('/_protected/organization/settings')({
  // Configurar la organización requiere `organization:update` (owner/admin).
  beforeLoad: async ({ context }) => {
    const activeOrganizationId =
      useAuth.getState().auth?.session.activeOrganizationId

    const { role } = await context.queryClient.ensureQueryData(
      activeMemberRoleQueryOptions(activeOrganizationId)
    )

    if (!can(role, 'org:update')) {
      throw redirect({ to: '/dashboard', replace: true })
    }
  },
  component: OrganizationSettingsPage
})
