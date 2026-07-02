// =============================================================================
// passwordHash — scrypt password hashing (no native dependency).
// =============================================================================
//
// We hash with Node's built-in `crypto.scrypt` (a memory-hard KDF) rather than
// bcrypt/argon2 — those are NATIVE modules that complicate the Node-20 staging
// build, and scrypt is a first-class, well-vetted KDF already in the runtime. This
// is a conscious deviation from the handoff's "argon2id/bcrypt" (docs/spec/fiat-auth.md).
//
// The stored envelope is self-describing so the cost parameters can evolve without
// a migration — a verify reads N/r/p out of the stored string:
//
//     scrypt$<N>$<r>$<p>$<saltBase64>$<hashBase64>
//
// `verifyPassword` is constant-time (`timingSafeEqual`) and tolerant of a malformed
// or foreign-algorithm envelope (returns false, never throws).
// =============================================================================

import { scrypt as _scrypt, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(_scrypt) as (password: string | Buffer, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>

// Cost parameters. N=2^15 (32768) is a sensible interactive-login target; r/p standard.
// maxmem must exceed ~128*N*r bytes, so give scrypt generous headroom.
const N = 32768
const R = 8
const P = 1
const KEYLEN = 32
const SALT_BYTES = 16
const MAXMEM = 128 * N * R * 2

/** Hash a plaintext password into a self-describing scrypt envelope. */
export async function hashPassword(plaintext: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const hash = await scrypt(plaintext, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

/** Constant-time verify. Returns false for any malformed / non-scrypt envelope. */
export async function verifyPassword(plaintext: string, envelope: string): Promise<boolean> {
  const parts = typeof envelope === 'string' ? envelope.split('$') : []
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4], 'base64')
    expected = Buffer.from(parts[5], 'base64')
  } catch {
    return false
  }
  if (expected.length === 0) return false
  let actual: Buffer
  try {
    actual = await scrypt(plaintext, salt, expected.length, { N: n, r, p, maxmem: 128 * n * r * 2 })
  } catch {
    return false
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
