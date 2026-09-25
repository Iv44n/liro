import { createFileRoute } from '@tanstack/react-router'
import OrganizationMembersPage from '#/features/organization/pages/organization-members'

// Listar miembros está permitido para cualquier rol (owner/admin/member); las
// acciones dentro de la página se ocultan/validan según el rol.
export const Route = createFileRoute('/_protected/organization/members')({
  component: OrganizationMembersPage
})
