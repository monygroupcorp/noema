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
 * `attempt` salts the seed for DNA-dedup rerolls — attempt 0 reproduces the
 * historical (un-salted) seed exactly, so non-dedup behaviour is unchanged.
 */
function seedFor(tractusIndex: number, pieceIndex: number, attempt = 0): number {
  return ((tractusIndex * 2654435761) ^ (pieceIndex * 2246822519) ^ (attempt * 40503)) >>> 0
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface TraitSelection {
  /** Resolved aditus values: porta key → selected valor.value */
  aditus: Record<string, unknown>
  /** Assembled generation prompt */
  prompt: string
  /** NFT-standard attributes array */
  attributes: Array<{ trait_type: string; value: string }>
  /**
   * Canonical DNA fingerprint of this selection over the non-`bypassDNA` axes.
   * Two pieces with the same `dna` are duplicate combinations. The caller
   * (CollectioCursor) tracks these to enforce uniqueness when opted in.
   */
  dna: string
}

/** The canonical DNA key for a set of winners, ignoring `bypassDNA` axes. */
function dnaKey(winners: Array<{ tractus: Tractus; valor: TraitValor }>): string {
  return winners
    .filter(({ tractus }) => !tractus.bypassDNA)
    .map(({ tractus, valor }) => `${tractus.porta}=${valor.label ?? String(valor.value)}`)
    .sort()
    .join('|')
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
  /**
   * Tag-group mutual exclusion rules.
   * Each inner array is a mutually exclusive group of tags: once any valor
   * with a tag from that group is selected, all subsequent valors carrying
   * any OTHER tag from the same group are filtered out.
   *
   * Example: [['fantasy', 'sci-fi'], ['summer', 'winter']]
   * → 'fantasy' and 'sci-fi' themed options never appear on the same piece.
   */
  tagRules?: string[][]
  /**
   * DNA-dedup ledger: the canonical DNA keys already produced by this collection.
   * When provided, the mixer rerolls (salting the seed) until it finds a unique
   * combination, up to `maxDnaAttempts`. Absent → no dedup (duplicates allowed).
   */
  usedDna?: Set<string>
  /** Max reroll attempts before accepting a colliding combination. Default 64. */
  maxDnaAttempts?: number
}): TraitSelection {
  const { tractus, pieceIndex, basePrompt, tagRules, usedDna } = params

  if (tractus.length === 0) {
    return { aditus: {}, prompt: basePrompt ?? '', attributes: [], dna: '' }
  }

  // One deterministic selection pass over the grid for a given reroll `attempt`.
  const selectWinners = (attempt: number): Array<{ tractus: Tractus; valor: TraitValor }> => {
    // Track selected labels for label-level exclusion (label ?? String(value))
    const selectedLabels = new Set<string>()
    // Track which tags are blocked by tag-group rules
    const blockedTags = new Set<string>()
    const winners: Array<{ tractus: Tractus; valor: TraitValor }> = []

    for (let ti = 0; ti < tractus.length; ti++) {
      const tract = tractus[ti]
      const seed = seedFor(ti, pieceIndex, attempt)

      // Step 1: filter out excluded options (label-level + tag-group level)
      let candidates = tract.valores.filter(v => {
        // Label-level exclusion: valor.excludes lists specific labels to block
        if (v.excludes?.some(ex => selectedLabels.has(ex))) return false
        // Tag-group exclusion: valor's tags overlap with blocked tags
        if (v.tags?.some(t => blockedTags.has(t))) return false
        return true
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

      // Record selected label for label-level exclusion in subsequent tractus
      const winnerLabel = winner.label ?? String(winner.value)
      selectedLabels.add(winnerLabel)

      // Update blocked tags: for each tag-group rule, if the winner carries a tag
      // from that group, block all OTHER tags in that group for subsequent tractus.
      if (tagRules && winner.tags && winner.tags.length > 0) {
        for (const group of tagRules) {
          const matchedTag = winner.tags.find(t => group.includes(t))
          if (matchedTag !== undefined) {
            for (const t of group) {
              if (t !== matchedTag) blockedTags.add(t)
            }
          }
        }
      }

      winners.push({ tractus: tract, valor: winner })
    }

    return winners
  }

  // Reroll until the DNA is unique (when a dedup ledger is supplied), else
  // accept the un-salted attempt. Falls back to the last attempt if the grid is
  // exhausted (uniqueness unsatisfiable) — duplicates are then unavoidable.
  const maxAttempts = usedDna ? Math.max(1, params.maxDnaAttempts ?? 64) : 1
  let winners = selectWinners(0)
  let dna = dnaKey(winners)
  if (usedDna) {
    for (let attempt = 1; attempt < maxAttempts && usedDna.has(dna); attempt++) {
      winners = selectWinners(attempt)
      dna = dnaKey(winners)
    }
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

  return { aditus, prompt, attributes, dna }
}

/**
 * Generate the NFT name for a piece.
 * Returns `${collectionName} #${pieceIndex + 1}` or `Piece #${pieceIndex + 1}`.
 */
export function nftName(params: { collectionName?: string; pieceIndex: number }): string {
  const prefix = params.collectionName ?? 'Piece'
  return `${prefix} #${params.pieceIndex + 1}`
}
