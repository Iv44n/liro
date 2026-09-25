/**
 * Records real provider responses for the evaluator contract tests. Records
 * every provider whose key is set (at least one is required). Run after
 * upgrading `ai` / `@ai-sdk/gateway` / `@typesafe-ai/sdk`:
 *
 *   AI_GATEWAY_API_KEY=… TYPESAFE_API_KEY=… bun run fixtures:record
 *
 * Writes test/fixtures/evaluator/<provider>/recorded/*.response.json, which
 * evaluator.contract.test.ts replays to check that today's wire format still
 * parses into valid canonical answers. Request headers (the keys) are never
 * stored; response headers are filtered to the ones the adapters read.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createTypeSafeEvaluator } from '#modules/engine/evaluator/adapters/typesafe'
import { createVercelGatewayEvaluator } from '#modules/engine/evaluator/adapters/vercel-gateway'
import type {
  EvaluationRequest,
  Evaluator
} from '#modules/engine/evaluator/port'

type Fetch = typeof globalThis.fetch

const providers: {
  name: 'vercel-gateway' | 'typesafe'
  apiKey: string | undefined
  create: (apiKey: string, fetch: Fetch) => Evaluator
}[] = [
  {
    name: 'vercel-gateway',
    apiKey: process.env.AI_GATEWAY_API_KEY,
    create: (apiKey, fetch) => createVercelGatewayEvaluator({ apiKey, fetch })
  },
  {
    name: 'typesafe',
    apiKey: process.env.TYPESAFE_API_KEY,
    create: (apiKey, fetch) =>
      createTypeSafeEvaluator({
        apiKey,
        fetch,
        ...(process.env.JEV_MODEL_VERSION
          ? { modelVersion: process.env.JEV_MODEL_VERSION }
          : {})
      })
  }
]

const RECORDED_HEADERS = [
  'content-type',
  'retry-after',
  'x-vercel-id',
  'x-typesafe-request-id'
]

const enabled = providers.filter(provider => provider.apiKey)
if (enabled.length === 0) {
  console.error(
    'Set AI_GATEWAY_API_KEY and/or TYPESAFE_API_KEY to record fixtures'
  )
  process.exit(1)
}

const fixtures = new URL('../test/fixtures/evaluator/', import.meta.url)
const requests = ['support-triage']

for (const provider of enabled) {
  const outDir = new URL(`${provider.name}/recorded/`, fixtures)
  mkdirSync(outDir, { recursive: true })

  for (const name of requests) {
    const canonical = JSON.parse(
      readFileSync(new URL(`${name}.request.json`, fixtures), 'utf8')
    )
    let recorded:
      | { status: number; headers: Record<string, string>; body: unknown }
      | undefined

    const recordingFetch = (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      const response = await fetch(input, init)
      const body = await response
        .clone()
        .json()
        .catch(() => null)
      recorded = {
        status: response.status,
        headers: Object.fromEntries(
          [...response.headers.entries()].filter(([key]) =>
            RECORDED_HEADERS.includes(key)
          )
        ),
        body
      }
      return response
    }) as Fetch

    const evaluator = provider.create(provider.apiKey ?? '', recordingFetch)
    const request: EvaluationRequest = {
      ...canonical,
      model: { family: 'jev' },
      organizationId: 'fixtures',
      priority: 'evaluation'
    }

    const result = await evaluator.evaluate(request)
    writeFileSync(
      new URL(`${name}.response.json`, outDir),
      `${JSON.stringify(recorded, null, 2)}\n`
    )

    const withProbabilities = Object.values(result.answers).filter(
      answer => answer.type === 'boolean' || answer.probabilities !== null
    ).length
    console.log(
      `${provider.name}/${name}: ${Object.keys(result.answers).length} answers, ` +
        `${withProbabilities} with probabilities, ${result.usage.inputTokens} input tokens, ` +
        `model ${result.model.resolved ?? result.model.requested}`
    )
  }
}
