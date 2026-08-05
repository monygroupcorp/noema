import type { Tractus } from '../types/collectio.js'

// =============================================================================
// rarityReport — imagined (target) vs realized rarity per trait axis
// =============================================================================
//
// Pure. Given the trait grid (the TARGET) and the attributes stamped on the
// pieces actually produced (the REALIZED), report, per axis per value:
//   - targetRarity   — the value's weight normalised within its axis [0,1].
//                       The "imagined" distribution the creator dialled in.
//   - realizedCount   — how many produced pieces actually got this value.
//   - realizedRarity  — realizedCount / totalPieces [0,1].
//
// A creator reads this as "target 1% vs current 0.4% (3/750)" and rerolls or
// adjusts. Drift between target and realized is EXPECTED at low N — weighted-
// random selection (plus exclusions/tag-rules) only converges in the limit.
//
// The join key mirrors what TraitMixer stamps: a piece's attribute carries
// `trait_type = tract.label ?? tract.porta` and `value = valor.label ?? String(value)`.

export interface RarityValorReport {
  /** The attribute value as stamped (valor.label ?? String(valor.value)). */
  value: string
  /** Target share: this valor's weight normalised within its axis [0,1]. */
  targetRarity: number
  /** Produced pieces that got this value. */
  realizedCount: number
  /** realizedCount / totalPieces [0,1]; 0 when no pieces produced yet. */
  realizedRarity: number
}

export interface RarityAxisReport {
  /** The axis label (tract.label ?? tract.porta) — matches the NFT trait_type. */
  trait_type: string
  valores: RarityValorReport[]
}

export interface RarityReport {
  /** Number of produced pieces the realized figures are computed over. */
  totalPieces: number
  axes: RarityAxisReport[]
}

/**
 * Compute the target-vs-realized rarity table for a collection.
 *
 * @param tractus  the trait grid (the imagined/target distribution)
 * @param pieces   the `_attributes` of each produced piece (one inner array per piece)
 */
export function rarityReport(params: {
  tractus: Tractus[]
  pieces: Array<Array<{ trait_type: string; value: string }>>
}): RarityReport {
  const { tractus, pieces } = params
  const totalPieces = pieces.length

  const axes: RarityAxisReport[] = tractus.map((tract) => {
    const trait_type = tract.label ?? tract.porta
    const weightSum = tract.valores.reduce((sum, v) => sum + (v.rarity ?? 0.5), 0)

    const valores: RarityValorReport[] = tract.valores.map((valor) => {
      const value = valor.label ?? String(valor.value)
      const targetRarity = weightSum > 0 ? (valor.rarity ?? 0.5) / weightSum : 0
      const realizedCount = pieces.filter((attrs) =>
        attrs.some((a) => a.trait_type === trait_type && a.value === value),
      ).length
      return {
        value,
        targetRarity,
        realizedCount,
        realizedRarity: totalPieces > 0 ? realizedCount / totalPieces : 0,
      }
    })

    return { trait_type, valores }
  })

  return { totalPieces, axes }
}
