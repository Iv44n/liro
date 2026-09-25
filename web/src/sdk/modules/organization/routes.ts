export const routes = {
  list: '/auth/organization/list',
  create: '/auth/organization/create',
  update: '/auth/organization/update',
  delete: '/auth/organization/delete',
  setActive: '/auth/organization/set-active',
  getFullOrganization: '/auth/organization/get-full-organization',
  leave: '/auth/organization/leave',

  listMembers: '/auth/organization/list-members',
  removeMember: '/auth/organization/remove-member',
  updateMemberRole: '/auth/organization/update-member-role',
  getActiveMemberRole: '/auth/organization/get-active-member-role',

  inviteMember: '/auth/organization/invite-member',
  cancelInvitation: '/auth/organization/cancel-invitation',
  rejectInvitation: '/auth/organization/reject-invitation',
  acceptInvitation: '/auth/organization/accept-invitation',
  listInvitations: '/auth/organization/list-invitations',
  getInvitation: '/auth/organization/get-invitation',
  listUserInvitations: '/auth/organization/list-user-invitations'
} as const
