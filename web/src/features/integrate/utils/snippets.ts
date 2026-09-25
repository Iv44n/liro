import type { JsonValue } from '#/features/templates/types/definition'

/**
 * Copy-paste snippets for `POST /v1/decisions/:ref/run` (curl, JavaScript
 * `fetch`, Python `requests`). Pure string builders so they can be tested
 * and stay in sync; the API key is always a placeholder — never a real key.
 */

/** What the snippets show instead of a key. */
export const API_KEY_PLACEHOLDER = 'lr_live_…'

/** Environment variable the JS/Python snippets read the key from. */
export const API_KEY_ENV = 'LIRO_API_KEY'

export interface SnippetOptions {
  /** API origin, e.g. `https://api.liro.app` (no trailing slash needed). */
  baseUrl: string
  /** `slug@major` (or any ref). */
  ref: string
  /** The run's `input`. */
  input: JsonValue
}

/** `baseUrl` + `/v1/decisions/<ref>/run`, the ref URL-encoded like the SDK does. */
export function runUrl(baseUrl: string, ref: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/decisions/${encodeURIComponent(ref).replace(/%40/g, '@')}/run`
}

/** `baseUrl` + `/v1/runs/<id>`. */
export function runLookupUrl(baseUrl: string, id: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/v1/runs/${id}`
}

/** `text` inside single quotes for a POSIX shell (`'` → `'\''`). */
export function shellSingleQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

/** Re-indents every line but the first by `indent` spaces. */
const indentTail = (text: string, indent: number): string =>
  text.replace(/\n/g, `\n${' '.repeat(indent)}`)

export function curlSnippet({ baseUrl, ref, input }: SnippetOptions): string {
  const body = JSON.stringify({ input }, null, 2)
  return [
    `curl -X POST ${shellSingleQuote(runUrl(baseUrl, ref))} \\`,
    `  -H ${shellSingleQuote(`x-api-key: ${API_KEY_PLACEHOLDER}`)} \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H "Idempotency-Key: $(uuidgen)" \\`,
    `  -d ${shellSingleQuote(body)}`
  ].join('\n')
}

export function fetchSnippet({ baseUrl, ref, input }: SnippetOptions): string {
  const inputJson = indentTail(JSON.stringify(input, null, 2), 4)
  return `const response = await fetch(${JSON.stringify(runUrl(baseUrl, ref))}, {
  method: 'POST',
  headers: {
    'x-api-key': process.env.${API_KEY_ENV}, // ${API_KEY_PLACEHOLDER}
    'Content-Type': 'application/json',
    // Reintentar con la misma clave nunca ejecuta dos veces (24 h).
    'Idempotency-Key': crypto.randomUUID()
  },
  body: JSON.stringify({
    input: ${inputJson}
  })
})

if (!response.ok) {
  const { error } = await response.json()
  throw new Error(\`\${error.code}: \${error.message}\`)
}

const run = await response.json()
if (run.decision === 'needs_review') {
  // Revisión humana: consulta GET /v1/runs/\${run.id} hasta que finalDecision tenga valor.
}
console.log(run.finalDecision ?? run.decision)`
}

const PYTHON_INDENT = '    '

/**
 * A JSON value as a Python literal (`True`/`False`/`None`, dicts and lists
 * with trailing commas, black-style), nested at `level`.
 */
export function toPythonLiteral(value: JsonValue, level = 0): string {
  if (value === null) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  if (typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }

  const inner = PYTHON_INDENT.repeat(level + 1)
  const outer = PYTHON_INDENT.repeat(level)
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]'
    const items = value.map(
      item => `${inner}${toPythonLiteral(item, level + 1)},`
    )
    return `[\n${items.join('\n')}\n${outer}]`
  }

  const entries = Object.entries(value)
  if (entries.length === 0) return '{}'
  const items = entries.map(
    ([key, item]) =>
      `${inner}${JSON.stringify(key)}: ${toPythonLiteral(item, level + 1)},`
  )
  return `{\n${items.join('\n')}\n${outer}}`
}

export function pythonSnippet({ baseUrl, ref, input }: SnippetOptions): string {
  const body = toPythonLiteral({ input }, 1)
  return `import os
import uuid

import requests

response = requests.post(
    ${JSON.stringify(runUrl(baseUrl, ref))},
    headers={
        "x-api-key": os.environ["${API_KEY_ENV}"],  # ${API_KEY_PLACEHOLDER}
        # Reintentar con la misma clave nunca ejecuta dos veces (24 h).
        "Idempotency-Key": str(uuid.uuid4()),
    },
    json=${body},
    timeout=30,
)
response.raise_for_status()
run = response.json()

if run["decision"] == "needs_review":
    # Revisión humana: consulta GET /v1/runs/{id} hasta que finalDecision tenga valor.
    pass
print(run["finalDecision"] or run["decision"])`
}

/** `curl` for polling a run (e.g. one in review). */
export function pollSnippet(baseUrl: string, id = '<run_id>'): string {
  return [
    `curl ${shellSingleQuote(runLookupUrl(baseUrl, id))} \\`,
    `  -H ${shellSingleQuote(`x-api-key: ${API_KEY_PLACEHOLDER}`)}`
  ].join('\n')
}

export const SNIPPET_LANGUAGES = ['curl', 'javascript', 'python'] as const
export type SnippetLanguage = (typeof SNIPPET_LANGUAGES)[number]

export const SNIPPET_LABELS: Record<SnippetLanguage, string> = {
  curl: 'curl',
  javascript: 'JavaScript',
  python: 'Python'
}

export function snippetFor(
  language: SnippetLanguage,
  options: SnippetOptions
): string {
  switch (language) {
    case 'curl':
      return curlSnippet(options)
    case 'javascript':
      return fetchSnippet(options)
    case 'python':
      return pythonSnippet(options)
  }
}
