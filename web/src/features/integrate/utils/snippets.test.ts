import { describe, expect, it } from 'vitest'
import {
  API_KEY_PLACEHOLDER,
  curlSnippet,
  fetchSnippet,
  pollSnippet,
  pythonSnippet,
  runLookupUrl,
  runUrl,
  shellSingleQuote,
  snippetFor,
  toPythonLiteral
} from './snippets'

describe('runUrl() / runLookupUrl()', () => {
  it('joins the base URL, keeping "@" readable', () => {
    expect(runUrl('https://api.liro.app', 'soporte@1')).toBe(
      'https://api.liro.app/v1/decisions/soporte@1/run'
    )
    expect(runUrl('https://api.liro.app/', 'soporte')).toBe(
      'https://api.liro.app/v1/decisions/soporte/run'
    )
  })

  it('percent-encodes the rest of a ref', () => {
    expect(runUrl('https://x', 'a b')).toBe('https://x/v1/decisions/a%20b/run')
  })

  it('builds a run lookup URL', () => {
    expect(runLookupUrl('https://x', 'run_1')).toBe('https://x/v1/runs/run_1')
  })
})

describe('shellSingleQuote()', () => {
  it('wraps text in single quotes, escaping any that appear', () => {
    expect(shellSingleQuote('hola')).toBe("'hola'")
    expect(shellSingleQuote("it's")).toBe("'it'\\''s'")
  })
})

describe('toPythonLiteral()', () => {
  it('renders JSON primitives as Python literals', () => {
    expect(toPythonLiteral(null)).toBe('None')
    expect(toPythonLiteral(true)).toBe('True')
    expect(toPythonLiteral(false)).toBe('False')
    expect(toPythonLiteral(3)).toBe('3')
    expect(toPythonLiteral('x')).toBe('"x"')
  })

  it('renders empty and non-empty collections', () => {
    expect(toPythonLiteral([])).toBe('[]')
    expect(toPythonLiteral({})).toBe('{}')
    expect(toPythonLiteral({ a: 1 })).toBe('{\n    "a": 1,\n}')
    expect(toPythonLiteral([1, 2])).toBe('[\n    1,\n    2,\n]')
  })
})

describe('snippets', () => {
  const options = {
    baseUrl: 'https://api.liro.app',
    ref: 'soporte@1',
    input: { message: 'hola' }
  }

  it('curl: includes the URL, the key placeholder and the JSON body', () => {
    const snippet = curlSnippet(options)
    expect(snippet).toContain('https://api.liro.app/v1/decisions/soporte@1/run')
    expect(snippet).toContain(API_KEY_PLACEHOLDER)
    expect(snippet).toContain('"message": "hola"')
    expect(snippet).toContain('Idempotency-Key')
  })

  it('javascript: is valid enough to contain the request shape', () => {
    const snippet = fetchSnippet(options)
    expect(snippet).toContain(
      'fetch("https://api.liro.app/v1/decisions/soporte@1/run"'
    )
    expect(snippet).toContain("'x-api-key': process.env.LIRO_API_KEY")
    expect(snippet).toContain('needs_review')
  })

  it('python: uses Python literals and the requests library', () => {
    const snippet = pythonSnippet(options)
    expect(snippet).toContain('import requests')
    expect(snippet).toContain('"message": "hola"')
    expect(snippet).toContain('os.environ["LIRO_API_KEY"]')
  })

  it('snippetFor() dispatches by language', () => {
    expect(snippetFor('curl', options)).toBe(curlSnippet(options))
    expect(snippetFor('javascript', options)).toBe(fetchSnippet(options))
    expect(snippetFor('python', options)).toBe(pythonSnippet(options))
  })

  it('pollSnippet() curls the run lookup endpoint', () => {
    expect(pollSnippet('https://api.liro.app', 'run_1')).toContain(
      'https://api.liro.app/v1/runs/run_1'
    )
  })
})
