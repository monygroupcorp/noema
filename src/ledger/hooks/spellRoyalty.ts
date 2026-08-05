import type { SignumHook } from '../../types/nexus.js'

const SPELL_ROYALTY_RATE = 10n   // 10% of impetus

export const spellRoyaltyHook: SignumHook<'execution_spend'> = async (event) => {
  const { impetus, modusAuctorAnimaId } = event.payload
  if (!modusAuctorAnimaId || impetus === 0n) return []

  return [{
    animaId: modusAuctorAnimaId,
    forma: 'reward' as const,
    valor: (impetus * SPELL_ROYALTY_RATE) / 100n,
    auctor: 'nexus:spellRoyalty',
  }]
}
