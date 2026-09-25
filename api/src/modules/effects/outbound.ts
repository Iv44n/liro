import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { env } from '#shared/config/env'

/**
 * SSRF guard and rate-limited HTTP client for outbound effects (webhooks and
 * Slack). Two layers:
 *
 * - {@link assertSafeUrl} decides whether a URL is safe to call: HTTPS only
 *   (unless `allowPrivate`), no embedded credentials, and every address the
 *   host resolves to (or, for an IP-literal host, the IP itself) must be
 *   outside the private/reserved ranges below. It's meant to run both when
 *   an endpoint is saved and again right before every delivery — DNS can
 *   change between the two (rebinding).
 * - {@link safeFetch} re-runs that check, then performs the request with
 *   redirects disabled, a timeout, and a cap on how much of the response
 *   body is read. Crucially, it does *not* hand the hostname to `fetch()`
 *   and let it resolve DNS again: `fetch()`'s own resolution happens
 *   independently of the check above, so the address that was validated
 *   would not be guaranteed to be the address that gets connected to (a
 *   host whose DNS answer changes between the two lookups — rebinding —
 *   could pass the check and still land on an internal address). Instead,
 *   `safeFetch` connects directly to the already-validated address, while
 *   keeping the original hostname as the `Host` header and, over HTTPS, the
 *   TLS SNI/certificate name — so the address that was checked is the one
 *   that's dialed, full stop.
 */

export type OutboundErrorCode = 'BLOCKED' | 'TIMEOUT' | 'NETWORK' | 'REDIRECT'

export class OutboundError extends Error {
  readonly code: OutboundErrorCode

  constructor(code: OutboundErrorCode, message: string) {
    super(message)
    this.name = 'OutboundError'
    this.code = code
  }
}

export interface AssertSafeUrlOptions {
  /**
   * Relaxes both restrictions the SSRF guard normally enforces: allows
   * `http://` in addition to `https://`, and allows private/loopback/
   * link-local addresses. Defaults to `WEBHOOK_ALLOW_PRIVATE`, so dev/test
   * receivers on `127.0.0.1` work without every call site wiring it through.
   */
  allowPrivate?: boolean
}

interface ResolvedSafeUrl {
  /** The parsed input URL (hostname, not yet pinned to an address). */
  url: URL
  /** `url.hostname`, brackets stripped. */
  hostname: string
  /** Every address `hostname` resolves to (or just the IP, for an IP-literal host) — already checked, when `allowPrivate` is false, to exclude every reserved range below. */
  addresses: string[]
}

/** Shared by {@link assertSafeUrl} and {@link safeFetch}: parses, validates and resolves `rawUrl`, so both act on the exact same lookup. */
async function resolveSafeUrl(
  rawUrl: string,
  options: AssertSafeUrlOptions
): Promise<ResolvedSafeUrl> {
  const allowPrivate = options.allowPrivate ?? env.WEBHOOK_ALLOW_PRIVATE

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new OutboundError('BLOCKED', `"${rawUrl}" is not a valid URL`)
  }

  if (url.username || url.password) {
    throw new OutboundError(
      'BLOCKED',
      'URLs with embedded credentials (userinfo) are not allowed'
    )
  }

  const allowedProtocols = allowPrivate ? ['https:', 'http:'] : ['https:']
  if (!allowedProtocols.includes(url.protocol)) {
    throw new OutboundError(
      'BLOCKED',
      `Protocol "${url.protocol}" is not allowed (${allowPrivate ? 'http or https' : 'https only'})`
    )
  }

  const hostname = stripBrackets(url.hostname)
  const addresses =
    net.isIP(hostname) !== 0 ? [hostname] : await resolveAllOrThrow(hostname)

  if (!allowPrivate) {
    for (const address of addresses) {
      if (isReservedAddress(address)) {
        throw new OutboundError(
          'BLOCKED',
          `"${hostname}" resolves to a private or reserved address (${address})`
        )
      }
    }
  }

  return { url, hostname, addresses }
}

/**
 * Throws `OutboundError('BLOCKED', …)` unless `url` is safe to call:
 * `https:` (or `http:`/`https:` with `allowPrivate`), no userinfo, and every
 * resolved address outside the reserved ranges below (unless `allowPrivate`).
 *
 * This only validates — it doesn't connect to anything, so it's for call
 * sites like "save this endpoint URL" that need the check without a
 * request. {@link safeFetch} does its own equivalent (and freshly resolved)
 * check right before connecting; don't rely on a prior `assertSafeUrl` call
 * to cover a `safeFetch` made later.
 */
export async function assertSafeUrl(
  rawUrl: string,
  options: AssertSafeUrlOptions = {}
): Promise<void> {
  await resolveSafeUrl(rawUrl, options)
}

