import { describe, expect, test } from 'bun:test'
import {
  generateWebhookSecret,
  signPayload,
  verifyWebhook,
  webhookHeaders
} from './signing'

describe('generateWebhookSecret', () => {
  test('starts with "whsec_" and decodes to 24 random bytes', () => {
    const secret = generateWebhookSecret()
    expect(secret.startsWith('whsec_')).toBe(true)
    expect(Buffer.from(secret.slice('whsec_'.length), 'base64').length).toBe(24)
  })

  test('is different every time', () => {
    const secrets = new Set(
      Array.from({ length: 50 }, () => generateWebhookSecret())
    )
    expect(secrets.size).toBe(50)
  })
})

describe('signPayload', () => {
  // The canonical Standard Webhooks / Svix worked example: signed_content =
  // "{id}.{timestamp}.{payload}", HMAC-SHA256 keyed with the base64-decoded
  // secret, base64-encoded and prefixed "v1,". Cross-checked independently
  // against node:crypto before being pinned here.
  test('matches the published Standard Webhooks test vector', () => {
    const signature = signPayload({
      id: 'msg_p5jXN8AQM9LWM0D4loKWxJek',
      timestamp: 1614265330,
      body: '{"test": 2432232314}',
      secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
    })
    expect(signature).toBe('v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=')
  })

  test('is deterministic for the same inputs', () => {
    const input = {
      id: 'evt_1',
      timestamp: 1_700_000_000,
      body: '{"a":1}',
      secret: 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    }
    expect(signPayload(input)).toBe(signPayload({ ...input }))
  })

  test('changes when id, timestamp, body or secret change', () => {
    const base = {
      id: 'evt_1',
      timestamp: 1_700_000_000,
      body: '{"a":1}',
      secret: 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    }
    const baseline = signPayload(base)
    expect(signPayload({ ...base, id: 'evt_2' })).not.toBe(baseline)
    expect(signPayload({ ...base, timestamp: base.timestamp + 1 })).not.toBe(
      baseline
    )
    expect(signPayload({ ...base, body: '{"a":2}' })).not.toBe(baseline)
    expect(signPayload({ ...base, secret: generateWebhookSecret() })).not.toBe(
      baseline
    )
  })

  test('accepts a secret without the "whsec_" label the same as with it', () => {
    const raw = Buffer.from('some-key-bytes-1234567890').toString('base64')
    const input = {
      id: 'evt_1',
      timestamp: 1_700_000_000,
      body: '{}'
    }
    expect(signPayload({ ...input, secret: raw })).toBe(
      signPayload({ ...input, secret: `whsec_${raw}` })
    )
  })
})

describe('webhookHeaders', () => {
  test('sets webhook-id and webhook-timestamp verbatim', () => {
    const headers = webhookHeaders({
      id: 'exec_123',
      timestamp: 1_700_000_000,
      body: '{}',
      secrets: [generateWebhookSecret()]
    })
    expect(headers['webhook-id']).toBe('exec_123')
    expect(headers['webhook-timestamp']).toBe('1700000000')
  })

  test('one signature per secret, space-separated, matching signPayload', () => {
    const id = 'exec_123'
    const timestamp = 1_700_000_000
    const body = '{"x":1}'
    const current = generateWebhookSecret()
    const previous = generateWebhookSecret()

    const headers = webhookHeaders({
      id,
      timestamp,
      body,
      secrets: [current, previous]
    })
    const signatures = headers['webhook-signature']?.split(' ') ?? []

    expect(signatures).toHaveLength(2)
    expect(signatures).toContain(
      signPayload({ id, timestamp, body, secret: current })
    )
    expect(signatures).toContain(
      signPayload({ id, timestamp, body, secret: previous })
    )
  })

  test('a single secret produces a single signature entry, no trailing space', () => {
    const headers = webhookHeaders({
      id: 'exec_1',
      timestamp: 1,
      body: '{}',
      secrets: [generateWebhookSecret()]
    })
    expect(headers['webhook-signature']?.split(' ')).toHaveLength(1)
  })
})

