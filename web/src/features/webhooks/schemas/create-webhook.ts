import { z } from 'zod'
import type { CreateWebhookEndpointRequest } from '#/sdk/modules/webhooks/types'

/** Mirrors the API's `createWebhookEndpointSchema` (name 1..200, description ≤ 2000). */
export const createWebhookSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Ponle un nombre al endpoint')
    .max(200, 'Máximo 200 caracteres'),
  url: z.url('Debe ser una URL válida (https://…)'),
  description: z.string().trim().max(2000, 'Máximo 2000 caracteres')
})

export type CreateWebhookFormData = z.input<typeof createWebhookSchema>

export const createWebhookDefaults: CreateWebhookFormData = {
  name: '',
  url: '',
  description: ''
}

export function toCreateWebhookRequest(
  values: CreateWebhookFormData
): CreateWebhookEndpointRequest {
  return {
    name: values.name.trim(),
    url: values.url.trim(),
    description: values.description.trim() || null
  }
}