const SLACK_WEBHOOK_PREFIX = 'https://hooks.slack.com/'

/** Throws `OutboundError('BLOCKED', …)` unless `url` starts with Slack's incoming-webhook prefix. */
export function assertSlackWebhookUrl(url: string): void {
  if (!url.startsWith(SLACK_WEBHOOK_PREFIX)) {
    throw new OutboundError(
      'BLOCKED',
      `Slack webhook URLs must start with "${SLACK_WEBHOOK_PREFIX}"`
    )
  }
}

export interface SafeFetchOptions {
  allowPrivate?: boolean
  /** Abort the request after this many milliseconds. Default 10,000. */
  timeoutMs?: number
  /** Stop reading the response body after this many bytes. Default 2,048. */
  maxBodyBytes?: number
}

export interface SafeFetchResult {
  status: number
  /** The response body, truncated to `maxBodyBytes`. */
  body: string
  durationMs: number
}

/**
 * The same check as `assertSafeUrl`, followed by a `fetch` that never
 * follows redirects (a 3xx response is a `REDIRECT` failure), times out,
 * and reads at most `maxBodyBytes` of the response. Any other HTTP status
 * (2xx, 4xx, 5xx) is returned normally — only connection-level failures
 * throw.
 *
 * The request is dialed directly at the address `resolveSafeUrl` just
 * validated (see the module doc comment) rather than at the hostname, so
 * `fetch()` can't independently re-resolve DNS to a different, unvalidated
 * address.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  options: SafeFetchOptions = {}
): Promise<SafeFetchResult> {
  const allowPrivate = options.allowPrivate ?? env.WEBHOOK_ALLOW_PRIVATE
  const timeoutMs = options.timeoutMs ?? 10_000
  const maxBodyBytes = options.maxBodyBytes ?? 2048

  const {
    url: parsedUrl,
    hostname,
    addresses
  } = await resolveSafeUrl(url, { allowPrivate })

  // Pin the connection to the first validated address: rewrite the URL's
  // host to the numeric address, but keep the original hostname as the
  // `Host` header (so name-based virtual hosting still works) and, over
  // HTTPS, as the TLS server name (so SNI and certificate-hostname
  // verification target the real hostname rather than the bare address).
  const address = addresses[0] as string
  const pinnedUrl = new URL(parsedUrl)
  pinnedUrl.hostname = net.isIP(address) === 6 ? `[${address}]` : address

  const headers = new Headers(init.headers)
  headers.set('host', parsedUrl.host)

  const start = performance.now()
  let response: Response
  try {
    response = await fetch(pinnedUrl, {
      ...init,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      ...(parsedUrl.protocol === 'https:'
        ? { tls: { serverName: hostname } }
        : {})
    } satisfies BunFetchRequestInit)
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new OutboundError(
        'TIMEOUT',
        `Request to "${url}" timed out after ${timeoutMs}ms`
      )
    }
    throw new OutboundError(
      'NETWORK',
      error instanceof Error ? error.message : 'Network error'
    )
  }
  const durationMs = performance.now() - start

  if (response.status >= 300 && response.status < 400) {
    throw new OutboundError(
      'REDIRECT',
      `Redirects are not followed (received ${response.status})`
    )
  }

  const body = await readBodyLimited(response, maxBodyBytes)
  return { status: response.status, body, durationMs }
}

// --- URL / address helpers -------------------------------------------------

function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

async function resolveAllOrThrow(hostname: string): Promise<string[]> {
  let records: { address: string }[]
  try {
    records = await lookup(hostname, { all: true })
  } catch (error) {
    throw new OutboundError(
      'BLOCKED',
      `Could not resolve "${hostname}": ${error instanceof Error ? error.message : String(error)}`
    )
  }
  if (records.length === 0) {
    throw new OutboundError(
      'BLOCKED',
      `"${hostname}" did not resolve to any address`
    )
  }
  return records.map(record => record.address)
}

function isReservedAddress(address: string): boolean {
  const version = net.isIP(address)
  if (version === 4) return isReservedIPv4(ipv4ToInt(address))
  if (version === 6) return isReservedIPv6(address)
  // Couldn't tell what family this is — fail closed.
  return true
}

// --- IPv4 --------------------------------------------------------------

function ipv4ToInt(address: string): number {
  const [a = 0, b = 0, c = 0, d = 0] = address.split('.').map(Number)
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0
}

function ipv4InRange(value: number, base: string, maskBits: number): boolean {
  const baseInt = ipv4ToInt(base)
  const mask = maskBits === 0 ? 0 : (0xffffffff << (32 - maskBits)) >>> 0
  return (value & mask) >>> 0 === (baseInt & mask) >>> 0
}

/** RFC 5735/6598/1918 reserved ranges, plus multicast and broadcast. */
const IPV4_RESERVED_RANGES: [base: string, maskBits: number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (cloud metadata: 169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.168.0.0', 16], // private
  ['224.0.0.0', 4], // multicast
  ['255.255.255.255', 32] // broadcast
]

function isReservedIPv4(value: number): boolean {
  return IPV4_RESERVED_RANGES.some(([base, bits]) =>
    ipv4InRange(value, base, bits)
  )
}

// --- IPv6 --------------------------------------------------------------

/**
 * Parses any valid textual IPv6 address (with `::` compression, a zone id,
 * or an embedded dotted-decimal IPv4 tail) into its 16 raw bytes, or `null`
 * if it can't be parsed.
 */
function parseIPv6(address: string): Uint8Array | null {
  const withoutZone = address.split('%')[0]
  if (!withoutZone) return null

  const doubleColonParts = withoutZone.split('::')
  if (doubleColonParts.length > 2) return null

  const groupsOf = (part: string): string[] =>
    part === '' ? [] : part.split(':')

  const [rawHead, rawTail] =
    doubleColonParts.length === 2
      ? [doubleColonParts[0] ?? '', doubleColonParts[1] ?? '']
      : [withoutZone, '']

  const expandEmbeddedIPv4 = (groups: string[]): string[] => {
    const last = groups.at(-1)
    if (!last?.includes('.')) return groups
    const octets = last.split('.').map(Number)
    if (
      octets.length !== 4 ||
      octets.some(o => !Number.isInteger(o) || o < 0 || o > 255)
    ) {
      return groups
    }
    const [a = 0, b = 0, c = 0, d = 0] = octets
    return [
      ...groups.slice(0, -1),
      ((a << 8) | b).toString(16),
      ((c << 8) | d).toString(16)
    ]
  }

  const head = expandEmbeddedIPv4(groupsOf(rawHead))
  const tail = expandEmbeddedIPv4(groupsOf(rawTail))
  const totalGroups = head.length + tail.length

  if (doubleColonParts.length === 1 && totalGroups !== 8) return null
  if (totalGroups > 8) return null

  const missing = 8 - totalGroups
  const allGroups = [
    ...head,
    ...Array(doubleColonParts.length === 2 ? missing : 0).fill('0'),
    ...tail
  ]
  if (allGroups.length !== 8) return null

  const bytes = new Uint8Array(16)
  for (let i = 0; i < 8; i++) {
    const group = allGroups[i]
    if (!group || !/^[0-9a-fA-F]{1,4}$/.test(group)) return null
    const value = Number.parseInt(group, 16)
    bytes[i * 2] = (value >> 8) & 0xff
    bytes[i * 2 + 1] = value & 0xff
  }
  return bytes
}

function isAllZero(bytes: Uint8Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) {
    if (bytes[i] !== 0) return false
  }
  return true
}

