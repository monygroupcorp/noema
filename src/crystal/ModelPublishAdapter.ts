// =============================================================================
// ModelPublishAdapter — publish an Intella (model/LoRA) to a model registry
// =============================================================================
//
// Build-order #3 (docs/spec/publishing.md §4b/§5e/§6). Generalizes the legacy
// "everything we train → HuggingFace" hardcode into the publishing spine: a model
// is published to a REGISTRY (HuggingFace, Civitai, … — "there could be others")
// chosen by the caller's custody preference. One adapter class, parameterized by
// a `ModelRegistry` descriptor, so adding a registry is config, not a new class.
//
// custody: 'ours'  → our org/account hosts it (registry.defaultAccount).
// custody: 'theirs'→ the user's BYO account (policy.custodyTarget, from prefs).
//
// PLACEHOLDER(publishing#3): the REAL weight upload (push the Intella's `sources`
// files to the registry via its API + token) is NOT built — the legacy HF
// uploader is JS outside the crystal layer and needs HF_TOKEN; Civitai upload
// does not exist anywhere yet. This adapter does the registry-specific PROJECTION
// (account + slug → the canonical model URL) and returns that handle; it does not
// yet move bytes. Ledger: docs/spec/publishing.md §10. The spine, custody routing,
// ownership, and the access reconciler around it ARE real.
// =============================================================================

import type { PublicationAdapter, PublishArtifact, PublishPolicy } from './PublicationAdapter.js'
import type { IntellaSource, IntellaGenus } from '../types/intelligendi.js'

/** The projection of an Intella an adapter needs to publish it (carried as `artifact.output`). */
export interface ModelView {
  nomen: string
  genus: IntellaGenus
  slug?: string
  trigger?: string
  familia?: string
  auctor?: string
  /** The weight download sources a real uploader would push to the registry. */
  sources: IntellaSource[]
}

/** A registry descriptor — how one model host names a published model. */
export interface ModelRegistry {
  /** Adapter key + Editio.destination — 'huggingface' | 'civitai' | … */
  key: string
  /** Our org/account, used when custody is 'ours'. Absent → custody must be 'theirs'. */
  defaultAccount?: string
  /** Build the canonical model URL (the externalRef handle) for an account + slug. */
  handleFor(account: string, slug: string, model: ModelView): string
}

/** Lowercase, hyphenate — a registry-safe repo/model slug. */
export function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'model'
}

export class ModelPublishAdapter implements PublicationAdapter {
  readonly key: string
  constructor(private readonly registry: ModelRegistry) {
    this.key = registry.key
  }

  async publish(artifact: PublishArtifact, policy: PublishPolicy): Promise<{ externalRef: string }> {
    const model = artifact.output as ModelView | undefined
    if (!model || typeof model.nomen !== 'string') {
      throw new Error(`${this.key}-adapter: no model to publish`)
    }
    // custody 'theirs' → the BYO account; otherwise our org.
    const account = policy.custodyTarget?.account ?? this.registry.defaultAccount
    if (!account) {
      throw new Error(`${this.key}-adapter: no target account — set custody:'theirs' + a ${this.key} account in prefs, or configure an org`)
    }
    const slug = slugify(model.slug ?? model.nomen)
    // PLACEHOLDER(publishing#3): real weight upload deferred — projection only.
    return { externalRef: this.registry.handleFor(account, slug, model) }
  }

  async retract(): Promise<void> {
    // PLACEHOLDER(publishing#3): real registry repo deletion deferred. The spine
    // still flips the Editio to 'retracted' + the reconciler revokes resolvability.
  }
}

/** HuggingFace registry (`https://huggingface.co/<account>/<slug>`). */
export function huggingFaceRegistry(defaultAccount?: string): ModelRegistry {
  return {
    key: 'huggingface',
    ...(defaultAccount !== undefined ? { defaultAccount } : {}),
    handleFor: (account, slug) => `https://huggingface.co/${account}/${slug}`,
  }
}

/** Civitai registry (`https://civitai.com/user/<account>/models?slug=<slug>`). */
export function civitaiRegistry(defaultAccount?: string): ModelRegistry {
  return {
    key: 'civitai',
    ...(defaultAccount !== undefined ? { defaultAccount } : {}),
    handleFor: (account, slug) => `https://civitai.com/user/${account}?model=${slug}`,
  }
}
