import { beforeEach, describe, expect, test } from 'bun:test'
import { env } from '#shared/config/env'
import { decryptSecret, encryptSecret } from './crypto'

const originalKey = env.ENCRYPTION_KEY
const originalPreviousKey = env.ENCRYPTION_KEY_PREVIOUS

beforeEach(() => {
  env.ENCRYPTION_KEY = originalKey
  env.ENCRYPTION_KEY_PREVIOUS = originalPreviousKey
})

describe('encryptSecret / decryptSecret', () => {
  test('round-trips a plaintext', () => {
    const encrypted = encryptSecret('whsec_super-secret-value')
    expect(decryptSecret(encrypted)).toBe('whsec_super-secret-value')
  })

  test('round-trips unicode and empty strings', () => {
    expect(decryptSecret(encryptSecret('héllo 世界 🔐'))).toBe('héllo 世界 🔐')
    expect(decryptSecret(encryptSecret(''))).toBe('')
  })

  test('prefixes the current key id ("k1:")', () => {
    expect(encryptSecret('x')).toMatch(/^k1:/)
  })

  test('is not deterministic: two encryptions of the same plaintext differ', () => {
    const a = encryptSecret('same plaintext')
    const b = encryptSecret('same plaintext')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('same plaintext')
    expect(decryptSecret(b)).toBe('same plaintext')
  })

  test('the payload is base64url (no "+", "/" or "=" padding)', () => {
    const encrypted = encryptSecret('x')
    const payload = encrypted.slice('k1:'.length)
    expect(payload).not.toMatch(/[+/=]/)
  })

  test('throws a clear error when ENCRYPTION_KEY is missing', () => {
    env.ENCRYPTION_KEY = undefined
    expect(() => encryptSecret('x')).toThrow(/ENCRYPTION_KEY is not set/)

    // Encrypted first while the key was present, then the key disappears.
    env.ENCRYPTION_KEY = originalKey
    const encrypted = encryptSecret('x')
    env.ENCRYPTION_KEY = undefined
    expect(() => decryptSecret(encrypted)).toThrow(/ENCRYPTION_KEY is not set/)
  })

  test('a rotated-out key ("k0") decrypts only via ENCRYPTION_KEY_PREVIOUS', () => {
    env.ENCRYPTION_KEY = 'old-key-generation'
    // encryptSecret always labels its output "k1" (the current key at the
    // time). A value properly migrated to "k0" storage has the same bytes,
    // just relabeled — the AES computation never depended on the label.
    const encryptedUnderOldKey = encryptSecret('rotate me')
    const asPreviousGeneration = `k0:${encryptedUnderOldKey.slice('k1:'.length)}`

    // Rotate: the old key moves to "previous", a new one becomes current.
    env.ENCRYPTION_KEY_PREVIOUS = 'old-key-generation'
    env.ENCRYPTION_KEY = 'new-key-generation'

    expect(decryptSecret(asPreviousGeneration)).toBe('rotate me')

    // New encryptions use the new key and are labeled "k1", not "k0".
    const encryptedUnderNewKey = encryptSecret('freshly encrypted')
    expect(encryptedUnderNewKey.startsWith('k1:')).toBe(true)
    expect(decryptSecret(encryptedUnderNewKey)).toBe('freshly encrypted')
  })

  test('a value labeled "k1" before a rotation still decrypts once "k1" points to the new key (falls back to k0)', () => {
    env.ENCRYPTION_KEY = 'old-key-generation'
    const encryptedBeforeRotation = encryptSecret('secret')
    expect(encryptedBeforeRotation.startsWith('k1:')).toBe(true)

    // Rotating moves the old value to "previous" under a new current key —
    // this value is still labeled "k1" on disk (nothing relabels it), which
    // now resolves to the *new* key. decryptSecret must not depend on the
    // label alone: it tries "k1" (the new key, wrong for this value), fails
    // to authenticate, and falls back to "k0" (the old key, correct).
    env.ENCRYPTION_KEY_PREVIOUS = 'old-key-generation'
    env.ENCRYPTION_KEY = 'new-key-generation'

    expect(decryptSecret(encryptedBeforeRotation)).toBe('secret')

    // New encryptions are unaffected: they're under the new key, labeled
    // "k1", and decrypt straight off the primary key with no fallback.
    const encryptedAfterRotation = encryptSecret('freshly encrypted')
    expect(encryptedAfterRotation.startsWith('k1:')).toBe(true)
    expect(decryptSecret(encryptedAfterRotation)).toBe('freshly encrypted')
  })

  test('rotating does not resurrect a value that was never valid under either key', () => {
    env.ENCRYPTION_KEY = 'key-a'
    const encrypted = encryptSecret('secret')
    env.ENCRYPTION_KEY_PREVIOUS = 'key-b'
    env.ENCRYPTION_KEY = 'key-c'
    // Neither the new current key ("k1" → key-c) nor the previous key
    // ("k0" → key-b) is the key this value was actually encrypted under
    // (key-a), so both attempts fail and the error is the shared one, not
    // a misleadingly specific one naming either key.
    expect(() => decryptSecret(encrypted)).toThrow(/Failed to decrypt/)
  })

  test('throws a clear error decrypting "k0:" without ENCRYPTION_KEY_PREVIOUS set', () => {
    expect(env.ENCRYPTION_KEY_PREVIOUS).toBeUndefined()
    expect(() =>
      decryptSecret('k0:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    ).toThrow(/ENCRYPTION_KEY_PREVIOUS is not set/)
  })

  test('throws on an unknown key id', () => {
    expect(() =>
      decryptSecret('k9:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    ).toThrow(/Unknown encryption key id "k9"/)
  })

  test('throws on a value with no key id prefix', () => {
    expect(() => decryptSecret('not-a-valid-value')).toThrow(
      /missing key id prefix/
    )
  })

  test('throws on a payload too short to hold an IV and auth tag', () => {
    expect(() => decryptSecret('k1:AAAA')).toThrow(/payload too short/)
  })

  test('throws when the ciphertext or tag is tampered with', () => {
    const encrypted = encryptSecret('do not tamper with me')
    const [prefix, payload] = encrypted.split(':') as [string, string]
    const bytes = Buffer.from(payload, 'base64url')
    // Flip a byte in the middle of the ciphertext (after the 12-byte IV).
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff
    const tampered = `${prefix}:${bytes.toString('base64url')}`
    expect(() => decryptSecret(tampered)).toThrow(/Failed to decrypt/)
  })

  test('decrypting under the wrong current key fails', () => {
    env.ENCRYPTION_KEY = 'key-a'
    const encrypted = encryptSecret('secret')
    env.ENCRYPTION_KEY = 'key-b'
    expect(() => decryptSecret(encrypted)).toThrow(/Failed to decrypt/)
  })

  test('any string works as ENCRYPTION_KEY, hashed down to a 32-byte AES key', () => {
    env.ENCRYPTION_KEY = 'short'
    expect(decryptSecret(encryptSecret('works with a short key'))).toBe(
      'works with a short key'
    )

    env.ENCRYPTION_KEY = 'a'.repeat(500)
    expect(decryptSecret(encryptSecret('works with a long key'))).toBe(
      'works with a long key'
    )
  })
})
