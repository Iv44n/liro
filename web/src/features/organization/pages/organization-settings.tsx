import { LogOutIcon, SettingsIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { useAuth } from '#/features/auth/store/auth'
import { Button } from '#/shared/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '#/shared/components/ui/card'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { DeleteOrganizationDialog } from '../components/delete-organization-dialog'
import { LeaveOrganizationDialog } from '../components/leave-organization-dialog'
import { OrgPageHeader } from '../components/org-page-header'
import { UpdateOrganizationForm } from '../components/update-organization-form'
import { useActiveMemberRole } from '../hooks/use-active-member-role'
import { useOrganizations } from '../hooks/use-organizations'
import { can } from '../utils/permissions'

export default function OrganizationSettingsPage() {
  const activeOrganizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )
  const { data: organizations = [], isLoading } = useOrganizations()
  const { data: roleData } = useActiveMemberRole(activeOrganizationId)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const organization = organizations.find(
    item => item.id === activeOrganizationId
  )

  if (isLoading || !organization) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <Skeleton className="h-12 w-72 rounded-md" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  const canDelete = can(roleData?.role, 'org:delete')

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <OrgPageHeader
        icon={<SettingsIcon />}
        title="Configuración"
        description={`Administra los datos de "${organization.name}".`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Datos generales</CardTitle>
          <CardDescription>
            Nombre, slug y logo de la organización.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UpdateOrganizationForm organization={organization} />
        </CardContent>
      </Card>

      <Card className="ring-destructive/20">
        <CardHeader>
          <CardTitle className="text-destructive">Zona de peligro</CardTitle>
          <CardDescription>
            Acciones irreversibles sobre tu pertenencia y la organización.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 border-t pt-6">
          <Button
            variant="outline"
            className="rounded-md"
            onClick={() => setLeaveOpen(true)}
          >
            <LogOutIcon />
            Salir de la organización
          </Button>
          {canDelete ? (
            <Button
              variant="destructive"
              className="rounded-md"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2Icon />
              Eliminar organización
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <LeaveOrganizationDialog
        organization={organization}
        open={leaveOpen}
        onOpenChange={setLeaveOpen}
      />
      <DeleteOrganizationDialog
        organization={organization}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
      />
    </div>
  )
}
