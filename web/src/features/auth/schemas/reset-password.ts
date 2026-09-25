import { z } from 'zod'

export const resetPasswordSchema = z
  .object({
    password: z
      .string()
      .trim()
      .min(8, 'La contraseña debe tener mínimo 8 caracteres'),
    confirmPassword: z.string().trim().min(1, 'Confirma tu contraseña')
  })
  .refine(data => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword']
  })

export type ResetPasswordFormData = z.infer<typeof resetPasswordSchema>
