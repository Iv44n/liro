import { describe, expect, test } from 'bun:test'
import { json, testApi } from '../helpers/app'

const api = testApi()

describe('app', () => {
  test('health check', async () => {
    const response = await api.get('/health')

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('OK')
  })

  test('publishes the OpenAPI document with the public routes', async () => {
    const response = await api.get('/openapi.json')

    expect(response.status).toBe(200)
    const document = await json(response)
    expect(document.info.title).toBe('Liro API')
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/v1/whoami', '/api/me', '/api/api-keys'])
    )
  })

  test('unknown routes answer 404', async () => {
    expect((await api.get('/nope')).status).toBe(404)
  })

  test('bodies over the limit are rejected with 413', async () => {
    const response = await api.post('/api/api-keys', {
      body: 'x'.repeat(1024 * 1024 + 1),
      headers: { 'content-length': String(1024 * 1024 + 1) }
    })

    expect(response.status).toBe(413)
  })
})
