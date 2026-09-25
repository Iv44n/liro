export type OrganizationRole = 'owner' | 'admin' | 'member' | (string & {})

export type InvitationStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'canceled'
  | (string & {})

export type Organization = {
  id: string
  name: string
  slug: string
  logo: string | null
  metadata: string | null
  createdAt: string
}

export type OrganizationMember = {
  id: string
  organizationId: string
  userId: string
  role: OrganizationRole
  createdAt: string
  user?: {
    id: string
    name: string
    email: string
    image: string | null
  }
}

export type Invitation = {
  id: string
  organizationId: string
  email: string
  role: OrganizationRole | null
  status: InvitationStatus
  inviterId: string
  expiresAt: string
  createdAt: string
}

/**
 * Invitación recibida por el usuario. `list-user-invitations` añade
 * `organizationName` (la organización se une en el adaptador) para poder
 * mostrar a qué organización pertenece sin más llamadas.
 */
export type UserInvitation = Invitation & {
  organizationName?: string
}

export type FullOrganization = Organization & {
  members: OrganizationMember[]
  invitations: Invitation[]
}

export type CreateOrganizationRequest = {
  name: string
  slug: string
  logo?: string | null
  metadata?: Record<string, unknown>
}

export type UpdateOrganizationRequest = {
  /** Por defecto usa la organización activa. */
  organizationId?: string
  data: {
    name?: string
    slug?: string
    logo?: string | null
    metadata?: Record<string, unknown> | null
  }
}

export type SetActiveOrganizationRequest = {
  organizationId?: string | null
  organizationSlug?: string
}

export type DeleteOrganizationRequest = {
  organizationId: string
}

export type GetFullOrganizationParams = {
  organizationId?: string
  organizationSlug?: string
}

export type LeaveOrganizationRequest = {
  organizationId: string
}

export type ListMembersParams = {
  /** Por defecto usa la organización activa. */
  organizationId?: string
  limit?: number
  offset?: number
  sortBy?: string
  sortDirection?: 'asc' | 'desc'
}

/** Respuesta de `list-members`: los miembros y el total para paginación. */
export type ListMembersResponse = {
  members: OrganizationMember[]
  total: number
}

export type RemoveMemberRequest = {
  /** ID del miembro (o su email) a eliminar. */
  memberIdOrEmail: string
  /** Por defecto usa la organización activa. */
  organizationId?: string
}

export type UpdateMemberRoleRequest = {
  role: OrganizationRole | OrganizationRole[]
  memberId: string
  /** Por defecto usa la organización activa. */
  organizationId?: string
}

/** Respuesta de `get-active-member-role`: el rol del usuario en la org activa. */
export type ActiveMemberRoleResponse = {
  role: OrganizationRole
}

export type InviteMemberRequest = {
  email: string
  role: OrganizationRole | OrganizationRole[]
  /** Por defecto usa la organización activa. */
  organizationId?: string
  /** Reenvía la invitación si el usuario ya fue invitado. */
  resend?: boolean
  teamId?: string
}

export type CancelInvitationRequest = {
  invitationId: string
}

export type RejectInvitationRequest = {
  invitationId: string
}

export type AcceptInvitationRequest = {
  invitationId: string
}

export type ListInvitationsParams = {
  /** Por defecto usa la organización activa. */
  organizationId?: string
}

export type GetInvitationParams = {
  id: string
}

/**
 * `get-invitation` enriquece la invitación con datos de la organización y de
 * quien invita, para poder mostrar la pantalla de aceptación sin más llamadas.
 */
export type InvitationDetails = Invitation & {
  organizationName: string
  organizationSlug: string
  inviterEmail: string
}

/** Respuesta de `accept-invitation`: la invitación y el miembro creado. */
export type AcceptInvitationResponse = {
  invitation: Invitation
  member: OrganizationMember
}
