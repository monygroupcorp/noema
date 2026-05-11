import type { SignumHook } from '../../types/nexus.js'

const HOST_CUT_RATE = 20n   // 20% of impetus

export const hostCutHook: SignumHook<'execution_spend'> = async (event) => {
  const { impetus, modoHostAnimaId } = event.payload
  if (!modoHostAnimaId || impetus === 0n) return []

  return [{
    animaId: modoHostAnimaId,
    forma: 'reward' as const,
    valor: (impetus * HOST_CUT_RATE) / 100n,
    auctor: 'nexus:hostCut',
  }]
}
