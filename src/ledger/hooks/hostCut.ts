import type { SignumHook } from '../../types/nexus.js'

const HOST_CUT_RATE = 20n   // % of baseImpetus that flows to the host as profit

/**
 * hostCutHook — pays the host a profit cut on the base impetus of every guest gen.
 *
 * Distinct from `hospitiumHook` (Phase C), which pays the host the ambassador
 * bonus drawn from the warm surcharge. Taxing base only (not the full impetus)
 * means the warm surcharge isn't double-compensated — guests pay it once, the
 * host receives most of it via hospitium, the platform keeps the rest.
 *
 * Branches on the HostKey discriminant:
 *   - `{animaId}`    → identified host receives a `reward` signum
 *   - `{commitment}` → anonymous host receives an `arcanum` signum, no animaId
 */
export const hostCutHook: SignumHook<'execution_spend'> = async (event) => {
  const { baseImpetus, modoHostKey, actum } = event.payload
  if (!modoHostKey || baseImpetus === 0n) return []

  const valor = (baseImpetus * HOST_CUT_RATE) / 100n
  if (valor === 0n) return []

  // contextId carries the studio (Materia.id) so /status + bulletin can sum
  // per-studio earnings. Skipped when the run wasn't tied to a Materia.
  const ctx = actum.materiamId ? { contextId: actum.materiamId } : {}

  if ('animaId' in modoHostKey) {
    return [{
      animaId: modoHostKey.animaId,
      forma: 'reward' as const,
      valor,
      auctor: 'nexus:hostCut',
      ...ctx,
    }]
  }
  // Anonymous host — credit the commitment via the existing arcanum rail.
  return [{
    forma: 'arcanum' as const,
    valor,
    auctor: 'nexus:hostCut',
    testis: modoHostKey.commitment,
    ...ctx,
  }]
}
