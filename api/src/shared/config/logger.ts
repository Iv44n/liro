import { logger } from '@arcton/logger'
import { env } from './env'

export const log = logger({
  pretty: env.ENVIRONMENT === 'development',
  // Tests assert on responses, not log lines; set LOG_LEVEL to debug them.
  level:
    (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | 'silent') ??
    (env.ENVIRONMENT === 'test' ? 'silent' : 'info')
})
