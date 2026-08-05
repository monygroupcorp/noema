// =============================================================================
// ownerKeyOf — collapse an `AuctorKey` to one stable, opaque owner key.
// =============================================================================
//
// The crystal identity union is `{ animaId } | { commitment } | { bursaToken }`. Features
// that own data per-caller (BYO secrets; owner-scoped imports) need ONE stable string to
// key on, independent of which identity kind the caller presented. `ownerKeyOf` is that
// derivation.
//
// The two BEARER-secret discriminants (`bursaToken`, `commitment`) are HASHED, never stored
// raw — a leak of a secret store's keys must not reconstruct a spend token. `animaId` is an
// internal id (not a bearer credential), so it stays readable for ops/debugging.
//
// Durability note: `Bursa.id === token` (src/types/bursa.ts) and there is no token-reissue
// path, so a purse's token IS its stable, durable provisioned id — hashing it yields a key
// that persists for the life of the purse. A raw arcanum `commitment` is per-spend/ephemeral;
// a secret keyed on it dies with the note (acceptable, documented).
// =============================================================================

import { createHash } from 'node:crypto'
import type { AuctorKey } from '../flow/types.js'

export type OwnerKey = string

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** Pure, synchronous. Same `AuctorKey` → same `OwnerKey`, always. */
export function ownerKeyOf(auctor: AuctorKey): OwnerKey {
  if ('animaId' in auctor) return `anima:${auctor.animaId}`
  if ('bursaToken' in auctor) return `bursa:${sha256(auctor.bursaToken)}`
  return `commitment:${sha256(auctor.commitment)}`
}

/**
 * Whether `ownerKey` owns an object carrying owner fields — matches the generic `ownerKey` or a
 * legacy `ownerAnimaId` record (lifted to `anima:<id>`, migration-free). No owner key → not owned.
 * Shared by the Compiler's private-model gate and the weight-proxy's authz chain so both decide
 * ownership identically.
 */
export function ownsBy(owner: { ownerKey?: string; ownerAnimaId?: string }, ownerKey?: string): boolean {
  if (!ownerKey) return false
  if (owner.ownerKey && owner.ownerKey === ownerKey) return true
  if (owner.ownerAnimaId && `anima:${owner.ownerAnimaId}` === ownerKey) return true
  return false
}
