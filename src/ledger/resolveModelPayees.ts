// =============================================================================
// resolveModelPayees — who earns the model-royalty pool for a completed actum
// =============================================================================
//
// The keystone that makes the #4 rights layer actually PAY. The `modelRoyaltyHook`
// splits a 5% pool across `execution_spend.intellaRoyaltyPayees`, but nothing
// populated that field — so the whole rights/owners stack was inert. This resolves
// it at completion time (spec §9 "execution-time royalty-payee population", roadmap
// Tier 1 #1).
//
// PUBLISHING IS THE ROYALTY SURFACE (spec §5e). A model earns only once it has a
// published `Editio` — the Editio's `owners[]` IS the canonical "who earns when this
// model is used", and absent an explicit split the publishing identity (`Editio.by`)
// earns. We deliberately do NOT fall back to `Intella.auctor`: it may be a provider
// NAME, not an animaId (scraped/community imports), and paying it would mint bogus
// signa. Scraped-model attribution (via `corpusId`) is a separate, later path.
//
// Which models? The ones the gen ACTUALLY used — the resolved `spec.models` in the
// deployment bundle (content-addressed by `actum.deploymentHash`, incl. prompt-time
// LoRAs) plus any host-pinned models. The bundle already persists this, so no actum
// schema change is needed.
// =============================================================================

import type { Actum } from '../types/actum.js'
import type { DeploymentumStore } from '../types/deploymentum.js'
import type { Editionum } from '../types/editio.js'

export type RoyaltyPayee = { animaId: string; weight: number }

export interface ModelPayeeDeps {
  /** Content-addressed compiled bundles — carries the resolved `spec.models`. */
  deployments?: Pick<DeploymentumStore, 'find'>
  /** Publication records — the model's published `Editio` is its royalty surface. */
  editiones?: Pick<Editionum, 'listByArtifact'>
}

/** Distinct Intella ids the actum used: resolved `spec.models` (incl. prompt LoRAs)
 *  from its deployment bundle + any host-pinned models. */
async function modelsUsed(actum: Actum, deployments?: Pick<DeploymentumStore, 'find'>): Promise<string[]> {
  const ids = new Set<string>()
  if (actum.deploymentHash && deployments) {
    const bundle = await deployments.find(actum.deploymentHash)
    const models = (bundle?.spec as { models?: unknown })?.models
    if (Array.isArray(models)) {
      for (const m of models) {
        const id = (m as { id?: unknown })?.id
        if (typeof id === 'string' && id) ids.add(id)
      }
    }
  }
  for (const m of actum.pinnedModels ?? []) {
    if (m?.id) ids.add(m.id)
  }
  return [...ids]
}

/** The royalty payees for ONE model: its published Editio's `owners[]` split, else
 *  the publishing identity (100%), else none (unpublished / canonical → no payee).
 *  Per-model weights sum to ~1, so models are weighted equally by the aggregator. */
async function payeesForModel(id: string, editiones?: Pick<Editionum, 'listByArtifact'>): Promise<RoyaltyPayee[]> {
  if (!editiones) return []
  const records = await editiones.listByArtifact({ kind: 'intella', id })
  const published = records
    .filter((e) => e.status === 'published')
    .sort((a, b) => b.mutatum.getTime() - a.mutatum.getTime())[0]
  if (!published) return []
  if (published.owners?.length) {
    return published.owners.filter((o) => o.weight > 0).map((o) => ({ animaId: o.animaId, weight: o.weight }))
  }
  // No explicit split → the identified publisher earns the model's full share.
  return 'animaId' in published.by ? [{ animaId: published.by.animaId, weight: 1 }] : []
}

/**
 * Resolve the weighted model-royalty payees for a completed actum — the input the
 * `modelRoyaltyHook` splits the 5% pool across. Each used model contributes payees
 * whose weights sum to ~1, so models are weighted EQUALLY and each model's internal
 * `owners[]` split is respected; the same animaId across models is summed. The hook
 * normalizes by Σweight, so absolute scale is irrelevant; empty → the hook no-ops.
 */
export async function resolveModelRoyaltyPayees(actum: Actum, deps: ModelPayeeDeps): Promise<RoyaltyPayee[]> {
  const ids = await modelsUsed(actum, deps.deployments)
  if (!ids.length) return []
  const acc = new Map<string, number>()
  for (const id of ids) {
    for (const p of await payeesForModel(id, deps.editiones)) {
      if (p.weight > 0) acc.set(p.animaId, (acc.get(p.animaId) ?? 0) + p.weight)
    }
  }
  return [...acc].map(([animaId, weight]) => ({ animaId, weight }))
}
