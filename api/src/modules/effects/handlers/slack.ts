import {
  assertSlackWebhookUrl,
  OutboundError,
  safeFetch
} from '#modules/effects/outbound'
import type { EffectPayload } from '#modules/effects/payload'
import { env } from '#shared/config/env'
import { decryptSecret } from '#shared/core/crypto'
import { db } from '#shared/db/config'
import type { Deliver } from './types'

/**
 * Delivers one execution as a Slack Block Kit message: decrypts the
 * binding's webhook URL, checks it still starts with Slack's incoming-
 * webhook prefix (`assertSlackWebhookUrl` — belt and braces: the binding was
 * already checked when saved, but a stored value should never be trusted
 * blindly), then posts it.
 */

function blockKitMessage(
  payload: EffectPayload,
  channel: string | undefined
): Record<string, unknown> {
  const { run, review } = payload.data
  const decision = review?.resolvedDecision ?? run.decision ?? '—'
  const confidence =
    run.confidence === null ? '—' : `${Math.round(run.confidence * 100)}%`
  const link = `${env.APP_URL}/runs/${run.id}`

  return {
    ...(channel ? { channel } : {}),
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${payload.type}* — ${run.template}\n*Decision:* ${decision} · *Confidence:* ${confidence}\n<${link}|View run>`
        }
      }
    ]
  }
}

export const deliverSlack: Deliver = async execution => {
  if (!execution.bindingId) {
    return {
      ok: false,
      error: 'The effect binding no longer exists',
      permanent: true
    }
  }
  const binding = await db.query.effectBindings.findFirst({
    where: {
      id: execution.bindingId,
      organizationId: execution.organizationId,
      type: 'slack'
    }
  })
  if (!binding) {
    return {
      ok: false,
      error: 'The effect binding no longer exists',
      permanent: true
    }
  }

  const config = binding.config as {
    webhookUrlEncrypted: string
    channel?: string
  }
  const url = decryptSecret(config.webhookUrlEncrypted)

  try {
    assertSlackWebhookUrl(url)
  } catch (error) {
    return {
      ok: false,
      permanent: true,
      error: error instanceof Error ? error.message : String(error)
    }
  }

  const body = JSON.stringify(
    blockKitMessage(execution.payload, config.channel)
  )
  try {
    const result = await safeFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body
    })
    const ok = result.status >= 200 && result.status < 300
    return {
      ok,
      status: result.status,
      body: result.body,
      durationMs: result.durationMs,
      ...(ok ? {} : { error: `Slack responded ${result.status}` })
    }
  } catch (error) {
    if (error instanceof OutboundError) {
      return {
        ok: false,
        error: error.message,
        permanent: error.code === 'BLOCKED'
      }
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
