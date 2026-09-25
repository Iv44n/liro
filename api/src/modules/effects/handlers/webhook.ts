import { OutboundError, safeFetch } from '#modules/effects/outbound'
import { webhookHeaders } from '#modules/effects/signing'
import { decryptSecret } from '#shared/core/crypto'
import { db } from '#shared/db/config'
import type { Deliver } from './types'

/**
 * Delivers one execution to its `webhook_endpoints` row: signs the payload
 * (current secret, plus the previous one while it hasn't expired — so a
 * rotation doesn't break in-flight deliveries), then `safeFetch`s it as a
 * signed Standard Webhooks POST.
 */
export const deliverWebhook: Deliver = async (execution, ctx) => {
  if (!execution.endpointId) {
    return {
      ok: false,
      error: 'This execution has no webhook endpoint',
      permanent: true
    }
  }

  const endpoint = await db.query.webhookEndpoints.findFirst({
    where: {
      id: execution.endpointId,
      organizationId: execution.organizationId
    }
  })
  if (!endpoint) {
    return {
      ok: false,
      error: 'The webhook endpoint no longer exists',
      permanent: true
    }
  }
  if (!endpoint.enabled) {
    return {
      ok: false,
      error: 'The webhook endpoint is disabled',
      permanent: true
    }
  }

  const secrets = [decryptSecret(endpoint.secretEncrypted)]
  if (
    endpoint.previousSecretEncrypted &&
    endpoint.previousSecretExpiresAt &&
    endpoint.previousSecretExpiresAt.getTime() > ctx.now.getTime()
  ) {
    secrets.push(decryptSecret(endpoint.previousSecretEncrypted))
  }

  const body = JSON.stringify(execution.payload)
  const timestamp = Math.floor(ctx.now.getTime() / 1000)
  const headers = {
    ...webhookHeaders({ id: execution.id, timestamp, body, secrets }),
    'content-type': 'application/json',
    'user-agent': 'Liro-Webhooks/1'
  }

  try {
    const result = await safeFetch(endpoint.url, {
      method: 'POST',
      headers,
      body
    })
    const ok = result.status >= 200 && result.status < 300
    return {
      ok,
      status: result.status,
      body: result.body,
      durationMs: result.durationMs,
      ...(ok ? {} : { error: `Webhook endpoint responded ${result.status}` })
    }
  } catch (error) {
    if (error instanceof OutboundError) {
      return {
        ok: false,
        error: error.message,
        // A guard rejection (bad URL, private address, non-2xx redirect
        // target...) will never succeed on retry; a timeout or transient
        // network error might.
        permanent: error.code === 'BLOCKED'
      }
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
