import type { SignumHook } from '../../types/nexus.js'

const PLATFORM_ANIMA_ID = process.env.PLATFORM_ANIMA_ID ?? 'platform'

/**
 * studioSpendHook — emits the two-sided ledger entries for one studio billing tick.
 *
 * Fires on `studio_spend` events from the `StudioBilling` ticker (which has
 * already clamped `impetus` to the host's available balance). The hook is pure:
 * given the (clamped) impetus + hostKey, it returns
 *
 *   1. A debit signum on the host's account — negative-valor, branched on the
 *      HostKey discriminant just like hostCutHook/hospitiumHook:
 *        `{animaId}`    → `forma: 'integer', valor: -impetus`
 *        `{commitment}` → `forma: 'arcanum', valor: -impetus, testis: commitment`
 *
 *   2. A platform credit — captures the platform's revenue for this tick. Same
 *      shape as sessionSpendHook's emit, scaled to the tick's impetus.
 *
 * The host's hosting cost flows OUT of their balance into the platform's. Their
 * earnings (hostCut + hospitium signa from guest gens, both crediting them via
 * `nexus:hostCut` / `nexus:hospitium` auctor) net against this debit.
 */
export const studioSpendHook: SignumHook<'studio_spend'> = async (event) => {
  const { impetus, hostKey, materiaId } = event.payload
  if (impetus <= 0n) return []

  const hostDebit = 'animaId' in hostKey
    ? {
        animaId: hostKey.animaId,
        forma: 'integer' as const,
        valor: -impetus,
        auctor: 'nexus:studioSpend',
        testis: materiaId,
      }
    : {
        forma: 'arcanum' as const,
        valor: -impetus,
        auctor: 'nexus:studioSpend',
        testis: hostKey.commitment,
      }

  const platformCredit = {
    animaId: PLATFORM_ANIMA_ID,
    forma: 'reward' as const,
    valor: impetus,
    auctor: 'nexus:studioSpend',
  }

  return [hostDebit, platformCredit]
}
