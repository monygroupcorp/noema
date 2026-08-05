import { randomBytes } from 'node:crypto'

/**
 * Look-alike-free base32-ish alphabet: lowercase letters minus `i l o` and digits
 * minus `0 1`. 31 symbols — close to a clean base32 while staying human-typeable and
 * unambiguous when read aloud or copied from a forwarded card.
 */
export const SHARE_TOKEN_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const SHARE_TOKEN_LENGTH   = 16   // ~80 bits of entropy at base-31

/**
 * Mint an unguessable share token for a pod (PodPolicy='link').
 *
 * Tokens are opaque, single-use-per-pod, and unguessable: 16 chars over a 31-symbol
 * alphabet ≈ 78.5 bits of entropy — well past any practical online enumeration.
 * Generation uses `crypto.randomBytes`; the modulo skew is negligible at this size
 * (31 vs 256 → max bias ~3.5%, irrelevant for unguessability).
 */
export function mintShareToken(): string {
  const buf = randomBytes(SHARE_TOKEN_LENGTH)
  let out = ''
  for (let i = 0; i < SHARE_TOKEN_LENGTH; i++) {
    out += SHARE_TOKEN_ALPHABET[buf[i] % SHARE_TOKEN_ALPHABET.length]
  }
  return out
}
