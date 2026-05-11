import type { SignumHook } from '../../types/nexus.js'

const REFERRAL_RATE = 5n   // 5% of deposit valor

export const referralSplitHook: SignumHook<'deposit_confirmed'> = async (event) => {
  const { signum, referrerAnimaId } = event.payload
  if (!referrerAnimaId || signum.valor === 0n) return []

  const share = (signum.valor * REFERRAL_RATE) / 100n
  if (share === 0n) return []

  return [{
    animaId: referrerAnimaId,
    forma: 'reward' as const,
    valor: share,
    auctor: 'nexus:referralSplit',
  }]
}
