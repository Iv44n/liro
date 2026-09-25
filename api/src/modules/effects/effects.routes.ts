import { Arcton } from '@arcton/core'
import { readJson } from '#shared/http/body'
import { requirePermission, withOrgSession } from '#shared/http/session'
import {
  createEffectBinding,
  createEffectBindingSchema,
  deleteEffectBinding,
  listEffectBindings,
  updateEffectBinding,
  updateEffectBindingSchema
} from './effects.service'

const tags = ['Effects']

/**
 * A template's effect bindings (`/api/templates/:id/effects`). Reads: any
 * member; mutations: `template:update`. Sharing `templatesModule`'s static
 * prefix (`/api/templates`) rather than the module's own — `ArctonConfig.prefix`
 * must be static, so the dynamic `:id` lives in each route path instead.
 */
export const effectsModule = Arcton({ prefix: '/api/templates' }).provide(
  withOrgSession
)

effectsModule.get('/:id/effects', {
  detail: {
    summary: "List a template's effect bindings",
    description:
      '`warnings`: labels of its latest version with no binding (`UNBOUND_LABEL`), and bindings whose `on` label no longer exists in it (`ORPHAN_BINDING`).',
    tags
  },
  handler: ({ params, organizationId }) =>
    listEffectBindings(organizationId, params.id)
})

effectsModule.post('/:id/effects', {
  detail: {
    summary: 'Create an effect binding',
    description:
      '`config`: `{ endpointId }` (webhook, same org), `{ to }` (email, verified emails of current members) or `{ webhookUrl, channel? }` (Slack, must start with the hooks.slack.com prefix — stored encrypted, never returned as-is).',
    tags
  },
  middleware: [requirePermission({ template: ['update'] })],
  handler: async ({ request, params, response, organizationId, user }) => {
    const body = await readJson(request, createEffectBindingSchema)
    const binding = await createEffectBinding(
      { organizationId, userId: user.id },
      params.id,
      body
    )
    response.status = 201
    return { binding }
  }
})

effectsModule.patch('/:id/effects/:bindingId', {
  detail: {
    summary: 'Update an effect binding',
    description:
      "`type` can't change; `config` is re-validated the same way as on create.",
    tags
  },
  middleware: [requirePermission({ template: ['update'] })],
  handler: async ({ request, params, organizationId, user }) => {
    const body = await readJson(request, updateEffectBindingSchema)
    const binding = await updateEffectBinding(
      { organizationId, userId: user.id },
      params.id,
      params.bindingId,
      body
    )
    return { binding }
  }
})

effectsModule.delete('/:id/effects/:bindingId', {
  detail: { summary: 'Delete an effect binding', tags },
  middleware: [requirePermission({ template: ['update'] })],
  handler: async ({ params, response, organizationId }) => {
    await deleteEffectBinding(organizationId, params.id, params.bindingId)
    response.status = 204
  }
})
