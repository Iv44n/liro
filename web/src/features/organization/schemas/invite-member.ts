import { z } from 'zod'

export const invitableRoles = ['member', 'admin'] as const

export const inviteMemberSchema = z.object({
  email: z.email('Ingresa un email válido'),
  role: z.enum(invitableRoles)
})

export type InviteMemberFormData = z.infer<typeof inviteMemberSchema>