function isReservedIPv6(address: string): boolean {
  const bytes = parseIPv6(address)
  if (!bytes) return true // unparseable — fail closed

  if (isAllZero(bytes, 0, 16)) return true // ::
  if (isAllZero(bytes, 0, 15) && bytes[15] === 1) return true // ::1

  const first = bytes[0] as number
  const second = bytes[1] as number
  if ((first & 0xfe) === 0xfc) return true // fc00::/7 (ULA)
  if (first === 0xfe && (second & 0xc0) === 0x80) return true // fe80::/10
  if (first === 0xff) return true // ff00::/8 (multicast)

  // IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible form
  // (::a.b.c.d) both carry the real address in the last 4 bytes.
  const isMapped =
    isAllZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff
  const isCompatible = isAllZero(bytes, 0, 12)
  if (isMapped || isCompatible) {
    const [a = 0, b = 0, c = 0, d = 0] = bytes.slice(12, 16)
    return isReservedIPv4(((a << 24) | (b << 16) | (c << 8) | d) >>> 0)
  }

  return false
}

// --- Response body ---------------------------------------------------------

async function readBodyLimited(
  response: Response,
  maxBytes: number
): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) return ''

  const chunks: Uint8Array[] = []
  let total = 0

  while (total < maxBytes) {
    const { done, value } = await reader.read()
    if (done || !value) break
    const remaining = maxBytes - total
    const chunk =
      value.length > remaining ? value.subarray(0, remaining) : value
    chunks.push(chunk)
    total += chunk.length
    if (chunk.length < value.length) break // hit the limit mid-chunk
  }

  try {
    await reader.cancel()
  } catch {
    // The stream may already be done; nothing to release.
  }

  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8')
}
