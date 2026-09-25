import { useAuth } from '#/features/auth/store/auth'
import { Card, CardContent } from '#/shared/components/ui/card'
import { Skeleton } from '#/shared/components/ui/skeleton'
import { CreateOrganizationDialog } from '../components/create-organization-dialog'
import { OrganizationCard } from '../components/organization-card'
import { PendingInvitations } from '../components/pending-invitations'
import { useOrganizations } from '../hooks/use-organizations'

export default function OrganizationsPage() {
  const { data: organizations, isLoading, isError } = useOrganizations()
  const activeOrganizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  return (
    <div className="min-h-svh w-full bg-background p-6 text-foreground md:p-10">
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold">Tus organizaciones</h1>
            <p className="text-sm text-muted-foreground">
              Selecciona una organización para trabajar o crea una nueva.
            </p>
          </div>
          <CreateOrganizationDialog />
        </header>

        <PendingInvitations />

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-36 w-full rounded-2xl" />
            <Skeleton className="h-36 w-full rounded-2xl" />
            <Skeleton className="h-36 w-full rounded-2xl" />
          </div>
        ) : isError ? (
          <Card className="rounded-md">
            <CardContent className="py-6 text-sm text-destructive">
              No se pudieron cargar las organizaciones. Recarga la página e
              inténtalo de nuevo.
            </CardContent>
          </Card>
        ) : organizations && organizations.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {organizations.map(organization => (
              <OrganizationCard
                key={organization.id}
                organization={organization}
                isActive={organization.id === activeOrganizationId}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Aún no perteneces a ninguna organización. Crea una para empezar.
          </p>
        )}
      </div>
    </div>
  )
}
