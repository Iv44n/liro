import {
  createCipheriv,
  createDecipheriv,
  randomBytes as randomBytesNode
} from 'node:crypto'
import { env } from '#shared/config/env'

/**
 * AES-256-GCM encryption for secrets stored at rest (webhook secrets, Slack
 * webhook URLs, ...). `ENCRYPTION_KEY` can be any string — it's hashed with
 * SHA-256 to a 32-byte key, so operators don't have to hand-craft raw key
 * material; generating one is as simple as `openssl rand -hex 32`.
 *
 * Every ciphertext is prefixed with the id of the key that was current when
 * it was produced (`k1`, `ENCRYPTION_KEY`); an optional
 * `ENCRYPTION_KEY_PREVIOUS` is key id `k0`, never used to encrypt. To
 * rotate: move the current `ENCRYPTION_KEY` value into
 * `ENCRYPTION_KEY_PREVIOUS`, then set a new `ENCRYPTION_KEY`.
 *
 * The label is only a hint, not the source of truth: `ENCRYPTION_KEY` is
 * rotated *in place*, so right after a rotation a value still labeled `k1`
 * may actually have been encrypted under the generation that is now `k0`.
 * `decryptSecret` therefore tries the labeled key first and, if that fails
 * to authenticate, falls back to the other configured key — so rotating
 * never breaks values written before the rotation, and no re-encryption
 * migration is required. This module only keeps two generations at a time:
 * once `ENCRYPTION_KEY_PREVIOUS` itself is retired, anything still relying
 * on it must be re-encrypted first (out of scope here).
 */

const CURRENT_KEY_ID = 'k1'
const PREVIOUS_KEY_ID = 'k0'
const IV_BYTES = 12
const TAG_BYTES = 16
const ALGORITHM = 'aes-256-gcm'

function deriveKey(secret: string): Buffer {
  return Buffer.from(new Bun.CryptoHasher('sha256').update(secret).digest())
}

/** Resolves the raw AES key for a key id, throwing a clear error if the env var it needs isn't set. */
function keyFor(keyId: string): Buffer {
  if (keyId === CURRENT_KEY_ID) {
    if (!env.ENCRYPTION_KEY) {
      throw new Error(
        'ENCRYPTION_KEY is not set. Set it to any secret string (e.g. the ' +
          'output of `openssl rand -hex 32`) to encrypt or decrypt secrets at rest.'
      )
    }
    return deriveKey(env.ENCRYPTION_KEY)
  }

  if (keyId === PREVIOUS_KEY_ID) {
    if (!env.ENCRYPTION_KEY_PREVIOUS) {
      throw new Error(
        'This value was encrypted with the previous key (id "k0"), but ' +
          'ENCRYPTION_KEY_PREVIOUS is not set.'
      )
    }
    return deriveKey(env.ENCRYPTION_KEY_PREVIOUS)
  }

  throw new Error(`Unknown encryption key id "${keyId}"`)
}

/** Whether the env var backing a key id is set, without throwing. */
function hasKey(keyId: string): boolean {
  if (keyId === CURRENT_KEY_ID) return Boolean(env.ENCRYPTION_KEY)
  if (keyId === PREVIOUS_KEY_ID) return Boolean(env.ENCRYPTION_KEY_PREVIOUS)
  return false
}

function decryptWith(
  key: Buffer,
  iv: Buffer,
  ciphertext: Buffer,
  tag: Buffer
): string {
  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]).toString('utf8')
}

/** `'k1:' + base64url(iv ‖ ciphertext ‖ tag)`, always encrypted under the current key. */
export function encryptSecret(plain: string): string {
  const key = keyFor(CURRENT_KEY_ID)
  const iv = randomBytesNode(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plain, 'utf8'),
    cipher.final()
  ])
  const tag = cipher.getAuthTag()
  const payload = Buffer.concat([iv, ciphertext, tag])
  return `${CURRENT_KEY_ID}:${payload.toString('base64url')}`
}

/**
 * Reverses {@link encryptSecret}. Tries the key the label points to first,
 * then — if that key decrypts but fails to authenticate — falls back to the
 * other configured key (see the module doc comment for why: rotation moves
 * the key, not the label). Throws on a bad key id, missing key, or a value
 * that fails to authenticate under every configured key.
 */
export function decryptSecret(value: string): string {
  const separator = value.indexOf(':')
  if (separator === -1) {
    throw new Error('Malformed encrypted value: missing key id prefix')
  }

  const keyId = value.slice(0, separator)
  const encoded = value.slice(separator + 1)
  // Throws its own clear "not set" error immediately if the labeled key's
  // env var isn't configured at all — that's a config problem, not a
  // rotation, so it's not worth falling back for.
  const primaryKey = keyFor(keyId)

  // `Buffer.from(_, 'base64url')` never throws on malformed input — it just
  // decodes leniently — so garbage payloads are caught below, either by the
  // length check or by GCM's authentication tag failing to verify.
  const payload = Buffer.from(encoded, 'base64url')
  if (payload.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Malformed encrypted value: payload too short')
  }

  const iv = payload.subarray(0, IV_BYTES)
  const tag = payload.subarray(payload.length - TAG_BYTES)
  const ciphertext = payload.subarray(IV_BYTES, payload.length - TAG_BYTES)

  try {
    return decryptWith(primaryKey, iv, ciphertext, tag)
  } catch {
    const fallbackKeyId =
      keyId === CURRENT_KEY_ID ? PREVIOUS_KEY_ID : CURRENT_KEY_ID
    if (hasKey(fallbackKeyId)) {
      try {
        return decryptWith(keyFor(fallbackKeyId), iv, ciphertext, tag)
      } catch {
        // Falls through to the shared error below.
      }
    }
    throw new Error(
      'Failed to decrypt value: wrong key, or the value was corrupted or tampered with'
    )
  }
}
