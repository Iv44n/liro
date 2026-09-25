import { z } from 'zod'

export const loginSchema = z.object({
  email: z.email('Ingrese un correo válido'),

  password: z
    .string()
    .trim()
    .min(1, 'La contraseña es obligatoria')
    .min(8, 'La contraseña debe tener mínimo 8 caracteres')
})

export type LoginFormData = z.infer<typeof loginSchema>
