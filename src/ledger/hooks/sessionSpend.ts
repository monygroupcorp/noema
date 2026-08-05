import type { SignumHook } from '../../types/nexus.js'

const PLATFORM_ANIMA_ID = process.env.PLATFORM_ANIMA_ID ?? 'platform'

export const sessionSpendHook: SignumHook<'session_spend'> = async (event) => {
  const { impetus } = event.payload
  if (impetus === 0n) return []

  return [{
    animaId: PLATFORM_ANIMA_ID,
    forma: 'reward' as const,
    valor: impetus,
    auctor: 'nexus:sessionSpend',
  }]
}
