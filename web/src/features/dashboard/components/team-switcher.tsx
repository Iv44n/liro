import { Link } from '@tanstack/react-router'
import { CheckIcon, ChevronsUpDownIcon, Settings2Icon } from 'lucide-react'
import { useAuth } from '#/features/auth/store/auth'
import { OrganizationLogo } from '#/features/organization/components/organization-logo'
import { useOrganizations } from '#/features/organization/hooks/use-organizations'
import { useSetActiveOrganization } from '#/features/organization/hooks/use-set-active-organization'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '#/shared/components/ui/dropdown-menu.tsx'
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from '#/shared/components/ui/sidebar.tsx'

export function TeamSwitcher() {
  const { isMobile } = useSidebar()
  const { data: organizations = [] } = useOrganizations()
  const activeOrganizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )
  const { setActive } = useSetActiveOrganization({
    redirectToDashboard: false
  })

  const activeOrganization =
    organizations.find(
      organization => organization.id === activeOrganizationId
    ) ?? null

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              />
            }
          >
            <OrganizationLogo
              organization={
                activeOrganization ?? {
                  id: 'none',
                  name: 'Sin organización',
                  slug: '',
                  logo: null,
                  metadata: null,
                  createdAt: ''
                }
              }
              className="size-8"
            />
            <div className="grid flex-1 text-start text-sm leading-tight">
              <span className="truncate font-medium">
                {activeOrganization?.name ?? 'Sin organización'}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {organizations.length === 1
                  ? '1 organización'
                  : `${organizations.length} organizaciones`}
              </span>
            </div>
            <ChevronsUpDownIcon className="ms-auto" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-56 rounded-lg"
            align="start"
            side={isMobile ? 'bottom' : 'right'}
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Organizaciones
              </DropdownMenuLabel>
              {organizations.map(organization => {
                const isActive = organization.id === activeOrganizationId

                return (
                  <DropdownMenuItem
                    key={organization.id}
                    onClick={() => {
                      if (!isActive) {
                        setActive(organization.id)
                      }
                    }}
                    className="gap-2 p-2"
                  >
                    <OrganizationLogo
                      organization={organization}
                      className="size-6 rounded-md border"
                    />
                    <span className="truncate">{organization.name}</span>
                    {isActive ? <CheckIcon className="ms-auto size-4" /> : null}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                render={<Link to="/organizations" />}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <Settings2Icon className="size-4" />
                </div>
                <div className="font-medium text-muted-foreground">
                  Gestionar organizaciones
                </div>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
