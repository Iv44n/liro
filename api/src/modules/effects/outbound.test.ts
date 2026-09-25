import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import * as dnsPromises from 'node:dns/promises'
import {
  assertSafeUrl,
  assertSlackWebhookUrl,
  OutboundError,
  safeFetch
} from './outbound'

// Captured as a plain function value *before* any test mocks the module
// below, so `restoreDnsLookup` reinstalls the real implementation rather
// than a live binding that `mock.module` would have already swapped out.
const realDnsLookup = dnsPromises.lookup
function restoreDnsLookup() {
  mock.module('node:dns/promises', () => ({ lookup: realDnsLookup }))
}

async function expectBlocked(
  url: string,
  options: Parameters<typeof assertSafeUrl>[1] = { allowPrivate: false }
) {
  const error = await assertSafeUrl(url, options).catch(e => e)
  expect(error).toBeInstanceOf(OutboundError)
  expect((error as OutboundError).code).toBe('BLOCKED')
  return error as OutboundError
}

describe('assertSafeUrl — SSRF guard (allowPrivate: false)', () => {
  test('rejects the cloud metadata address', async () => {
    await expectBlocked('https://169.254.169.254/latest/meta-data')
  })

  test('rejects RFC1918 private ranges', async () => {
    await expectBlocked('https://10.0.0.5/')
    await expectBlocked('https://10.255.255.255/')
    await expectBlocked('https://172.16.0.1/')
    await expectBlocked('https://172.31.255.254/')
    await expectBlocked('https://192.168.1.1/')
  })

  test('rejects loopback', async () => {
    await expectBlocked('https://127.0.0.1/')
    await expectBlocked('https://127.0.0.1:8080/hook')
  })

  test('rejects IPv6 loopback', async () => {
    await expectBlocked('https://[::1]/')
  })

  test('rejects an IPv4-mapped IPv6 loopback', async () => {
    await expectBlocked('https://[::ffff:127.0.0.1]/')
  })

  test('rejects http:// (https required)', async () => {
    await expectBlocked('http://8.8.8.8/')
  })

  test('rejects CGNAT, "this network", multicast and broadcast', async () => {
    await expectBlocked('https://100.64.0.1/')
    await expectBlocked('https://0.0.0.1/')
    await expectBlocked('https://224.0.0.1/')
    await expectBlocked('https://255.255.255.255/')
  })

  test('rejects IPv6 ULA, link-local and multicast', async () => {
    await expectBlocked('https://[fc00::1]/')
    await expectBlocked('https://[fd12:3456:789a::1]/')
    await expectBlocked('https://[fe80::1]/')
    await expectBlocked('https://[ff02::1]/')
  })

  test('rejects the unspecified addresses', async () => {
    await expectBlocked('https://0.0.0.0/')
    await expectBlocked('https://[::]/')
  })

  test('rejects an IPv4-compatible (deprecated) IPv6 address embedding a private IP', async () => {
    await expectBlocked('https://[::10.0.0.1]/')
  })

  test('rejects URLs with embedded credentials', async () => {
    await expectBlocked('https://user:pass@8.8.8.8/')
  })

  test('rejects non-http(s) protocols regardless of target', async () => {
    await expectBlocked('ftp://8.8.8.8/')
    await expectBlocked('file:///etc/passwd')
  })

  test('rejects a malformed URL', async () => {
    await expectBlocked('not a url')
  })

  test('rejects a hostname that resolves to loopback via DNS (not an IP literal)', async () => {
    await expectBlocked('https://localhost/')
  })

  test('rejects a hostname that fails to resolve', async () => {
    const error = await expectBlocked(
      'https://this-domain-does-not-exist-xyz123.invalid/'
    )
    expect(error.message).toMatch(/could not resolve/i)
  })

  test('allows a public IPv4 address', async () => {
    await expect(
      assertSafeUrl('https://8.8.8.8/', { allowPrivate: false })
    ).resolves.toBeUndefined()
  })

  test('allows a public IPv6 address', async () => {
    await expect(
      assertSafeUrl('https://[2606:4700:4700::1111]/', { allowPrivate: false })
    ).resolves.toBeUndefined()
  })
})

