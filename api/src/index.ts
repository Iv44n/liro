import { env } from '#shared/config/env'
import { createApp, MAX_BODY_SIZE, openapiIntegration } from './app'
import { startWorker } from './worker'

createApp().listen({
  port: env.PORT,
  env: env.ENVIRONMENT,
  maxBodySize: MAX_BODY_SIZE,
  openapi: openapiIntegration()
})

// Runs the effects/jobs worker in the same process as the API, instead of
// (or alongside) the standalone `worker` service — handy for a single-dyno
// deploy or local dev without a second process.
if (env.RUN_WORKER) startWorker()
