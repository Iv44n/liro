import { Arcton } from '@arcton/core'
import { requirePermission, withOrgSession } from '#shared/http/session'
import {
  createAlertRule,
  createAlertRuleSchema,
  deleteAlertRule,
  listAlertEvents,
  listAlertEventsQuerySchema,
  listAlertRules,
  testAlertRule,
  updateAlertRule,
  updateAlertRuleSchema
} from './alerts.service'

const tags = ['Alerts']

/** Alert rules and events for the dashboard (`/api/alerts`). Reads: any member; mutations and test sends: `webhook:manage`. */
export const alertsModule = Arcton({ prefix: '/api/alerts' }).provide(
  withOrgSession
)

alertsModule.get('/', {
  detail: { summary: 'List alert rules', tags },
  handler: ({ organizationId }) => listAlertRules(organizationId)
})

alertsModule.post('/', {
  body: createAlertRuleSchema,
  detail: {
    summary: 'Create an alert rule',
    description:
      '`templateId` omitted or `null` applies to every template. `metric`: `review_rate` | `failure_rate` (rate `threshold` in `[0, 1]`, gated by `minRuns`) or `jev_errors` | `endpoint_failing` (count `threshold`, not gated by `minRuns`). `target` is `{ to: string[] }` (verified member emails) for `channel: "email"`, or `{ endpointId }` (an existing `/api/webhooks` endpoint) for `channel: "webhook"`.',
    tags
  },
  middleware: [requirePermission({ webhook: ['manage'] })],
  handler: async ({ organizationId, user, response, body }) => {
    const rule = await createAlertRule(
      { organizationId, userId: user.id },
      body
    )
    response.status = 201
    return { rule }
  }
})

// Registered before `/:id`, which would otherwise read "events" as an id.
alertsModule.get('/events', {
  query: listAlertEventsQuerySchema,
  detail: {
    summary: 'List alert events',
    tags,
    description:
      '`ruleId` filters to one rule; newest first. Paginate by passing the previous `nextCursor` as `cursor`; `limit` ≤ 100 (default 50).'
  },
  handler: ({ organizationId, query }) => listAlertEvents(organizationId, query)
})

alertsModule.patch('/:id', {
  body: updateAlertRuleSchema,
  detail: {
    summary: 'Update an alert rule',
    description:
      'Any field may be omitted to leave it unchanged. Changing `channel` must come with a matching `target` (or vice versa) — the previous target is only reused when neither is sent.',
    tags
  },
  middleware: [requirePermission({ webhook: ['manage'] })],
  handler: async ({ params, organizationId, body }) => {
    return { rule: await updateAlertRule(organizationId, params.id, body) }
  }
})

alertsModule.delete('/:id', {
  detail: {
    summary: 'Delete an alert rule',
    description: 'Its alert events are deleted with it.',
    tags
  },
  middleware: [requirePermission({ webhook: ['manage'] })],
  handler: async ({ params, organizationId, response }) => {
    await deleteAlertRule(organizationId, params.id)
    response.status = 204
  }
})

alertsModule.post('/:id/test', {
  detail: {
    summary: 'Send a test notification',
    description:
      "Sends the rule's notification right now, using its own `threshold` as the sample value — not queued, not recorded as an alert event.",
    tags
  },
  middleware: [requirePermission({ webhook: ['manage'] })],
  handler: ({ params, organizationId }) =>
    testAlertRule(organizationId, params.id)
})
