import { MailIcon } from 'lucide-react'
import { useAuth } from '#/features/auth/store/auth'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '#/shared/components/ui/card'
import { SentInvitationsList } from '../components/invitations-manager'
import { InviteMemberForm } from '../components/invite-member-form'
import { OrgPageHeader } from '../components/org-page-header'

export default function OrganizationInvitationsPage() {
  const activeOrganizationId = useAuth(
    state => state.auth?.session.activeOrganizationId
  )

  if (!activeOrganizationId) {
    return null
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <OrgPageHeader
        icon={<MailIcon />}
        title="Invitaciones"
        description="Invita personas por email y gestiona las invitaciones enviadas."
      />

      <Card>
        <CardHeader>
          <CardTitle>Invitar persona</CardTitle>
          <CardDescription>
            Se unirá a la organización cuando acepte la invitación.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteMemberForm organizationId={activeOrganizationId} />
        </CardContent>
      </Card>

      <SentInvitationsList organizationId={activeOrganizationId} />
    </div>
  )
}