describe('verifyWebhook', () => {
  const secret = generateWebhookSecret()
  const id = 'exec_abc'
  const body = '{"decision":"approve"}'

  function validDelivery(
    now: Date,
    overrides: Partial<{ id: string; body: string }> = {}
  ) {
    const timestamp = Math.floor(now.getTime() / 1000)
    const usedId = overrides.id ?? id
    const usedBody = overrides.body ?? body
    return {
      headers: webhookHeaders({
        id: usedId,
        timestamp,
        body: usedBody,
        secrets: [secret]
      }),
      id: usedId,
      body: usedBody
    }
  }

  test('accepts a freshly signed delivery', () => {
    const now = new Date('2024-01-01T00:00:00Z')
    const { headers, body: signedBody } = validDelivery(now)
    expect(() =>
      verifyWebhook({ body: signedBody, headers, secret, now })
    ).not.toThrow()
  })

  test('accepts a Headers instance with mixed-case header names', () => {
    const now = new Date('2024-01-01T00:00:00Z')
    const { headers, body: signedBody } = validDelivery(now)
    const asHeaders = new Headers()
    asHeaders.set('Webhook-Id', headers['webhook-id'] ?? '')
    asHeaders.set('Webhook-Timestamp', headers['webhook-timestamp'] ?? '')
    asHeaders.set('Webhook-Signature', headers['webhook-signature'] ?? '')

    expect(() =>
      verifyWebhook({ body: signedBody, headers: asHeaders, secret, now })
    ).not.toThrow()
  })

  test('rejects a delivery signed with a different secret', () => {
    const now = new Date('2024-01-01T00:00:00Z')
    const { headers, body: signedBody } = validDelivery(now)
    expect(() =>
      verifyWebhook({
        body: signedBody,
        headers,
        secret: generateWebhookSecret(),
        now
      })
    ).toThrow(/signature verification failed/)
  })

  test('rejects a tampered body', () => {
    const now = new Date('2024-01-01T00:00:00Z')
    const { headers } = validDelivery(now)
    expect(() =>
      verifyWebhook({ body: '{"decision":"deny"}', headers, secret, now })
    ).toThrow(/signature verification failed/)
  })

  test('rejects a timestamp older than the tolerance window', () => {
    const signedAt = new Date('2024-01-01T00:00:00Z')
    const { headers, body: signedBody } = validDelivery(signedAt)
    const now = new Date(signedAt.getTime() + 301_000)
    expect(() =>
      verifyWebhook({ body: signedBody, headers, secret, now })
    ).toThrow(/tolerance window/)
  })

  test('rejects a timestamp from the future beyond the tolerance window', () => {
    const signedAt = new Date('2024-01-01T00:00:00Z')
    const { headers, body: signedBody } = validDelivery(signedAt)
    const now = new Date(signedAt.getTime() - 301_000)
    expect(() =>
      verifyWebhook({ body: signedBody, headers, secret, now })
    ).toThrow(/tolerance window/)
  })

  test('accepts a timestamp exactly at the edge of the tolerance window', () => {
    const signedAt = new Date('2024-01-01T00:00:00Z')
    const { headers, body: signedBody } = validDelivery(signedAt)
    const now = new Date(signedAt.getTime() + 300_000)
    expect(() =>
      verifyWebhook({ body: signedBody, headers, secret, now })
    ).not.toThrow()
  })

  test('honors a custom toleranceSeconds', () => {
    const signedAt = new Date('2024-01-01T00:00:00Z')
    const { headers, body: signedBody } = validDelivery(signedAt)
    const now = new Date(signedAt.getTime() + 30_000)
    expect(() =>
      verifyWebhook({
        body: signedBody,
        headers,
        secret,
        now,
        toleranceSeconds: 10
      })
    ).toThrow(/tolerance window/)
    expect(() =>
      verifyWebhook({
        body: signedBody,
        headers,
        secret,
        now,
        toleranceSeconds: 60
      })
    ).not.toThrow()
  })

  test('accepts a delivery signed with either the current or the previous secret during rotation', () => {
    const now = new Date('2024-01-01T00:00:00Z')
    const timestamp = Math.floor(now.getTime() / 1000)
    const currentSecret = generateWebhookSecret()
    const previousSecret = generateWebhookSecret()
    const headers = webhookHeaders({
      id,
      timestamp,
      body,
      secrets: [currentSecret, previousSecret]
    })

    expect(() =>
      verifyWebhook({ body, headers, secret: currentSecret, now })
    ).not.toThrow()
    expect(() =>
      verifyWebhook({ body, headers, secret: previousSecret, now })
    ).not.toThrow()
  })

  test('rejects when a header is missing', () => {
    const now = new Date('2024-01-01T00:00:00Z')
    const { headers, body: signedBody } = validDelivery(now)
    const { 'webhook-signature': _drop, ...withoutSignature } = headers
    expect(() =>
      verifyWebhook({
        body: signedBody,
        headers: withoutSignature,
        secret,
        now
      })
    ).toThrow(/Missing one or more Standard Webhooks headers/)
  })

  test('rejects a non-numeric webhook-timestamp', () => {
    const now = new Date('2024-01-01T00:00:00Z')
    const { headers, body: signedBody } = validDelivery(now)
    expect(() =>
      verifyWebhook({
        body: signedBody,
        headers: { ...headers, 'webhook-timestamp': 'not-a-number' },
        secret,
        now
      })
    ).toThrow(/Invalid webhook-timestamp/)
  })

  test('defaults `now` to the current time', () => {
    const timestamp = Math.floor(Date.now() / 1000)
    const headers = webhookHeaders({ id, timestamp, body, secrets: [secret] })
    expect(() => verifyWebhook({ body, headers, secret })).not.toThrow()
  })
})
