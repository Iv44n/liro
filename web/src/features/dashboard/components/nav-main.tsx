import { Link, useRouterState } from '@tanstack/react-router'
import type * as React from 'react'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem
} from '#/shared/components/ui/sidebar.tsx'

export interface NavMainItem {
  label: string
  to: string
  icon?: React.ReactNode
  /** Shown at the end of the item (hidden when the sidebar is collapsed). */
  badge?: {
    value: React.ReactNode
    /** Accessible description, e.g. "3 revisiones pendientes". */
    label: string
  }
}

/** Whether `pathname` is `to` or one of its sub-pages (`/runs/123` → `/runs`). */
export function isNavItemActive(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`)
}

export function NavMain({ items }: { items: NavMainItem[] }) {
  const pathname = useRouterState({ select: state => state.location.pathname })

  return (
    <SidebarGroup>
      <SidebarGroupLabel>Plataforma</SidebarGroupLabel>
      <SidebarMenu>
        {items.map(item => (
          <SidebarMenuItem key={item.to}>
            <SidebarMenuButton
              tooltip={
                item.badge ? `${item.label} (${item.badge.label})` : item.label
              }
              isActive={isNavItemActive(pathname, item.to)}
              render={<Link to={item.to} />}
            >
              {item.icon}
              <span>
                {item.label}
                {item.badge ? (
                  <span className="sr-only">, {item.badge.label}</span>
                ) : null}
              </span>
            </SidebarMenuButton>
            {item.badge ? (
              <SidebarMenuBadge
                aria-hidden="true"
                className="bg-primary text-primary-foreground peer-hover/menu-button:text-primary-foreground peer-data-active/menu-button:text-primary-foreground"
              >
                {item.badge.value}
              </SidebarMenuBadge>
            ) : null}
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  )
}
