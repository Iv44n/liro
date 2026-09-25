import { describe, expect, test } from 'bun:test'
import { json, testApi } from '../helpers/app'
import {
  addMember,
  createOrg,
  createUser,
  removeMember,
  setActiveOrganization
} from '../helpers/factories'

const api = testApi()

describe('org session guard (/api/*)', () => {
  test('rejects requests without a session', async () => {
    const response = await api.get('/api/me')

    expect(response.status).toBe(401)
    expect(await json(response)).toEqual({
      error: { code: 'UNAUTHORIZED', message: 'Unauthorized' }
    })
  })

  test('rejects a session without an active organization', async () => {
    const user = await createUser()

    const response = await api.get('/api/me', { cookie: user.cookie })

    expect(response.status).toBe(403)
    expect((await json(response)).error.code).toBe('NO_ACTIVE_ORGANIZATION')
  })

  test('resolves the user, organization and role', async () => {
    const org = await createOrg()

    const response = await api.get('/api/me', { cookie: org.owner.cookie })

    expect(response.status).toBe(200)
    const body = await json(response)
    expect(body).toMatchObject({
      user: { id: org.owner.id, email: org.owner.email },
      organizationId: org.id,
      role: 'owner'
    })
    expect(body.permissions.template.publish).toBe(true)
  })

  test('a removed member loses access even with a session still pointing at the org', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    expect((await api.get('/api/me', { cookie: member.cookie })).status).toBe(
      200
    )

    // Removed by the owner: better-auth leaves the member's own session's
    // activeOrganizationId untouched.
    await removeMember(org, member)

    const response = await api.get('/api/me', { cookie: member.cookie })
    expect(response.status).toBe(403)
    expect((await json(response)).error.code).toBe('NOT_A_MEMBER')
  })

  test('a user cannot activate an organization they do not belong to', async () => {
    const org = await createOrg()
    const outsider = await createUser()

    await expect(setActiveOrganization(outsider, org.id)).rejects.toThrow()
    expect((await api.get('/api/me', { cookie: outsider.cookie })).status).toBe(
      403
    )
  })
})

describe('role permissions', () => {
  test('members cannot create API keys; admins can', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    const admin = await addMember(org, 'admin')
    const body = { name: 'ci', mode: 'live' }

    const asMember = await api.post('/api/api-keys', {
      cookie: member.cookie,
      body
    })
    expect(asMember.status).toBe(403)
    expect((await json(asMember)).error.code).toBe('FORBIDDEN')

    const asAdmin = await api.post('/api/api-keys', {
      cookie: admin.cookie,
      body
    })
    expect(asAdmin.status).toBe(201)
  })

  test('members can list keys but never see the secret', async () => {
    const org = await createOrg()
    const member = await addMember(org, 'member')
    await api.post('/api/api-keys', {
      cookie: org.owner.cookie,
      body: { name: 'ci' }
    })

    const response = await api.get('/api/api-keys', { cookie: member.cookie })

    expect(response.status).toBe(200)
    const { data } = await json(response)
    expect(data).toHaveLength(1)
    expect(data[0]).not.toHaveProperty('key')
    expect(data[0].mode).toBe('live')
  })
})
