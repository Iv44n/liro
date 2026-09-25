import { create } from 'zustand'
import { api } from '#/sdk'
import type { Organization } from '#/sdk/modules/organization/types'

type OrganizationStore = {
  organizations: Organization[]
  hasLoaded: boolean

  setOrganizations: (organizations: Organization[]) => void

  clearOrganizations: () => void

  refreshOrganizations: () => Promise<Organization[]>
}

export const useOrganization = create<OrganizationStore>(set => ({
  organizations: [],
  hasLoaded: false,

  setOrganizations: organizations => set({ organizations, hasLoaded: true }),

  clearOrganizations: () => set({ organizations: [], hasLoaded: false }),

  refreshOrganizations: async () => {
    const organizations = await api.organization.list()

    set({ organizations, hasLoaded: true })

    return organizations
  }
}))

/**
 * Devuelve las organizaciones del usuario cargándolas una sola vez. Se usa en
 * los guards de las rutas para evitar un fetch en cada navegación; las
 * mutaciones (crear / cambiar de organización) refrescan el store de forma
 * explícita.
 */
export async function ensureOrganizations(): Promise<Organization[]> {
  const state = useOrganization.getState()

  if (state.hasLoaded) {
    return state.organizations
  }

  return state.refreshOrganizations()
}
