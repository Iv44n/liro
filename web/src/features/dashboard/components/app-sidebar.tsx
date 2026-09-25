import {
  ActivityIcon,
  InboxIcon,
  KeyRoundIcon,
  LayoutDashboardIcon,
  WebhookIcon,
  WorkflowIcon
} from 'lucide-react'
import type * as React from 'react'
import {
  NavMain,
  type NavMainItem
} from '#/features/dashboard/components/nav-main'
import { NavOrganization } from '#/features/dashboard/components/nav-organization'
import { NavUser } from '#/features/dashboard/components/nav-user'
import { TeamSwitcher } from '#/features/dashboard/components/team-switcher'
import { useReviewStats } from '#/features/reviews/hooks/use-review-stats'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail
} from '#/shared/components/ui/sidebar.tsx'

/** Badge for the pending reviews count; none when there is nothing pending. */
export function pendingReviewsBadge(
  pending: number | undefined
): NavMainItem['badge'] {
  if (!pending || pending <= 0) return undefined

  return {
    value: pending > 99 ? '99+' : pending,
    label:
      pending === 1
        ? '1 revisión pendiente'
        : `${pending} revisiones pendientes`
  }
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: reviewStats } = useReviewStats()

  const platformItems: NavMainItem[] = [
    { label: 'Dashboard', to: '/dashboard', icon: <LayoutDashboardIcon /> },
    { label: 'Decisiones', to: '/decisions', icon: <WorkflowIcon /> },
    { label: 'Ejecuciones', to: '/runs', icon: <ActivityIcon /> },
    {
      label: 'Revisión',
      to: '/reviews',
      icon: <InboxIcon />,
      badge: pendingReviewsBadge(reviewStats?.pending)
    },
    { label: 'API keys', to: '/api-keys', icon: <KeyRoundIcon /> },
    { label: 'Webhooks', to: '/webhooks', icon: <WebhookIcon /> }
  ]

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <TeamSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={platformItems} />
        <NavOrganization />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
