import { create } from 'zustand'
import { api } from '#/sdk'

type Session = {
  user: {
    name: string
    email: string
    emailVerified: boolean
    image: string | null
    createdAt: string
    updatedAt: string
    id: string
  }
  session: {
    id: string
    token: string
    userId: string
    expiresAt: Date
    ipAddress?: string
    userAgent?: string
    createdAt: Date
    updatedAt: Date
    activeOrganizationId?: string | null
  }
}

type AuthStore = {
  auth: Session | null

  clearAuth: () => void

  refreshAuth: () => Promise<Session | null>
}

export const useAuth = create<AuthStore>(set => ({
  auth: null,

  clearAuth: () => set({ auth: null }),

  refreshAuth: async () => {
    const session = await api.auth.getSession()

    set({ auth: session })

    return session
  }
}))
