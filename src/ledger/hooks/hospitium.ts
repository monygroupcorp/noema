import type { SignumHook } from '../../types/nexus.js'
import { WARM_SURCHARGE_IMPETUS, HOST_BONUS_RATE } from '../rates.js'

/**
 * hospitiumHook — the ambassador bonus paid to a pod's host on every guest gen.
 *
 * Where the guest's WARM_SURCHARGE_IMPETUS surcharge goes: HOST_BONUS_RATE % of
 * it lands on the host (a separate stream from hostCutHook's 20% × base profit
 * cut); the platform retains the rest. Fires only when the spend payload carries
 * a `modoHostKey` — i.e. only on guest-tier runs against a hosted pod. Owner /
 * admin / no-Hospitium paths produce no signum here.
 *
 * Branches on the HostKey discriminant identically to hostCutHook:
 *   - `{animaId}`    → identified host receives a `reward` signum
 *   - `{commitment}` → anonymous host receives an `arcanum` signum, no animaId
 *
 * `auctor: 'nexus:hospitium'` distinguishes this stream from `nexus:hostCut`
 * on the host's ledger so earnings can be presented separately on the bulletin.
 */
export const hospitiumHook: SignumHook<'execution_spend'> = async (event) => {
  const { modoHostKey, actum } = event.payload
  if (!modoHostKey) return []

  const valor = (WARM_SURCHARGE_IMPETUS * HOST_BONUS_RATE) / 100n
  if (valor === 0n) return []

  // contextId carries the studio (Materia.id) so /status + bulletin can sum
  // per-studio earnings. Same shape as hostCutHook's attribution.
  const ctx = actum.materiamId ? { contextId: actum.materiamId } : {}

  if ('animaId' in modoHostKey) {
    return [{
      animaId: modoHostKey.animaId,
      forma: 'reward' as const,
      valor,
      auctor: 'nexus:hospitium',
      ...ctx,
    }]
  }
  return [{
    forma: 'arcanum' as const,
    valor,
    auctor: 'nexus:hospitium',
    testis: modoHostKey.commitment,
    ...ctx,
  }]
}
