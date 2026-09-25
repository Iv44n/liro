import { describe, expect, test } from 'bun:test'
import { envSchema } from './env'

const base = {
  AUTH_SECRET: 'secret',
  AUTH_URL: 'http://localhost:3002',
  DATABASE_URL: 'postgresql://user:pass@localhost:5434/liro_db',
  EMAIL_FROM: 'Liro <test@liro.local>'
}

const issuesFor = (input: Record<string, string>) => {
  const result = envSchema.safeParse(input)
  return result.success
    ? []
    : result.error.issues.map(issue => issue.path.join('.'))
}

describe('envSchema', () => {
  test('applies defaults', () => {
    const env = envSchema.parse({
      ...base,
      RESEND_API_KEY: 're_x',
      AI_GATEWAY_API_KEY: 'gw_x'
    })

    expect(env).toMatchObject({
      PORT: 3000,
      ENVIRONMENT: 'development',
      EMAIL_PROVIDER: 'resend',
      EVALUATOR_PROVIDER: 'vercel-gateway',
      RUN_WORKER: false,
      WEBHOOK_ALLOW_PRIVATE: false
    })
  })

  test('requires the key of the selected providers', () => {
    expect(issuesFor(base)).toEqual(['RESEND_API_KEY', 'AI_GATEWAY_API_KEY'])
    expect(
      issuesFor({
        ...base,
        EMAIL_PROVIDER: 'console',
        EVALUATOR_PROVIDER: 'typesafe'
      })
    ).toEqual(['TYPESAFE_API_KEY'])
  })

  test('treats empty values as missing', () => {
    expect(
      issuesFor({ ...base, EMAIL_PROVIDER: 'memory', AI_GATEWAY_API_KEY: '' })
    ).toEqual(['AI_GATEWAY_API_KEY'])
  })

  test('fake evaluator and memory email need no keys', () => {
    expect(
      issuesFor({
        ...base,
        EMAIL_PROVIDER: 'memory',
        EVALUATOR_PROVIDER: 'fake'
      })
    ).toEqual([])
  })

  test('a fallback evaluator must differ from the primary and have its key', () => {
    const typesafe = {
      ...base,
      EMAIL_PROVIDER: 'memory',
      EVALUATOR_PROVIDER: 'typesafe',
      TYPESAFE_API_KEY: 'ts_x'
    }

    expect(
      issuesFor({ ...typesafe, EVALUATOR_FALLBACK_PROVIDER: 'typesafe' })
    ).toEqual(['EVALUATOR_FALLBACK_PROVIDER'])
    expect(
      issuesFor({ ...typesafe, EVALUATOR_FALLBACK_PROVIDER: 'vercel-gateway' })
    ).toEqual(['AI_GATEWAY_API_KEY'])

    const env = envSchema.parse({
      ...typesafe,
      EVALUATOR_FALLBACK_PROVIDER: 'vercel-gateway',
      AI_GATEWAY_API_KEY: 'gw_x',
      JEV_MODEL_VERSION: '1.13.0'
    })
    expect(env).toMatchObject({
      EVALUATOR_PROVIDER: 'typesafe',
      EVALUATOR_FALLBACK_PROVIDER: 'vercel-gateway',
      JEV_MODEL_VERSION: '1.13.0'
    })
  })

  test('the fallback is optional and never the fake evaluator', () => {
    const gateway = {
      ...base,
      EMAIL_PROVIDER: 'memory',
      AI_GATEWAY_API_KEY: 'gw_x'
    }

    expect(envSchema.parse(gateway).EVALUATOR_FALLBACK_PROVIDER).toBeUndefined()
    expect(
      envSchema.parse({ ...gateway, EVALUATOR_FALLBACK_PROVIDER: '' })
        .EVALUATOR_FALLBACK_PROVIDER
    ).toBeUndefined()
    expect(
      issuesFor({ ...gateway, EVALUATOR_FALLBACK_PROVIDER: 'fake' })
    ).toEqual(['EVALUATOR_FALLBACK_PROVIDER'])
    expect(
      issuesFor({
        ...gateway,
        EVALUATOR_FALLBACK_PROVIDER: 'typesafe',
        TYPESAFE_API_KEY: 'ts_x'
      })
    ).toEqual([])
  })

  test('a fake primary takes no real fallback', () => {
    expect(
      issuesFor({
        ...base,
        EMAIL_PROVIDER: 'memory',
        EVALUATOR_PROVIDER: 'fake',
        EVALUATOR_FALLBACK_PROVIDER: 'typesafe',
        TYPESAFE_API_KEY: 'ts_x'
      })
    ).toEqual(['EVALUATOR_FALLBACK_PROVIDER'])
  })

  test('JEV_MODEL_VERSION takes a version, a model id or an alias', () => {
    const typesafe = {
      ...base,
      EMAIL_PROVIDER: 'memory',
      EVALUATOR_PROVIDER: 'typesafe',
      TYPESAFE_API_KEY: 'ts_x'
    }

    for (const version of ['1.13.0', 'jev-1.13.0', 'jev-latest', '']) {
      expect(issuesFor({ ...typesafe, JEV_MODEL_VERSION: version })).toEqual([])
    }
    for (const version of ['1.13', 'v1.13.0', ' 1.13.0', 'jev-jev-1.13.0']) {
      expect(issuesFor({ ...typesafe, JEV_MODEL_VERSION: version })).toEqual([
        'JEV_MODEL_VERSION'
      ])
    }
  })

  test('ENCRYPTION_KEY_PREVIOUS is optional and empty is treated as missing', () => {
    const gateway = {
      ...base,
      EMAIL_PROVIDER: 'memory',
      EVALUATOR_PROVIDER: 'fake'
    }

    expect(envSchema.parse(gateway).ENCRYPTION_KEY_PREVIOUS).toBeUndefined()
    expect(
      envSchema.parse({ ...gateway, ENCRYPTION_KEY_PREVIOUS: 'old-key' })
        .ENCRYPTION_KEY_PREVIOUS
    ).toBe('old-key')
    expect(
      envSchema.parse({ ...gateway, ENCRYPTION_KEY_PREVIOUS: '' })
        .ENCRYPTION_KEY_PREVIOUS
    ).toBeUndefined()
  })

  test('parses boolean flags', () => {
    const env = envSchema.parse({
      ...base,
      EMAIL_PROVIDER: 'memory',
      EVALUATOR_PROVIDER: 'fake',
      RUN_WORKER: 'true',
      WEBHOOK_ALLOW_PRIVATE: '1'
    })

    expect(env.RUN_WORKER).toBe(true)
    expect(env.WEBHOOK_ALLOW_PRIVATE).toBe(true)
  })
})
