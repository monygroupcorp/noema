import type { SignumHook } from '../../types/nexus.js'

const MODEL_ROYALTY_RATE = 5n   // 5% of impetus, split equally

export const modelRoyaltyHook: SignumHook<'execution_spend'> = async (event) => {
  const { impetus, intellaAuctorAnimaIds, intellaRoyaltyPayees } = event.payload
  if (impetus === 0n) return []

  const pool = (impetus * MODEL_ROYALTY_RATE) / 100n
  if (pool === 0n) return []

  // A weighted split (a published Editio's owners[]) takes precedence — the
  // publishing layer owns who-earns (publishing.md §5e). Each payee gets
  // pool * (weight / Σweight); rounding dust stays unspent (as with the floor below).
  if (intellaRoyaltyPayees?.length) {
    const total = intellaRoyaltyPayees.reduce((s, p) => s + (p.weight > 0 ? p.weight : 0), 0)
    if (total <= 0) return []
    return intellaRoyaltyPayees
      .filter(p => p.weight > 0)
      .map(p => ({
        animaId: p.animaId,
        forma: 'reward' as const,
        valor: (pool * BigInt(Math.round((p.weight / total) * 1_000_000))) / 1_000_000n,
        auctor: 'nexus:modelRoyalty' as const,
      }))
      .filter(s => s.valor > 0n)
  }

  // Fallback: equal split across the model authors.
  if (!intellaAuctorAnimaIds?.length) return []
  const share = pool / BigInt(intellaAuctorAnimaIds.length)
  if (share === 0n) return []

  return intellaAuctorAnimaIds.map(animaId => ({
    animaId,
    forma: 'reward' as const,
    valor: share,
    auctor: 'nexus:modelRoyalty',
  }))
}
