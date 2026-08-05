import type { SignumHook } from '../../types/nexus.js'

const MODEL_ROYALTY_RATE = 5n   // 5% of impetus, split equally

const WEIGHT_SCALE = 1_000_000   // weights are floats (0..1); scale to integers for exact bigint math

export const modelRoyaltyHook: SignumHook<'execution_spend'> = async (event) => {
  const { impetus, intellaRoyaltyPayees } = event.payload
  if (impetus === 0n || !intellaRoyaltyPayees?.length) return []

  const pool = (impetus * MODEL_ROYALTY_RATE) / 100n
  if (pool === 0n) return []

  // Split the pool across the payees by weight: valor = pool × wᵢ / Σw, in pure
  // bigint after scaling the float weights to integers. Equal weights reduce to an
  // exact pool/n floor; unequal weights honour a published Editio.owners[] split
  // (publishing.md §5e). Floor-division dust stays unspent.
  const scaled = intellaRoyaltyPayees
    .map(p => ({ animaId: p.animaId, w: BigInt(Math.round((p.weight > 0 ? p.weight : 0) * WEIGHT_SCALE)) }))
    .filter(p => p.w > 0n)
  const total = scaled.reduce((s, p) => s + p.w, 0n)
  if (total === 0n) return []

  return scaled
    .map(p => ({
      animaId: p.animaId,
      forma: 'reward' as const,
      valor: (pool * p.w) / total,
      auctor: 'nexus:modelRoyalty' as const,
    }))
    .filter(s => s.valor > 0n)
}