describe('assertSafeUrl — allowPrivate: true', () => {
  test('allows http:// and private/loopback addresses', async () => {
    await expect(
      assertSafeUrl('http://127.0.0.1:3000/hook', { allowPrivate: true })
    ).resolves.toBeUndefined()
    await expect(
      assertSafeUrl('http://192.168.1.5/hook', { allowPrivate: true })
    ).resolves.toBeUndefined()
    await expect(
      assertSafeUrl('https://[::1]/hook', { allowPrivate: true })
    ).resolves.toBeUndefined()
  })

  test('still rejects an unsupported protocol', async () => {
    const error = await assertSafeUrl('ftp://127.0.0.1/', {
      allowPrivate: true
    }).catch(e => e)
    expect(error).toBeInstanceOf(OutboundError)
    expect((error as OutboundError).code).toBe('BLOCKED')
  })

  test('still rejects embedded credentials', async () => {
    const error = await assertSafeUrl('http://user:pass@127.0.0.1/', {
      allowPrivate: true
    }).catch(e => e)
    expect(error).toBeInstanceOf(OutboundError)
  })
})

describe('assertSafeUrl — allowPrivate defaults to WEBHOOK_ALLOW_PRIVATE', () => {
  test('defaults to allowing private addresses in the test env (.env.test sets it true)', async () => {
    // No `allowPrivate` passed at all — relies on env.WEBHOOK_ALLOW_PRIVATE.
    await expect(assertSafeUrl('http://127.0.0.1:9/')).resolves.toBeUndefined()
  })
})

describe('assertSlackWebhookUrl', () => {
  test('accepts a URL under the Slack incoming-webhook prefix', () => {
    expect(() =>
      assertSlackWebhookUrl(
        'https://hooks.slack.com/services/T000/B000/xxxxxxxxxxxxxxxx'
      )
    ).not.toThrow()
  })

  test('rejects http (must be https)', () => {
    expect(() =>
      assertSlackWebhookUrl('http://hooks.slack.com/services/T000/B000/x')
    ).toThrow(OutboundError)
  })

  test('rejects a lookalike host', () => {
    expect(() =>
      assertSlackWebhookUrl('https://hooks.slack.com.evil.com/services/x')
    ).toThrow(OutboundError)
  })

  test('rejects an unrelated URL', () => {
    expect(() =>
      assertSlackWebhookUrl('https://evil.com/hooks.slack.com/')
    ).toThrow(OutboundError)
  })

  test('the thrown error is BLOCKED', () => {
    try {
      assertSlackWebhookUrl('https://evil.com/')
      throw new Error('expected assertSlackWebhookUrl to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(OutboundError)
      expect((error as OutboundError).code).toBe('BLOCKED')
    }
  })
})

describe('safeFetch', () => {
  const servers: ReturnType<typeof Bun.serve>[] = []
  afterEach(() => {
    for (const server of servers.splice(0)) server.stop(true)
  })

  function serve(handler: (req: Request) => Response | Promise<Response>): {
    url: string
  } {
    const server = Bun.serve({ port: 0, fetch: handler })
    servers.push(server)
    return { url: `http://127.0.0.1:${server.port}` }
  }

  test('returns status, body and durationMs for a normal response', async () => {
    const { url } = serve(() => new Response('{"ok":true}', { status: 200 }))
    const result = await safeFetch(url, {}, { allowPrivate: true })
    expect(result.status).toBe(200)
    expect(result.body).toBe('{"ok":true}')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('returns non-2xx statuses normally instead of throwing', async () => {
    const { url } = serve(() => new Response('server error', { status: 500 }))
    const result = await safeFetch(url, {}, { allowPrivate: true })
    expect(result.status).toBe(500)
    expect(result.body).toBe('server error')
  })

  test('sends the given method, headers and body', async () => {
    let received:
      | { method: string; contentType: string | null; body: string }
      | undefined
    const { url } = serve(async req => {
      received = {
        method: req.method,
        contentType: req.headers.get('content-type'),
        body: await req.text()
      }
      return new Response('ok')
    })

    await safeFetch(
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"a":1}'
      },
      { allowPrivate: true }
    )

    expect(received).toEqual({
      method: 'POST',
      contentType: 'application/json',
      body: '{"a":1}'
    })
  })

  test('does not follow redirects: a 3xx is a REDIRECT failure', async () => {
    const { url } = serve(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/' }
        })
    )
    const error = await safeFetch(url, {}, { allowPrivate: true }).catch(e => e)
    expect(error).toBeInstanceOf(OutboundError)
    expect((error as OutboundError).code).toBe('REDIRECT')
  })

  test('reads at most maxBodyBytes of a larger response', async () => {
    const fullBody = 'x'.repeat(10_000)
    const { url } = serve(() => new Response(fullBody, { status: 200 }))
    const result = await safeFetch(
      url,
      {},
      { allowPrivate: true, maxBodyBytes: 100 }
    )
    expect(result.status).toBe(200)
    expect(result.body.length).toBe(100)
    expect(result.body).toBe(fullBody.slice(0, 100))
  })

  test('does not truncate a response smaller than maxBodyBytes', async () => {
    const { url } = serve(() => new Response('short body', { status: 200 }))
    const result = await safeFetch(
      url,
      {},
      { allowPrivate: true, maxBodyBytes: 2048 }
    )
    expect(result.body).toBe('short body')
  })

  test('times out a slow response as OutboundError TIMEOUT', async () => {
    const { url } = serve(async () => {
      await new Promise(resolve => setTimeout(resolve, 500))
      return new Response('too slow')
    })
    const error = await safeFetch(
      url,
      {},
      { allowPrivate: true, timeoutMs: 50 }
    ).catch(e => e)
    expect(error).toBeInstanceOf(OutboundError)
    expect((error as OutboundError).code).toBe('TIMEOUT')
  })

  test('a fast response under the timeout succeeds', async () => {
    const { url } = serve(() => new Response('fast'))
    const result = await safeFetch(
      url,
      {},
      { allowPrivate: true, timeoutMs: 5000 }
    )
    expect(result.status).toBe(200)
  })

  test('a refused connection is an OutboundError NETWORK', async () => {
    // Port 0 as a *target* (not `Bun.serve`'s bind option) is not
    // listenable, so the connection is refused immediately.
    const error = await safeFetch(
      'http://127.0.0.1:1/',
      {},
      { allowPrivate: true, timeoutMs: 2000 }
    ).catch(e => e)
    expect(error).toBeInstanceOf(OutboundError)
    expect((error as OutboundError).code).toBe('NETWORK')
  })

  test('blocks a private-address target before ever connecting (allowPrivate: false)', async () => {
    const { url } = serve(() => new Response('should never be reached'))
    const error = await safeFetch(url, {}, { allowPrivate: false }).catch(
      e => e
    )
    expect(error).toBeInstanceOf(OutboundError)
    expect((error as OutboundError).code).toBe('BLOCKED')
  })

  test('defaults allowPrivate from WEBHOOK_ALLOW_PRIVATE when omitted', async () => {
    const { url } = serve(() => new Response('ok'))
    // .env.test sets WEBHOOK_ALLOW_PRIVATE=true, so a 127.0.0.1 receiver
    // works without passing allowPrivate explicitly.
    const result = await safeFetch(url)
    expect(result.status).toBe(200)
  })
})

