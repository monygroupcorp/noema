// =============================================================================
// InstallCoordinator — serialize model installs per warm pod.
// =============================================================================
// Two paths install models onto a warm pod: the LIVE-APPLY path (a host adds a
// model via Mod • → Add, B3) and the GEN-ADMISSION path (a gen needs a model
// not yet on the pod, B4). Run concurrently they could download the same file
// twice — a corruption / wasted-bandwidth race. This coordinator funnels both
// through one promise-chain PER POD, so installs on a given pod serialize and a
// gen's admission naturally AWAITS any in-flight live install before it runs.
//
// Thin wrapper over ModelInstaller (which does the resolve + download + the
// installedModels set-union); this just owns the per-pod ordering.
// =============================================================================

import type { Materia } from '../types/materia.js'
import type { ModelInstaller } from './ModelInstaller.js'

export class InstallCoordinator {
  /** externusId (pod id) → tail of that pod's install chain. */
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(private readonly installer: ModelInstaller) {}

  /** Queue `op` onto the pod's serial chain — it starts only once the prior install settles. */
  private chain<T>(podId: string, op: () => Promise<T>): Promise<T> {
    const prev = this.chains.get(podId) ?? Promise.resolve()
    const next = prev.then(op, op)   // run regardless of whether the prior op resolved or threw
    // Keep the chain alive but swallow errors on the stored tail so one failure can't wedge the pod.
    this.chains.set(podId, next.then(() => {}, () => {}))
    return next
  }

  /** Live-apply (B3): install ids onto the warm pod, serialized per pod. */
  installLive(materia: Materia, intellaIds: string[]): Promise<{ installedModels: string[] }> {
    return this.chain(materia.externusId, async () => {
      const { installedModels } = await this.installer.install(materia, intellaIds)
      return { installedModels }
    })
  }

  /** Gen admission (B4): ensure the gen's models are on the pod before it runs. Awaits any
   *  in-flight live install (via the same chain), then installs whatever's still missing.
   *  Idempotent — re-installing a present model is a no-op download + a no-op union. */
  ensureForGen(materia: Materia, models: Array<{ id?: string }>): Promise<void> {
    return this.chain(materia.externusId, async () => {
      const installed = new Set(materia.installedModels ?? [])
      const missing = models.map(m => m.id).filter((id): id is string => !!id && !installed.has(id))
      if (missing.length) await this.installer.install(materia, missing)
    })
  }
}
