import { Arcton } from '@arcton/core'
import { cors } from '@arcton/cors'
import { openapi } from '@arcton/openapi'
import { alertsModule } from '#modules/alerts/alerts.routes'
import { apiKeysModule } from '#modules/api-keys/api-keys.routes'
import { auth } from '#modules/auth/config'
import { effectsModule } from '#modules/effects/effects.routes'
import { executionsModule } from '#modules/effects/executions.routes'
import { webhooksModule } from '#modules/effects/webhooks.routes'
import { meModule, whoamiModule } from '#modules/identity/identity.routes'
import { reviewsModule } from '#modules/reviews/reviews.routes'
import { playgroundModule } from '#modules/runs/playground.routes'
import {
  publicDecisionsModule,
  publicRunsModule
} from '#modules/runs/public.routes'
import { runsModule } from '#modules/runs/runs.routes'
import { statsModule } from '#modules/stats/stats.routes'
import {
  galleryModule,
  templatesModule
} from '#modules/templates/templates.routes'
import { usageModule } from '#modules/usage/usage.routes'
import { env } from '#shared/config/env'
import { log } from '#shared/config/logger'
import { errorHandler } from '#shared/http/errors'

/** Requests larger than this are rejected with 413 (Bun's default is 128 MB). */
export const MAX_BODY_SIZE = 1024 * 1024

/**
 * Composition root: every module and cross-cutting concern, without
 * `listen()` — `index.ts` serves it, tests drive it in memory.
 */
export function createApp() {
  const app = Arcton()

  app.use(
    cors({
      origin: env.APP_URL,
      credentials: true,
      // The dashboard reads these off `/api` responses (draft ETag for
      // If-Match, and the `/v1` headers it also calls with the session).
      exposedHeaders: [
        'ETag',
        'Deprecation',
        'Warning',
        'Idempotent-Replayed',
        'Retry-After'
      ]
    })
  )
  app.use(log)
  // Turns thrown errors into responses *inside* the request logger, so an
  // expected 4xx is logged as a warn-level response instead of an
  // "unhandled error". `onError` stays as the last-resort fallback.
  app.use(async (ctx, next) => {
    try {
      return await next()
    } catch (err) {
      return errorHandler(err, ctx)
    }
  })
  app.onError(errorHandler)

  app.all('/api/auth/*path', ctx => auth.handler(ctx.request))
  app.get('/health', () => 'OK')

  // Dashboard (`/api`, session + active organization).
  app.use(meModule)
  app.use(apiKeysModule)
  app.use(templatesModule)
  app.use(playgroundModule)
  app.use(galleryModule)
  app.use(runsModule)
  app.use(reviewsModule)
  app.use(webhooksModule)
  app.use(effectsModule)
  app.use(executionsModule)
  app.use(statsModule)
  app.use(usageModule)
  app.use(alertsModule)

  // Public runtime (`/v1`, API key or session).
  app.use(whoamiModule)
  app.use(publicDecisionsModule)
  app.use(publicRunsModule)

  return app
}

export const openapiIntegration = () =>
  openapi({
    info: {
      title: 'Liro API',
      version: '1.0.0',
      description: 'Documentation of the Liro API'
    }
  })