describe('safeFetch — DNS rebinding: the validated address is the one dialed', () => {
  const servers: ReturnType<typeof Bun.serve>[] = []

  afterEach(() => {
    for (const server of servers.splice(0)) server.stop(true)
    restoreDnsLookup()
  })
  afterAll(restoreDnsLookup)

  test('connects to the address it just validated instead of letting fetch() re-resolve the hostname', async () => {
    const server = Bun.serve({
      port: 0,
      fetch: req => new Response(`seen-host:${req.headers.get('host')}`)
    })
    servers.push(server)

    let lookups = 0
    mock.module('node:dns/promises', () => ({
      lookup: async () => {
        lookups++
        return [{ address: '127.0.0.1', family: 4 }]
      }
    }))

    // `.invalid` (RFC 2606) is guaranteed to never resolve on the real
    // network. `assertSafeUrl`'s check passes only because the DNS lookup
    // above is mocked. If safeFetch handed this hostname to `fetch()` to
    // resolve on its own — the bug: two independent, unpinned lookups
    // instead of one validated address carried through — the request
    // would fail outright instead of reaching the server, because nothing
    // mocks `fetch()`'s own resolver.
    const hostname = `pin-me.invalid:${server.port}`
    const result = await safeFetch(
      `http://${hostname}/hook`,
      {},
      { allowPrivate: true }
    )

    expect(result.status).toBe(200)
    // The connection landed on the validated address, but the receiver
    // still saw the original hostname as the Host header — proving the
    // hostname wasn't silently swapped for the address end-to-end.
    expect(result.body).toBe(`seen-host:${hostname}`)
    // Exactly the one lookup `assertSafeUrl`'s check performed — no second,
    // independent resolution happened when the request was actually made.
    // A naive "validate the hostname, then let fetch() resolve it again"
    // implementation would perform a second lookup here; if that second,
    // unpinned lookup answered with a different (unsafe) address — DNS
    // rebinding — it would connect there instead, undetected.
    expect(lookups).toBe(1)
  })
})
