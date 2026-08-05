import { createHash } from 'crypto'
import type { Modus } from '../types/modus.js'

/**
 * Produce a stable SHA-256 content hash for a Modus definition.
 *
 * Covers all fields that define what the modus IS and DOES.
 * Excludes: contentHash (self-referential), natum, mutatum (metadata timestamps).
 *
 * bigint impetusFixum serialised as "bigint:<value>" to distinguish
 * from a numeric string of the same value.
 */
export function hashModus(modus: Modus): string {
  // `descriptio` is inert flow-level display/routing metadata (the concierge's "when to
  // pick this" line) — excluded so a copy edit never re-hashes a modus and breaks
  // deployment identity/caching. Same "not part of the workflow definition" reasoning as
  // the computeStrategy/gpuClass/podPolicy execution preferences (modus.ts).
  const { contentHash: _ch, natum: _n, mutatum: _m, impetusFixum, descriptio: _d, ...rest } = modus

  const payload: Record<string, unknown> = { ...rest }
  if (impetusFixum !== undefined) payload.impetusFixum = `bigint:${impetusFixum}`

  const json = JSON.stringify(payload, sortedReplacer)
  return createHash('sha256').update(json).digest('hex')
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    )
  }
  return value
}
