import { z } from 'zod'

export const createOrganizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'El nombre es obligatorio')
    .min(2, 'El nombre debe tener al menos 2 caracteres')
    .max(100, 'El nombre no puede superar los 100 caracteres'),
  slug: z
    .string()
    .trim()
    .min(1, 'El slug es obligatorio')
    .max(100, 'El slug no puede superar los 100 caracteres')
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'Solo minúsculas, números y guiones (sin espacios)'
    ),
  logo: z.union([z.literal(''), z.url('Ingresa una URL válida')])
})

export type CreateOrganizationFormData = z.infer<
  typeof createOrganizationSchema
>
