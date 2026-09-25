import { z } from 'zod'

export const registerSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'El nombre es obligatorio')
      .min(2, 'El nombre debe tener al menos 2 caracteres'),
    email: z.email('Ingrese un correo válido'),
    password: z
      .string()
      .trim()
      .min(8, 'La contraseña debe tener mínimo 8 caracteres'),
    confirmPassword: z.string().trim()
  })
  .refine(data => data.password === data.confirmPassword, {
    message: 'Las contraseñas no coinciden',
    path: ['confirmPassword']
  })

export type RegisterFormData = z.infer<typeof registerSchema>
