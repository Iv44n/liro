import { apiKey } from '@better-auth/api-key'
import { drizzleAdapter } from '@better-auth/drizzle-adapter/relations-v2'
import { betterAuth } from 'better-auth/minimal'
import { openAPI, organization } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import { env } from '#shared/config/env'
import { log } from '#shared/config/logger'
import { Id } from '#shared/core/base'
import { db } from '#shared/db/config'
import { email } from '#shared/integrations/email'
import { ac, roles } from './access'
import { apikeys } from './auth.schemas'

/** Prefixes are part of the public key format — never change them. */
export const API_KEY_CONFIGS = {
  live: { configId: 'live', defaultPrefix: 'lr_live_' },
  test: { configId: 'test', defaultPrefix: 'lr_test_' }
} as const

export type ApiKeyMode = keyof typeof API_KEY_CONFIGS

export const auth = betterAuth({
  // Invalid API keys are logged at error level by the plugin; under test
  // those are expected outcomes, not failures.
  logger: { disabled: env.ENVIRONMENT === 'test' },
  secret: env.AUTH_SECRET,
  baseURL: env.AUTH_URL,
  trustedOrigins: [env.APP_URL],
  database: drizzleAdapter(db, {
    provider: 'pg',
    usePlural: true
  }),
  advanced: {
    // Without this, the cookie name (`better-auth.session_token`) collides
    // with other local apps on `localhost` — cookies aren't scoped by port,
    // so whichever app signed in last overwrites the others' session cookie.
    cookiePrefix: 'liro',
    database: {
      joins: true,
      generateId: Id.generate
    }
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      log.logger.info(`[auth] Sending reset password email to ${user.email}`)

      await email.send({
        to: user.email,
        subject: 'Reset your password',
        html: `<p>Click <a href="${url}">here</a> to reset your password.</p>`
      })
    }
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      log.logger.info(`[auth] Sending verification email to ${user.email}`)

      await email.send({
        to: user.email,
        subject: 'Verify your email',
        html: `<p>Click <a href="${url}">here</a> to verify your email.</p>`
      })
    }
  },
  plugins: [
    organization({
      ac,
      roles,
      requireEmailVerificationOnInvitation: true,
      organizationHooks: {
        // `apikeys.reference_id` has no FK to organizations, so an org's keys
        // would keep verifying after it's gone.
        afterDeleteOrganization: async ({ organization }) => {
          await db
            .delete(apikeys)
            .where(eq(apikeys.referenceId, organization.id))
        }
      },
      sendInvitationEmail: async ({ id, email: to, organization, inviter }) => {
        const inviteLink = `${env.APP_URL}/accept-invitation/${id}`

        log.logger.info(
          `[organization] Invitation for ${to} to "${organization.name}" (invited by ${inviter.user.email})`
        )

        await email.send({
          to,
          subject: `Invitation to join ${organization.name}`,
          html: `<p>Click <a href="${inviteLink}">here</a> to accept the invitation to join ${organization.name}.</p>`
        })
      }
    }),
    apiKey(
      Object.values(API_KEY_CONFIGS).map(config => ({
        ...config,
        references: 'organization' as const,
        enableMetadata: true,
        apiKeyHeaders: ['x-api-key'],
        // Liro rate-limits per organization in the evaluator gate; the
        // plugin's default (10 requests/day per key) would break real use.
        rateLimit: { enabled: false }
      }))
    ),
    openAPI()
  ]
})
