import { describe, expect, test } from 'bun:test'
import { auth } from '#modules/auth/config'
import { json, testApi } from '../helpers/app'
import { createApiKey, createOrg } from '../helpers/factories'

const api = testApi()

describe('API key actor (/v1/*)', () => {
  test('accepts x-api-key and resolves the owning organization', async () => {
    const org = await createOrg()
    const { id, key } = await createApiKey(org)

    const response = await api.get('/v1/whoami', { apiKey: key })

    expect(response.status).toBe(200)
    expect(await json(response)).toEqual({
      type: 'api_key',
      organizationId: org.id,
      mode: 'live',
      apiKeyId: id
    })
  })

  test('accepts Authorization: Bearer (n8n/Zapier/Make)', async () => {
    const org = await createOrg()
    const { key } = await createApiKey(org)

    const response = await api.get('/v1/whoami', { bearer: key })

    expect(response.status).toBe(200)
    expect((await json(response)).organizationId).toBe(org.id)
  })

  test('live and test keys are distinguishable by prefix and mode', async () => {
    const org = await createOrg()
    const live = await createApiKey(org, 'live')
    const testKey = await createApiKey(org, 'test')

    expect(live.key.startsWith('lr_live_')).toBe(true)
    expect(testKey.key.startsWith('lr_test_')).toBe(true)

    const response = await api.get('/v1/whoami', { apiKey: testKey.key })
    expect((await json(response)).mode).toBe('test')
  })

  test('is not rate limited by the plugin default (10 requests/day)', async () => {
    const org = await createOrg()
    const { key } = await createApiKey(org)

    const statuses = await Promise.all(
      Array.from({ length: 15 }, () =>
        api.get('/v1/whoami', { apiKey: key }).then(r => r.status)
      )
    )

    expect(statuses.every(status => status === 200)).toBe(true)
  })

  test('rejects unknown keys in the public error format', async () => {
    const response = await api.get('/v1/whoami', {
      apiKey: 'lr_live_not-a-real-key'
    })

    expect(response.status).toBe(401)
    expect(await json(response)).toEqual({
      error: { code: 'INVALID_API_KEY', message: 'Invalid or missing API key' }
    })
  })

  test('falls back to the dashboard session when no key is sent', async () => {
    const org = await createOrg()

    const response = await api.get('/v1/whoami', { cookie: org.owner.cookie })

    expect(response.status).toBe(200)
    expect(await json(response)).toMatchObject({
      type: 'user',
      organizationId: org.id
    })
  })

  test('revoked keys stop working', async () => {
    const org = await createOrg()
    const { id, key } = await createApiKey(org)

    const revoke = await api.delete(`/api/api-keys/${id}`, {
      cookie: org.owner.cookie
    })
    expect(revoke.status).toBe(204)

    expect((await api.get('/v1/whoami', { apiKey: key })).status).toBe(401)
  })

  test("another organization can't revoke a key", async () => {
    const org = await createOrg()
    const other = await createOrg()
    const { id, key } = await createApiKey(org)

    const response = await api.delete(`/api/api-keys/${id}`, {
      cookie: other.owner.cookie
    })

    expect(response.status).toBe(404)
    expect((await api.get('/v1/whoami', { apiKey: key })).status).toBe(200)
  })

  test("a deleted organization's keys are rejected", async () => {
    const org = await createOrg()
    const { key } = await createApiKey(org)

    await auth.api.deleteOrganization({
      body: { organizationId: org.id },
      headers: new Headers({ cookie: org.owner.cookie })
    })

    expect((await api.get('/v1/whoami', { apiKey: key })).status).toBe(401)
  })
})

describe('POST /api/api-keys', () => {
  test('returns the secret once and validates the body', async () => {
    const org = await createOrg()

    const created = await api.post('/api/api-keys', {
      cookie: org.owner.cookie,
      body: { name: 'production', mode: 'test' }
    })
    expect(created.status).toBe(201)
    const body = await json(created)
    expect(body.key.startsWith('lr_test_')).toBe(true)
    expect(body.mode).toBe('test')

    const invalid = await api.post('/api/api-keys', {
      cookie: org.owner.cookie,
      body: { name: '' }
    })
    expect(invalid.status).toBe(422)
    const error = (await json(invalid)).error
    expect(error.code).toBe('VALIDATION_FAILED')
    expect(error.details.issues[0].path).toBe('name')
  })

  test('rejects non-JSON bodies', async () => {
    const org = await createOrg()

    const response = await api.post('/api/api-keys', {
      cookie: org.owner.cookie,
      body: 'not json',
      headers: { 'content-type': 'application/json' }
    })

    expect(response.status).toBe(400)
    expect((await json(response)).error.code).toBe('INVALID_JSON')
  })
})

describe('request bodies', () => {
  test('non-JSON content types are rejected with 415', async () => {
    const org = await createOrg()

    const response = await api.post('/api/api-keys', {
      cookie: org.owner.cookie,
      body: 'name=ci',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }
    })

    expect(response.status).toBe(415)
    expect((await json(response)).error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })
})
