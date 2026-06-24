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
// The actual byte-push is a per-platform STRATEGY (`RegistryUploader`), injected
// per registry — so HuggingFace, Civitai, and any future host are PEER strategies,
// NONE privileged in the adapter or the spine. Adding a platform = a new descriptor
// + a new uploader, never a change here. When a registry has no uploader the adapter
// PROJECTS the handle only (account + slug → canonical URL) and moves no bytes.
//
// PLACEHOLDER(publishing#3): no concrete `RegistryUploader` ships yet — the seam is
// ready, the per-platform transport is the remaining work. HF needs **LFS** (the
// legacy `HuggingFaceHubService.js` base64-inlines a whole file into one commit —
// fine for a model card, unusable for multi-GB weights); Civitai has **no public
// upload API** today. Until an uploader is wired, the registries are projection-only
// and return a not-yet-real repo URL. Ledger: docs/spec/publishing.md §10. The spine,
// custody routing, ownership, the access reconciler, and this seam ARE real.
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
  // --- model-card enrichment (all optional; the card degrades gracefully without them) ---
  /** Human description for the card body. */
  description?: string
  /** Training steps — surfaced in the card frontmatter + training details. */
  trainingSteps?: number
  /** Where this was retrained from, for a provenance backlink in the card. */
  provenance?: { repo: string; base?: string }
  /** Preview samples to embed in the card gallery — `url` is fetched + committed at `pathInRepo`. */
  samples?: Array<{ url: string; pathInRepo: string; prompt?: string }>
}

/** A request to push a model's weights to a registry — platform-agnostic. */
export interface RegistryUploadRequest {
  /** The account/org to publish under (our org, or the caller's BYO account). */
  account: string
  /** The registry-safe model slug (the repo/model name). */
  slug: string
  /** Whether the published repo/model should be private (visibility 'private'). */
  private: boolean
  /** The model projection — `nomen`, `genus`, weight `sources`, trigger, … */
  model: ModelView
  /** BYO access token (custody:'theirs'); a self-contained uploader may also hold its own. */
  token?: string
}

/**
 * RegistryUploader — moves a model's weight bytes to ONE model-hosting platform.
 * The platform-specific upload STRATEGY, injected per `ModelRegistry`, so the adapter
 * and spine stay platform-agnostic: HuggingFace, Civitai, and any future host are
 * PEER implementations of this one interface. Returns the canonical handle the
 * platform assigns. Absent on a registry → the adapter projects the handle only.
 */
export interface RegistryUploader {
  upload(req: RegistryUploadRequest): Promise<{ externalRef: string }>
}

/** A registry descriptor — how one model host names (and, with an uploader, hosts) a model. */
export interface ModelRegistry {
  /** Adapter key + Editio.destination — 'huggingface' | 'civitai' | … */
  key: string
  /** Our org/account, used when custody is 'ours'. Absent → custody must be 'theirs'. */
  defaultAccount?: string
  /** Build the canonical model URL (the externalRef handle) for an account + slug. */
  handleFor(account: string, slug: string, model: ModelView): string
  /** Real byte-upload strategy. Present → the adapter uploads; absent → projection only. */
  uploader?: RegistryUploader
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

    // Real byte movement, when this registry has an upload strategy — the adapter
    // stays platform-agnostic and just hands off (HF/Civitai/… are peer strategies).
    if (this.registry.uploader) {
      const token = policy.custodyTarget?.token
      return this.registry.uploader.upload({
        account, slug, model,
        private: policy.visibility === 'private',
        ...(token ? { token } : {}),
      })
    }
    // PLACEHOLDER(publishing#3): no uploader wired → project the handle, move no bytes.
    return { externalRef: this.registry.handleFor(account, slug, model) }
  }

  async retract(): Promise<void> {
    // PLACEHOLDER(publishing#3): real registry repo deletion deferred. The spine
    // still flips the Editio to 'retracted' + the reconciler revokes resolvability.
  }
}

/** HuggingFace registry (`https://huggingface.co/<account>/<slug>`). Pass an
 *  `uploader` to move real bytes; omit it for projection-only (placeholder). */
export function huggingFaceRegistry(defaultAccount?: string, uploader?: RegistryUploader): ModelRegistry {
  return {
    key: 'huggingface',
    ...(defaultAccount !== undefined ? { defaultAccount } : {}),
    ...(uploader ? { uploader } : {}),
    handleFor: (account, slug) => `https://huggingface.co/${account}/${slug}`,
  }
}

/** Civitai registry (`https://civitai.com/user/<account>?model=<slug>`). PROJECTION-ONLY
 *  by necessity: Civitai exposes no public write/POST API (uploads are GUI-locked), so a
 *  real `uploader` is NOT buildable — this can only LINK a user's existing Civitai model,
 *  never push one. The `uploader` param exists for interface symmetry; leave it unset. */
export function civitaiRegistry(defaultAccount?: string, uploader?: RegistryUploader): ModelRegistry {
  return {
    key: 'civitai',
    ...(defaultAccount !== undefined ? { defaultAccount } : {}),
    ...(uploader ? { uploader } : {}),
    handleFor: (account, slug) => `https://civitai.com/user/${account}?model=${slug}`,
  }
}
