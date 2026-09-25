import { Link, useLocation } from '@tanstack/react-router'
import { MailIcon, SettingsIcon, UsersIcon } from 'lucide-react'
import { useAuth } from '#/features/auth/store/auth'
import { useActiveMemberRole } from '#/features/organization/hooks/use-active-member-role'
import { can } from '#/features/organization/utils/permissions'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem
} from '#/shared/components/ui/sidebar.tsx'

export function NavOrganization() {
  const { pathname } = useLocation()
  const activeOrganizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )
  const { data: roleData } = useActiveMemberRole(activeOrganizationId)

  if (!activeOrganizationId) {
    return null
  }

  const role = roleData?.role

  const links = [
    {
      label: 'Configuración',
      to: '/organization/settings',
      icon: <SettingsIcon />,
      show: can(role, 'org:update')
    },
    {
      label: 'Miembros',
      to: '/organization/members',
      icon: <UsersIcon />,
      show: can(role, 'member:list')
    },
    {
      label: 'Invitaciones',
      to: '/organization/invitations',
      icon: <MailIcon />,
      show: can(role, 'invitation:list')
    }
  ].filter(link => link.show)

  if (links.length === 0) {
    return null
  }

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Organización</SidebarGroupLabel>
      <SidebarMenu>
        {links.map(item => (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton
              tooltip={item.label}
              isActive={pathname === item.to}
              render={<Link to={item.to} />}
            >
              {item.icon}
              <span>{item.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
