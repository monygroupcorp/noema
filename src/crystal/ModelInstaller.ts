// =============================================================================
// ModelInstaller — apply models onto an already-running (warm) studio, live.
// =============================================================================
// The gen path installs models as a side-effect of running a workflow
// (comfyrunner's `_ensure_models` preflight). This is the NON-gen path: a host
// adds a model to a warm-idle studio via Mod • → Add, and we download it onto
// the running pod and merge it into `Materia.installedModels` — no inference.
//
// Orchestration only: resolve intella ids → download refs (via Intellarum),
// hand them to the pod's install client (real → comfyrunner `/install`; fake →
// simulated), then set-union the ids into `installedModels`. The client choice
// (real/fake) is injected so DEV_FAKE_POD works end-to-end with no GPU.
// =============================================================================

import type { Materia, MateriaStore } from '../types/materia.js'
import type { ModelRef } from '../types/actum.js'
import type { Intellarum } from '../types/intelligendi.js'
import type { InstallResult } from './comfyrunnerClient.js'
import { makeLogger } from '../lib/logger.js'

const log = makeLogger('cursor:installer')

/** Per-model progress while a live install runs (drives the bulletin's "installing…" tail). */
export interface InstallProgress {
  done: number
  total: number
  current?: string
}

/** The slice of a warm-pod client this needs — implemented by WarmPodClient + FakeWarmPodClient. */
export interface ModelInstallClient {
  installModels(models: ModelRef[], onProgress?: (p: InstallProgress) => void): Promise<InstallResult>
}

export class ModelInstaller {
  constructor(private readonly deps: {
    intellarum: Intellarum
    materiae: MateriaStore
    /** Resolve the install client for a given warm Materia (real vs fake injected upstream). */
    clientFor: (materia: Materia) => ModelInstallClient
  }) {}

  /**
   * Install the given intella ids onto the warm studio, then merge them into
   * `Materia.installedModels` (set-union, idempotent). Returns the download tally and the new
   * installed set. Unresolvable ids are skipped (logged), not fatal.
   */
  async install(
    materia: Materia,
    intellaIds: string[],
    onProgress?: (p: InstallProgress) => void,
  ): Promise<{ result: InstallResult; installedModels: string[] }> {
    const refs: ModelRef[] = []
    for (const id of intellaIds) {
      const i = await this.deps.intellarum.find(id).catch(() => null)
      if (!i) { log.warn('install: intella not found, skipping', { id }); continue }
      refs.push({
        role: i.genus === 'lora' ? 'lora' : 'model',
        id,
        ...(i.sources?.[0]?.uri ? { url: i.sources[0].uri } : {}),
        dest: i.dest,
        ...(typeof i.sizeGb === 'number' ? { sizeBytes: Math.round(i.sizeGb * 1e9) } : {}),
      })
    }

    const result = refs.length
      ? await this.deps.clientFor(materia).installModels(refs, onProgress)
      : { modelsDownloaded: 0, modelsReused: 0 }

    // Set-union the requested ids into installedModels (the resolved-and-downloaded set).
    const installedModels = [...new Set([...(materia.installedModels ?? []), ...refs.map(r => r.id)])]
    await this.deps.materiae.update(materia.id, { installedModels }).catch(err =>
      log.warn('install: failed to persist installedModels', { materiaId: materia.id, error: String(err) }))

    log.info('live model install complete', { materiaId: materia.id, requested: intellaIds.length, installed: refs.length })
    return { result, installedModels }
  }
}
