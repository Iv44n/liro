import z from 'zod'

// `KEY=` en un .env llega como '' — se trata como ausente, no como un valor.
const emptyAsMissing = (value: unknown) => (value === '' ? undefined : value)

const optionalString = z.preprocess(emptyAsMissing, z.string().optional())

const EVALUATOR_PROVIDERS = ['vercel-gateway', 'typesafe', 'fake'] as const

/** Which key each real evaluator provider needs. */
const EVALUATOR_KEYS = {
  'vercel-gateway': 'AI_GATEWAY_API_KEY',
  typesafe: 'TYPESAFE_API_KEY'
} as const

export const envSchema = z
  .object({
    PORT: z.coerce.number().default(3000),
    APP_URL: z.url().optional().default('*'),
    AUTH_SECRET: z.string(),
    AUTH_URL: z.url(),
    DATABASE_URL: z.url(),
    ENVIRONMENT: z
      .enum(['development', 'production', 'test'])
      .default('development'),
    EMAIL_PROVIDER: z.enum(['resend', 'console', 'memory']).default('resend'),
    RESEND_API_KEY: optionalString,
    EMAIL_FROM: z.string(),
    EVALUATOR_PROVIDER: z.enum(EVALUATOR_PROVIDERS).default('vercel-gateway'),
    // Tried once when the primary provider is down. Never `fake`: it would
    // answer real traffic with made-up decisions.
    EVALUATOR_FALLBACK_PROVIDER: z.preprocess(
      emptyAsMissing,
      z.enum(['vercel-gateway', 'typesafe']).optional()
    ),
    AI_GATEWAY_API_KEY: optionalString,
    TYPESAFE_API_KEY: optionalString,
    // A Jev version (`1.13.0`), a full model id (`jev-1.13.0`) or an alias
    // (`jev-latest`): a typo fails at boot instead of on every evaluation.
    JEV_MODEL_VERSION: z.preprocess(
      emptyAsMissing,
      z
        .string()
        .regex(
          /^(jev-)?(\d+\.\d+\.\d+|latest|preview)$/,
          'JEV_MODEL_VERSION must look like 1.13.0, jev-1.13.0 or jev-latest'
        )
        .optional()
    ),
    ENCRYPTION_KEY: optionalString,
    // Decrypt-only, key id `k0`: the outgoing key during an ENCRYPTION_KEY rotation.
    ENCRYPTION_KEY_PREVIOUS: optionalString,
    RUN_WORKER: z.stringbool().default(false),
    WEBHOOK_ALLOW_PRIVATE: z.stringbool().default(false)
  })
  .superRefine((env, ctx) => {
    const requireKey = (key: keyof typeof env, reason: string) => {
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} is required ${reason}`
        })
      }
    }

    if (env.EMAIL_PROVIDER === 'resend') {
      requireKey('RESEND_API_KEY', 'when EMAIL_PROVIDER=resend')
    }
    if (env.EVALUATOR_PROVIDER !== 'fake') {
      requireKey(
        EVALUATOR_KEYS[env.EVALUATOR_PROVIDER],
        `when EVALUATOR_PROVIDER=${env.EVALUATOR_PROVIDER}`
      )
    }
    const fallback = env.EVALUATOR_FALLBACK_PROVIDER
    if (fallback && env.EVALUATOR_PROVIDER === 'fake') {
      // Scripted outages in tests would otherwise reach a real provider.
      ctx.addIssue({
        code: 'custom',
        path: ['EVALUATOR_FALLBACK_PROVIDER'],
        message: 'EVALUATOR_FALLBACK_PROVIDER needs a real EVALUATOR_PROVIDER'
      })
    } else if (fallback === env.EVALUATOR_PROVIDER) {
      ctx.addIssue({
        code: 'custom',
        path: ['EVALUATOR_FALLBACK_PROVIDER'],
        message:
          'EVALUATOR_FALLBACK_PROVIDER must differ from EVALUATOR_PROVIDER'
      })
    } else if (fallback) {
      requireKey(
        EVALUATOR_KEYS[fallback],
        `when EVALUATOR_FALLBACK_PROVIDER=${fallback}`
      )
    }
  })

export type Env = z.infer<typeof envSchema>

export const env = envSchema.parse(process.env)
