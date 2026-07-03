// =============================================================================
// secretBox — authenticated envelope encryption for BYO secrets (AES-256-GCM).
// =============================================================================
//
// A `SecretBox` seals a plaintext token into a `{ ciphertext, iv, authTag, keyId }`
// envelope and opens it back. Used by the `Secretarium` store so a user's gated-origin
// credential (Civitai / HuggingFace token) is never persisted in the clear.
//
// KEY MANAGEMENT — a small keyring supports rotation:
//   • Each key has a deterministic `keyId` = first 16 hex of sha256(key), so the same
//     32-byte key always yields the same id and can be matched at open-time.
//   • The FIRST key in the ring is the active one used to SEAL; ANY key in the ring can
//     OPEN (matched by the envelope's `keyId`). Rotation = prepend a new key, keep the
//     old one until every secret has been re-sealed (or aged out).
//
// The master key(s) come from `SECRETA_MASTER_KEY` (comma-separated for a rotation ring;
// each a 32-byte key as 64-hex or base64). Absent/invalid → `secretBoxFromEnv` returns
// null and the whole BYO-secrets feature is gated off (endpoints 501).
//
// Never logged, never read back to any API caller. `openBox` throws on a tampered
// envelope (GCM auth-tag mismatch) or an unknown `keyId`.
// =============================================================================

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_BYTES = 32

/** The at-rest envelope. All binary fields are base64. */
export interface SealedBox {
  ciphertext: string
  iv: string
  authTag: string
  keyId: string
}

export interface SecretBox {
  seal(plaintext: string): SealedBox
  open(box: SealedBox): string
}

/** Deterministic id for a key — lets `open` pick the right ring member. */
function keyIdOf(key: Buffer): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

/**
 * Build a SecretBox over a keyring. `keyring[0]` is the active seal key; all are
 * open candidates. Throws if empty or any key is the wrong length.
 */
export function makeSecretBox(keyring: Buffer[]): SecretBox {
  if (!keyring.length) throw new Error('secretBox: keyring must have at least one key')
  const byId = new Map<string, Buffer>()
  for (const key of keyring) {
    if (key.length !== KEY_BYTES) throw new Error(`secretBox: keys must be ${KEY_BYTES} bytes, got ${key.length}`)
    byId.set(keyIdOf(key), key)
  }
  const active = keyring[0]
  const activeId = keyIdOf(active)

  return {
    seal(plaintext: string): SealedBox {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv(ALGO, active, iv)
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const authTag = cipher.getAuthTag()
      return {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64'),
        keyId: activeId,
      }
    },
    open(box: SealedBox): string {
      const key = byId.get(box.keyId)
      if (!key) throw new Error(`secretBox: no key for keyId '${box.keyId}'`)
      const decipher = createDecipheriv(ALGO, key, Buffer.from(box.iv, 'base64'))
      decipher.setAuthTag(Buffer.from(box.authTag, 'base64'))
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(box.ciphertext, 'base64')),
        decipher.final(), // throws on auth-tag mismatch (tampered envelope)
      ])
      return plaintext.toString('utf8')
    },
  }
}

/** Parse one key from 64-hex or base64 into a 32-byte Buffer, or null if malformed. */
function parseKey(raw: string): Buffer | null {
  const s = raw.trim()
  if (!s) return null
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex')
  try {
    const b = Buffer.from(s, 'base64')
    return b.length === KEY_BYTES ? b : null
  } catch {
    return null
  }
}

/**
 * Build a SecretBox from `SECRETA_MASTER_KEY` (comma-separated rotation ring). Returns
 * null when unset or no valid key parses — the caller gates the feature off. Malformed
 * members are skipped (a partially-bad ring still works on its valid keys).
 */
export function secretBoxFromEnv(env: NodeJS.ProcessEnv = process.env): SecretBox | null {
  const raw = env.SECRETA_MASTER_KEY
  if (!raw) return null
  const keys = raw.split(',').map(parseKey).filter((k): k is Buffer => k !== null)
  if (!keys.length) return null
  return makeSecretBox(keys)
}
