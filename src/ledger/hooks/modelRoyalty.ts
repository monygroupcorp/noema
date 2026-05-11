import type { SignumHook } from '../../types/nexus.js'

const MODEL_ROYALTY_RATE = 5n   // 5% of impetus, split equally

export const modelRoyaltyHook: SignumHook<'execution_spend'> = async (event) => {
  const { impetus, intellaAuctorAnimaIds } = event.payload
  if (!intellaAuctorAnimaIds?.length || impetus === 0n) return []

  const pool = (impetus * MODEL_ROYALTY_RATE) / 100n
  const count = BigInt(intellaAuctorAnimaIds.length)
  const share = pool / count

  if (share === 0n) return []

  return intellaAuctorAnimaIds.map(animaId => ({
    animaId,
    forma: 'reward' as const,
    valor: share,
    auctor: 'nexus:modelRoyalty',
  }))
}
