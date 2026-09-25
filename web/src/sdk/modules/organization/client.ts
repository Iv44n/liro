import type { HttpClient } from '#/sdk/http/http-client'
import { routes } from './routes'
import type {
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  ActiveMemberRoleResponse,
  CancelInvitationRequest,
  CreateOrganizationRequest,
  DeleteOrganizationRequest,
  FullOrganization,
  GetFullOrganizationParams,
  GetInvitationParams,
  Invitation,
  InvitationDetails,
  InviteMemberRequest,
  LeaveOrganizationRequest,
  ListInvitationsParams,
  ListMembersParams,
  ListMembersResponse,
  Organization,
  OrganizationMember,
  RejectInvitationRequest,
  RemoveMemberRequest,
  SetActiveOrganizationRequest,
  UpdateMemberRoleRequest,
  UpdateOrganizationRequest,
  UserInvitation
} from './types'

export function organizationClient(http: HttpClient) {
  return {
    async list() {
      const data = await http.get<Organization[]>(routes.list)
      return data ?? []
    },
    async create(request: CreateOrganizationRequest) {
      return await http.post<FullOrganization, CreateOrganizationRequest>(
        routes.create,
        {
          body: request
        }
      )
    },
    async update(request: UpdateOrganizationRequest) {
      return await http.post<Organization, UpdateOrganizationRequest>(
        routes.update,
        {
          body: request
        }
      )
    },
    async setActive(request: SetActiveOrganizationRequest) {
      return await http.post<FullOrganization, SetActiveOrganizationRequest>(
        routes.setActive,
        {
          body: request
        }
      )
    },
    async delete(request: DeleteOrganizationRequest) {
      return await http.post<Organization, DeleteOrganizationRequest>(
        routes.delete,
        {
          body: request
        }
      )
    },
    async getFullOrganization(params: GetFullOrganizationParams = {}) {
      const query = new URLSearchParams()

      if (params.organizationId) {
        query.set('organizationId', params.organizationId)
      }

      if (params.organizationSlug) {
        query.set('organizationSlug', params.organizationSlug)
      }

      const queryString = query.toString()

      return await http.get<FullOrganization>(
        queryString
          ? `${routes.getFullOrganization}?${queryString}`
          : routes.getFullOrganization
      )
    },
    async leave(request: LeaveOrganizationRequest) {
      return await http.post<unknown, LeaveOrganizationRequest>(routes.leave, {
        body: request
      })
    },

    async listMembers(params: ListMembersParams = {}) {
      const query = new URLSearchParams()

      if (params.organizationId) {
        query.set('organizationId', params.organizationId)
      }
      if (params.limit !== undefined) {
        query.set('limit', String(params.limit))
      }
      if (params.offset !== undefined) {
        query.set('offset', String(params.offset))
      }
      if (params.sortBy) {
        query.set('sortBy', params.sortBy)
      }
      if (params.sortDirection) {
        query.set('sortDirection', params.sortDirection)
      }

      const queryString = query.toString()

      const data = await http.get<ListMembersResponse>(
        queryString
          ? `${routes.listMembers}?${queryString}`
          : routes.listMembers
      )
      return data ?? { members: [], total: 0 }
    },
    async removeMember(request: RemoveMemberRequest) {
      return await http.post<
        { member: OrganizationMember },
        RemoveMemberRequest
      >(routes.removeMember, {
        body: request
      })
    },
    async updateMemberRole(request: UpdateMemberRoleRequest) {
      return await http.post<
        { member: OrganizationMember },
        UpdateMemberRoleRequest
      >(routes.updateMemberRole, {
        body: request
      })
    },
    async getActiveMemberRole() {
      return await http.get<ActiveMemberRoleResponse>(
        routes.getActiveMemberRole
      )
    },

    async inviteMember(request: InviteMemberRequest) {
      return await http.post<Invitation, InviteMemberRequest>(
        routes.inviteMember,
        {
          body: request
        }
      )
    },
    async cancelInvitation(request: CancelInvitationRequest) {
      return await http.post<Invitation, CancelInvitationRequest>(
        routes.cancelInvitation,
        {
          body: request
        }
      )
    },
    async rejectInvitation(request: RejectInvitationRequest) {
      return await http.post<Invitation, RejectInvitationRequest>(
        routes.rejectInvitation,
        {
          body: request
        }
      )
    },
    async acceptInvitation(request: AcceptInvitationRequest) {
      return await http.post<AcceptInvitationResponse, AcceptInvitationRequest>(
        routes.acceptInvitation,
        {
          body: request
        }
      )
    },
    async listInvitations(params: ListInvitationsParams = {}) {
      const query = new URLSearchParams()

      if (params.organizationId) {
        query.set('organizationId', params.organizationId)
      }

      const queryString = query.toString()

      const data = await http.get<Invitation[]>(
        queryString
          ? `${routes.listInvitations}?${queryString}`
          : routes.listInvitations
      )
      return data ?? []
    },
    async getInvitation(params: GetInvitationParams) {
      const query = new URLSearchParams({ id: params.id })

      return await http.get<InvitationDetails>(
        `${routes.getInvitation}?${query.toString()}`
      )
    },
    async listUserInvitations() {
      const data = await http.get<UserInvitation[]>(routes.listUserInvitations)
      return data ?? []
    }
  }
}
