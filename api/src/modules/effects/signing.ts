import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Signing and verification for the [Standard Webhooks](https://www.standardwebhooks.com/)
 * scheme: `webhook-id` (stable across retries — Liro uses the `effect_executions`
 * row id), `webhook-timestamp` (seconds since epoch) and `webhook-signature`
 * (one `v1,<base64 HMAC-SHA256>` entry per active secret, space-separated —
 * current plus previous while a secret is rotating; order isn't guaranteed).
 */

const SECRET_PREFIX = 'whsec_'
const SIGNATURE_VERSION = 'v1'
const DEFAULT_TOLERANCE_SECONDS = 300

/** `whsec_` + base64 of 24 random bytes (192 bits), the HMAC key for signing deliveries to one endpoint. */
export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(24).toString('base64')}`
}

/** Strips the `whsec_` label (if present) and base64-decodes the rest into raw HMAC key bytes. */
function decodeSecret(secret: string): Buffer {
  const encoded = secret.startsWith(SECRET_PREFIX)
    ? secret.slice(SECRET_PREFIX.length)
    : secret
  return Buffer.from(encoded, 'base64')
}

export interface SignPayloadInput {
  /** The `webhook-id` — stable across retries of the same delivery. */
  id: string
  /** Seconds since the Unix epoch. */
  timestamp: number
  /** The exact request body being signed, as it will be sent. */
  body: string
  secret: string
}

/** `v1,<base64 HMAC-SHA256 of "id.timestamp.body">`, keyed with `secret`'s decoded bytes. */
export function signPayload({
  id,
  timestamp,
  body,
  secret
}: SignPayloadInput): string {
  const signedContent = `${id}.${timestamp}.${body}`
  const signature = createHmac('sha256', decodeSecret(secret))
    .update(signedContent)
    .digest('base64')
  return `${SIGNATURE_VERSION},${signature}`
}

export interface WebhookHeadersInput {
  id: string
  timestamp: number
  body: string
  /** Active secrets to sign with, in any order — current, and previous while rotating. */
  secrets: string[]
}

/** The three Standard Webhooks headers, one `webhook-signature` entry per secret. */
export function webhookHeaders({
  id,
  timestamp,
  body,
  secrets
}: WebhookHeadersInput): Record<string, string> {
  return {
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': secrets
      .map(secret => signPayload({ id, timestamp, body, secret }))
      .join(' ')
  }
}

/** Case-insensitive lookup that accepts either a `Headers` instance or a plain record. */
function getHeader(
  headers: Headers | Record<string, string | undefined | null>,
  name: string
): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name && value != null) return value
  }
  return undefined
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a)
  const bufferB = Buffer.from(b)
  // Different lengths can never be equal; comparing unequal-length buffers
  // would throw, and padding them would defeat the point of a fixed-length
  // constant-time compare, so this length check is the one exception.
  if (bufferA.length !== bufferB.length) return false
  return timingSafeEqual(bufferA, bufferB)
}

export interface VerifyWebhookInput {
  body: string
  headers: Headers | Record<string, string | undefined | null>
  secret: string
  /** How far the `webhook-timestamp` may drift from `now`, in either direction. Default 300 (5 minutes), per the Standard Webhooks spec. */
  toleranceSeconds?: number
  now?: Date
}

/**
 * Verifies a received webhook: the timestamp must be within tolerance of
 * `now`, and at least one signature in `webhook-signature` must match the
 * one computed from `secret` — compared in constant time. Throws with a
 * descriptive message on any failure; callers that just want a boolean can
 * wrap the call in a try/catch.
 */
export function verifyWebhook({
  body,
  headers,
  secret,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  now = new Date()
}: VerifyWebhookInput): void {
  const id = getHeader(headers, 'webhook-id')
  const timestampHeader = getHeader(headers, 'webhook-timestamp')
  const signatureHeader = getHeader(headers, 'webhook-signature')

  if (!id || !timestampHeader || !signatureHeader) {
    throw new Error(
      'Missing one or more Standard Webhooks headers (webhook-id, webhook-timestamp, webhook-signature)'
    )
  }

  const timestamp = Number(timestampHeader)
  if (!Number.isFinite(timestamp)) {
    throw new Error(`Invalid webhook-timestamp header: "${timestampHeader}"`)
  }

  const nowSeconds = Math.floor(now.getTime() / 1000)
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) {
    throw new Error(
      `Webhook timestamp is outside the ${toleranceSeconds}s tolerance window`
    )
  }

  const expected = signPayload({ id, timestamp, body, secret })
  const candidates = signatureHeader.split(' ').filter(Boolean)
  const verified = candidates.some(candidate =>
    constantTimeEqual(candidate, expected)
  )

  if (!verified) {
    throw new Error('Webhook signature verification failed')
  }
}
