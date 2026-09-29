import { Arcton } from '@arcton/core'
import { requirePermission, withOrgSession } from '#shared/http/session'
import {
  createWebhookEndpoint,
  createWebhookEndpointSchema,
  deleteWebhookEndpoint,
  getWebhookEndpointView,
  getWebhookSecret,
  listDeliveriesQuerySchema,
  listWebhookDeliveries,
  listWebhookEndpoints,
  rotateWebhookSecret,
  testWebhookEndpoint,
  updateWebhookEndpoint,
  updateWebhookEndpointSchema
} from './effects.service'

const tags = ['Webhooks']

/** Webhook endpoints for the dashboard (`/api/webhooks`). Reads: any member; mutations: `webhook:manage`. */
export const webhooksModule = Arcton({ prefix: '/api/webhooks' }).provide(
  withOrgSession
)

webhooksModule.get('/', {
  detail: {
    summary: 'List webhook endpoints',
    description: 'Never the signing secret.',
    tags
  },
  handler: async ({ organizationId }) => ({
    data: await listWebhookEndpoints(organizationId)
  })
})

webhooksModule.post('/', {
  body: createWebhookEndpointSchema,
  detail: {
    summary: 'Create a webhook endpoint',
    description: 'The signing secret is generated here and shown once.',
    tags
  },
  middleware: [requirePermission({ webhook: ['manage'] })],
  handler: async ({ response, organizationId, user, body }) => {
    const created = await createWebhookEndpoint(
      { organizationId, userId: user.id },
      body
    )
    response.status = 201
    return created
  }
})

webhooksModule.get('/:id', {
  detail: { summary: 'Get a webhook endpoint', tags },
  handler: async ({ params, organizationId }) => ({
    endpoint: await getWebhookEndpointView(organizationId, params.id)
  })
})

webhooksModule.patch('/:id', {
  body: updateWebhookEndpointSchema,
  detail: {
    summary: 'Update a webhook endpoint',
    description:
      'A changed `url` is re-validated (SSRF guard). Setting `enabled: true` resets `failureCount` and clears `disabledReason`.',
    tags
  },
  middleware: [requirePermission({ webhook: ['manage'] })],
  handler: async ({ params, organizationId, body }) => {
    return {
      endpoint: await updateWebhookEndpoint(organizationId, params.id, body)
    }
  }
})

webhooksModule.delete('/:id', {
  detail: {
    summary: 'Delete a webhook endpoint',
    description:
      '409 `ENDPOINT_IN_USE` (with the referencing templates) if any effect binding still points at it.',
    tags
  },
  middleware: [requirePermission({ webhook: ['manage'] })],
  handler: async ({ params, response, organizationId }) => {
    await deleteWebhookEndpoint(organizationId, params.id)
    response.status = 204
  }
})

webhooksModule.get('/:id/secret', {
  detail: { summary: 'Reveal the current signing secret', tags },
  middleware: [requirePermission({ webhook: ['manage'] })],
  handler: ({ params, organizationId }) =>
    getWebhookSecret(organizationId, params.id)
})

webhooksModule.post('/:id/rotate-secret', {
  detail: {
    summary: 'Rotate the signing secret',
    description:
      'A fresh secret becomes current; the previous one stays valid for 24 hours (both signatures are sent during that window), then expires.',
    tags
  },
  middleware: [requirePermission({ webhook: ['manage'] })],
  handler: ({ params, organizationId }) =>
    rotateWebhookSecret(organizationId, params.id)
})

webhooksModule.post('/:id/test', {
  detail: {
    summary: 'Send a test event',
    description:
      'A signed `webhook.test` event, sent right now — not queued, not retried.',
    tags
  },
  middleware: [requirePermission({ webhook: ['manage'] })],
  handler: ({ params, organizationId }) =>
    testWebhookEndpoint(organizationId, params.id)
})

webhooksModule.get('/:id/deliveries', {
  query: listDeliveriesQuerySchema,
  detail: {
    summary: 'List deliveries for an endpoint',
    description:
      'Paginate by passing the previous `nextCursor` as `cursor`; `limit` ≤ 100 (default 50).',
    tags
  },
  handler: ({ params, query, organizationId }) =>
    listWebhookDeliveries(organizationId, params.id, query)
})
