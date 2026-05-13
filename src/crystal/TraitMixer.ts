import type { Tractus, TraitValor } from '../types/collectio.js'

// =============================================================================
// TraitMixer — deterministic weighted trait selection from Tractus[]
// =============================================================================
//
// Pure TypeScript. No imports from the old JS codebase.
// Implements deterministic weighted-random selection using a Park-Miller LCG.
//
// The same metadata that makes the canvas display input ports with human-
// readable labels is exactly the metadata the TraitMixer needs to generate
// NFT JSON attributes. A port's `label` becomes the NFT `trait_type`.
// A selected option's `label` becomes the NFT `value`.

/**
 * Park-Miller LCG: given a seed integer, returns a float in [0, 1).
 * Deterministic — same seed always yields same result.
 */
function lcg(seed: number): number {
  const s = (Math.imul(seed, 48271) + 1) & 0x7fffffff
  return s / 0x7fffffff
}

/**
 * Compute the deterministic seed for a given tractus index and piece index.
 */
function seedFor(tractusIndex: number, pieceIndex: number): number {
  return ((tractusIndex * 2654435761) ^ (pieceIndex * 2246822519)) >>> 0
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface TraitSelection {
  /** Resolved aditus values: porta key → selected valor.value */
  aditus: Record<string, unknown>
  /** Assembled generation prompt */
  prompt: string
  /** NFT-standard attributes array */
  attributes: Array<{ trait_type: string; value: string }>
}

/**
 * Select one TraitValor per Tractus for a given pieceIndex.
 *
 * Algorithm (for each tractus, left-to-right):
 *   1. Filter out valores whose `excludes` list contains the label ?? String(value)
 *      of any already-selected option in a prior tractus.
 *   2. Compute total weight = sum of rarity ?? 0.5 for each candidate.
 *   3. Use deterministic LCG seeded from tractusIndex + pieceIndex to pick.
 *   4. Record winner.
 */
export function selectForPiece(params: {
  tractus: Tractus[]
  pieceIndex: number
  basePrompt?: string
  collectionName?: string
  totalPieces?: number
}): TraitSelection {
  const { tractus, pieceIndex, basePrompt } = params

  if (tractus.length === 0) {
    return { aditus: {}, prompt: basePrompt ?? '', attributes: [] }
  }

  // Track selected labels for exclusion checking (label ?? String(value))
  const selectedLabels = new Set<string>()
  const winners: Array<{ tractus: Tractus; valor: TraitValor }> = []

  for (let ti = 0; ti < tractus.length; ti++) {
    const tract = tractus[ti]
    const seed = seedFor(ti, pieceIndex)

    // Step 1: filter out excluded options
    let candidates = tract.valores.filter(v => {
      if (!v.excludes || v.excludes.length === 0) return true
      return !v.excludes.some(ex => selectedLabels.has(ex))
    })

    // Fallback: if all candidates are excluded (shouldn't happen in practice),
    // use all valores
    if (candidates.length === 0) {
      candidates = tract.valores
    }

    let winner: TraitValor

    if (candidates.length === 1) {
      // Single candidate — always wins regardless of rarity
      winner = candidates[0]
    } else {
      // Step 2: compute total weight
      const totalWeight = candidates.reduce((sum, v) => sum + (v.rarity ?? 0.5), 0)

      if (totalWeight <= 0) {
        // All weights are zero — pick uniformly using LCG
        const idx = Math.floor(lcg(seed) * candidates.length)
        winner = candidates[idx]
      } else {
        // Step 3: weighted selection via LCG
        const pick = lcg(seed) * totalWeight
        let remaining = pick
        winner = candidates[candidates.length - 1] // default to last
        for (const v of candidates) {
          remaining -= (v.rarity ?? 0.5)
          if (remaining <= 0) {
            winner = v
            break
          }
        }
      }
    }

    // Record selected label for exclusion checking in subsequent tractus
    const winnerLabel = winner.label ?? String(winner.value)
    selectedLabels.add(winnerLabel)
    winners.push({ tractus: tract, valor: winner })
  }

  // ── Prompt assembly ──────────────────────────────────────────────────────────

  let prompt: string

  if (basePrompt !== undefined && basePrompt.includes('{{')) {
    // Token replacement mode: replace {{porta}} with promptFragment ?? label ?? String(value)
    prompt = basePrompt
    for (const { tractus: tract, valor } of winners) {
      const token = `{{${tract.porta}}}`
      if (prompt.includes(token)) {
        const replacement = valor.promptFragment ?? valor.label ?? String(valor.value)
        prompt = prompt.split(token).join(replacement)
      }
    }
  } else {
    // Join mode: [basePrompt, ...promptFragments].filter(Boolean).join(', ')
    const fragments: string[] = []
    if (basePrompt) fragments.push(basePrompt)
    for (const { valor } of winners) {
      if (valor.promptFragment) fragments.push(valor.promptFragment)
    }
    prompt = fragments.join(', ')
  }

  // ── Aditus + attributes ──────────────────────────────────────────────────────

  const aditus: Record<string, unknown> = {}
  const attributes: Array<{ trait_type: string; value: string }> = []

  for (const { tractus: tract, valor } of winners) {
    aditus[tract.porta] = valor.value
    attributes.push({
      trait_type: tract.label ?? tract.porta,
      value: valor.label ?? String(valor.value),
    })
  }

  return { aditus, prompt, attributes }
}

/**
 * Generate the NFT name for a piece.
 * Returns `${collectionName} #${pieceIndex + 1}` or `Piece #${pieceIndex + 1}`.
 */
export function nftName(params: { collectionName?: string; pieceIndex: number }): string {
  const prefix = params.collectionName ?? 'Piece'
  return `${prefix} #${params.pieceIndex + 1}`
}
