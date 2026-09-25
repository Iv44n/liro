import { describe, expect, test } from 'bun:test'
import { auth } from '#modules/auth/config'
import { env } from '#shared/config/env'
import { testApi } from '../helpers/app'
import { emailsTo } from '../helpers/email'
import { createOrg } from '../helpers/factories'

const api = testApi()

describe('auth emails', () => {
  test('sign-up sends a verification email from EMAIL_FROM', async () => {
    const email = `test_signup_${Date.now()}@liro.test`

    const response = await api.post('/api/auth/sign-up/email', {
      body: { email, password: 'correct-horse-battery-staple', name: 'Sign Up' }
    })

    expect(response.status).toBe(200)
    const [message] = emailsTo(email)
    expect(message?.subject).toBe('Verify your email')
    expect(message?.from).toBe(env.EMAIL_FROM)
    expect(message?.html).toContain('/verify-email?token=')
  })

  test('unverified users cannot sign in', async () => {
    const email = `test_unverified_${Date.now()}@liro.test`
    await api.post('/api/auth/sign-up/email', {
      body: {
        email,
        password: 'correct-horse-battery-staple',
        name: 'Unverified'
      }
    })

    const response = await api.post('/api/auth/sign-in/email', {
      body: { email, password: 'correct-horse-battery-staple' }
    })

    expect(response.status).toBe(403)
  })

  test('invitations are sent from EMAIL_FROM, not from the invitee address', async () => {
    const org = await createOrg()
    const invitee = `test_invitee_${Date.now()}@liro.test`

    await auth.api.createInvitation({
      body: { email: invitee, role: 'member', organizationId: org.id },
      headers: new Headers({ cookie: org.owner.cookie })
    })

    const [message] = emailsTo(invitee)
    expect(message?.from).toBe(env.EMAIL_FROM)
    expect(message?.subject).toContain('Invitation to join')
    expect(message?.html).toContain('/accept-invitation/')
  })
})
