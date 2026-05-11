import type { SignumHook } from '../../types/nexus.js'

const PLATFORM_SKIM_RATE = 5n   // 5% of baseValor

// The platform's own animaId — set via env; falls back to a named sentinel so
// the ledger entry is always attributable even in dev without config.
const PLATFORM_ANIMA_ID = process.env.PLATFORM_ANIMA_ID ?? 'platform'

export const platformSkimHook: SignumHook<'royalty_fired'> = async (event) => {
  const { baseValor } = event.payload
  if (baseValor === 0n) return []

  const skim = (baseValor * PLATFORM_SKIM_RATE) / 100n
  if (skim === 0n) return []

  return [{
    animaId: PLATFORM_ANIMA_ID,
    forma: 'reward' as const,
    valor: skim,
    auctor: 'nexus:platformSkim',
  }]
}
