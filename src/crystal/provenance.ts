import { createHash } from 'node:crypto'
import type { Tractus } from '../types/collectio.js'

// =============================================================================
// provenance — content-address a Collectio's generative configuration
// =============================================================================
//
// The provenance hash is the NFT "provenance hash" + our content-addressing
// ethos: a stable digest over the inputs that DEFINE what a collection will
// generate — the flow, the trait grid, and the base aditus. Any change to a
// trait, a weight, the base prompt, or the flow version yields a different
// hash → a provably different (versioned) input. Two Collectiones with the
// same hash are generating from the same definition.
//
// It does NOT cover ownership, naming, concurrency, or progress — only the
// generative substance. Pure: same input → same hash, on any machine.

/** The generative substance a Collectio's provenance hash content-addresses. */
export interface ProvenanceInput {
  modusId: string
  /** The flow version, when known — pins the hash to a specific flow revision. */
  modusVersio?: string
  tractus: Tractus[]
  aditusBase: Record<string, unknown>
}

/**
 * Recursively canonicalise a JSON-safe value: object keys are sorted so that
 * key order never affects the digest. Arrays keep their order (it is
 * meaningful — e.g. tractus order drives prompt assembly).
 */
function canonicalise(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalise)
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    out[key] = canonicalise(obj[key])
  }
  return out
}

/**
 * Content-address a Collectio's generative configuration → `sha256:<hex>`.
 * Stable across machines and key ordering; sensitive to any substantive change.
 */
export function provenanceHash(input: ProvenanceInput): string {
  const canonical = canonicalise({
    modusId: input.modusId,
    modusVersio: input.modusVersio ?? null,
    tractus: input.tractus,
    aditusBase: input.aditusBase,
  })
  const digest = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  return `sha256:${digest}`
}
