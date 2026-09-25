import { z } from 'zod'

export const forgotPasswordSchema = z.object({
  email: z.email('Ingrese un correo válido')
})

export type ForgotPasswordFormData = z.infer<typeof forgotPasswordSchema>
