import { useNavigate } from '@tanstack/react-router'
import { CalendarIcon, EllipsisIcon, Trash2Icon } from 'lucide-react'
import { type KeyboardEvent, useState } from 'react'
import type { Organization } from '#/sdk/modules/organization/types'
import { Button } from '#/shared/components/ui/button'
import {
  Card,
  CardFooter,
  CardHeader,
  CardTitle
} from '#/shared/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '#/shared/components/ui/dropdown-menu.tsx'
import { cn } from '#/shared/utils/shadcn.utils'
import { useSetActiveOrganization } from '../hooks/use-set-active-organization'
import { DeleteOrganizationDialog } from './delete-organization-dialog'
import { OrganizationLogo } from './organization-logo'

const dateFormatter = new Intl.DateTimeFormat('es', {
  day: '2-digit',
  month: 'short',
  year: 'numeric'
})

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : dateFormatter.format(date)
}

export function OrganizationCard({
  organization,
  isActive
}: {
  organization: Organization
  isActive: boolean
}) {
  const navigate = useNavigate()
  const { setActive, pendingOrganizationId } = useSetActiveOrganization()
  const [confirmOpen, setConfirmOpen] = useState(false)

  const isActivating = pendingOrganizationId === organization.id

  const activate = () => {
    // La organización activa ya está seleccionada: solo navegamos al workspace.
    if (isActive) {
      navigate({ to: '/dashboard' })
      return
    }

    if (!isActivating) {
      // `setActive` redirige al workspace al completarse.
      setActive(organization.id)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      activate()
    }
  }

  return (
    <>
      <Card
        size="sm"
        role="button"
        tabIndex={0}
        aria-pressed={isActive}
        aria-label={`Usar ${organization.name}`}
        onClick={activate}
        onKeyDown={onKeyDown}
        className={cn(
          'relative flex h-full cursor-pointer flex-col rounded-lg outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-primary',
          isActive
            ? 'ring-2 ring-primary'
            : 'hover:ring-2 hover:ring-primary/40',
          isActivating && 'opacity-70'
        )}
      >
        <CardHeader>
          <div className="flex items-start gap-3">
            <OrganizationLogo organization={organization} />
            <div className="flex min-w-0 flex-1 flex-col">
              <CardTitle className="truncate">{organization.name}</CardTitle>
              <span className="truncate text-xs text-muted-foreground">
                {organization.slug}
              </span>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Acciones de la organización"
                onClick={event => event.stopPropagation()}
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="-me-2 -mt-1 shrink-0 rounded-md text-muted-foreground"
                  />
                }
              >
                <EllipsisIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onClick={event => event.stopPropagation()}
              >
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setConfirmOpen(true)}
                >
                  <Trash2Icon />
                  Eliminar organización
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>

        <CardFooter className="mt-4">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarIcon className="size-3.5" />
            {formatDate(organization.createdAt)}
          </span>
        </CardFooter>
      </Card>

      <DeleteOrganizationDialog
        organization={organization}
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
      />
    </>
  )
}
