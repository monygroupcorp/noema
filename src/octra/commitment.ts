// =============================================================================
// commitment — canonical wire encoding + strict validation for OCT-rail
// =============================================================================
//
// One rule, used everywhere a commitment is serialized or parsed. The wire form
// is byte-identical to the EVM rail's bytes32 so a single commitment is valid on
// either rail. arcanumTree.insert expects the DECIMAL field-element string.
// =============================================================================

import { BN254_FIELD_ORDER } from '../types/octra.js'

/** decimal field-element string → canonical 0x + 64 lowercase hex (66 chars). */
export function commitmentToWire(decimal: string): string {
  const v = BigInt(decimal)
  if (v <= 0n || v >= BN254_FIELD_ORDER) {
    throw new Error('commitment out of field range')
  }
  return '0x' + v.toString(16).padStart(64, '0')
}

/**
 * Parse + STRICTLY validate a wire commitment. Returns the decimal string for
 * arcanumTree.insert, or null if invalid. Order matters:
 *   1. require 0x + exactly 64 lowercase hex
 *   2. parse to integer in [1, BN254_FIELD_ORDER)
 *   3. canonical re-encode must equal the input (rejects decimal aliases,
 *      mixed case, non-padded forms) — prevents two strings aliasing one leaf
 */
export function parseCommitment(raw: string | null | undefined): string | null {
  if (raw == null) return null
  if (!/^0x[0-9a-f]{64}$/.test(raw)) return null
  let value: bigint
  try {
    value = BigInt(raw)
  } catch {
    return null
  }
  if (value <= 0n || value >= BN254_FIELD_ORDER) return null
  if ('0x' + value.toString(16).padStart(64, '0') !== raw) return null
  return value.toString()
}
