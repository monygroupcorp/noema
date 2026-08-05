// =============================================================================
// MintAdapter / MarketplaceAdapter — put a frozen drop on-chain / on a market
// =============================================================================
//
// Build-order #5 (docs/spec/publishing.md §6, collectio §4e). Publishing a
// Collectio (or a 1/1 Actum) to an on-chain / marketplace destination is the
// `freeze → export → mint` path: at publish the immutable canon — the generative
// `provenanceHash` + the snapshotted `owners[]` rights split + the drop size — is
// content-addressed into a single deterministic reference. That digest IS the
// freeze: the same canon always yields the same handle, on any machine.
//
// The Collectio stays canonical; the Editio only *references* it — these adapters
// add no second artifact type (spec §6 scope discipline). The freeze manifest is
// carried as `artifact.output` (CrystalApi._artifactOutput projects it).
//
// MINT is PERMANENT: the adapter omits `retract` (minted ≠ revocable), so the
// spine's `retractEdition` 403s a mint. A MARKETPLACE listing is revocable, so
// MarketplaceAdapter keeps `retract` (delist).
//
// PLACEHOLDER(publishing#5): NO real on-chain transaction (no Catena/CreditVault
// mint, no contract deploy, no per-token `tokenURI` assembly — that hosted/mutable
// layer is the living-NFT work, #6) and NO real marketplace API call. Both adapters
// do the deterministic PROJECTION (freeze digest → handle) and return it; they do
// not yet move anything on a chain or a venue. Ledger: docs/spec/publishing.md §10.
// The spine, freeze boundary, ownership snapshot, and moderation gate around them
// ARE real.
// =============================================================================

import type { PublicationAdapter, PublishArtifact, PublishPolicy } from './PublicationAdapter.js'
import { contentHash } from './provenance.js'

/**
 * The immutable canon an on-chain/marketplace adapter freezes — a Collectio's
 * generative `provenanceHash` plus its realized size. The ownership split is taken
 * from the publish policy (`policy.owners`, snapshotted on the Editio), so the
 * freeze digest binds *config + ownership + size* into one content address.
 */
export interface FreezeManifest {
  /** `sha256:…` content-address of the generative config (Collectio.provenanceHash). */
  provenanceHash: string
  /** Target/realized piece count of the drop. */
  numerus: number
  /** Human-facing drop name, when set. */
  nomen?: string
}

/** Strip a `sha256:` (or any `algo:`) prefix → the bare hex, for a compact handle. */
function bareHex(hash: string): string {
  const at = hash.indexOf(':')
  return at >= 0 ? hash.slice(at + 1) : hash
}

/** Read + validate the freeze manifest an adapter was handed. */
function freezeManifest(artifact: PublishArtifact, who: string): FreezeManifest {
  const m = artifact.output as FreezeManifest | undefined
  if (!m || typeof m.provenanceHash !== 'string') {
    throw new Error(`${who}: artifact has no frozen canon to publish (needs a Collectio provenance)`)
  }
  return m
}

/**
 * MintAdapter — freeze a drop's canon into an immutable, content-addressed mint
 * reference. Permanent: no `retract`.
 */
export class MintAdapter implements PublicationAdapter {
  readonly key = 'mint'
  private readonly chain: string

  constructor(opts: { chain?: string } = {}) {
    this.chain = opts.chain ?? 'evm'
  }

  async publish(artifact: PublishArtifact, policy: PublishPolicy): Promise<{ externalRef: string }> {
    const m = freezeManifest(artifact, 'mint-adapter')
    // The freeze: content-address config + ownership + size. `owners` is sorted so
    // the digest is order-independent (a rights split is a set, not a sequence).
    const owners = (policy.owners ?? [])
      .map((o) => ({ animaId: o.animaId, weight: o.weight }))
      .sort((a, b) => (a.animaId < b.animaId ? -1 : a.animaId > b.animaId ? 1 : 0))
    const canon = contentHash({ provenanceHash: m.provenanceHash, numerus: m.numerus, owners })
    // PLACEHOLDER(publishing#5): no on-chain tx — deterministic drop reference only.
    return { externalRef: `mint:${this.chain}:${bareHex(canon)}` }
  }
}

/**
 * MarketplaceAdapter — list a frozen drop on an external marketplace. Revocable:
 * `retract` delists. Parameterized by a venue base URL so "other marketplaces"
 * are config, not new classes (mirrors the model-registry adapters).
 */
export class MarketplaceAdapter implements PublicationAdapter {
  readonly key: string
  private readonly base: string

  constructor(opts: { key?: string; base: string }) {
    this.key = opts.key ?? 'marketplace'
    this.base = opts.base.replace(/\/+$/, '')
  }

  async publish(artifact: PublishArtifact, _policy: PublishPolicy): Promise<{ externalRef: string }> {
    freezeManifest(artifact, `${this.key}-adapter`)
    // The listing is keyed by the publication id (stable → `retract` can target it).
    const id = artifact.editioId ?? bareHex(contentHash({ ref: artifact.ref }))
    // PLACEHOLDER(publishing#5): no real marketplace API — projects the listing URL.
    return { externalRef: `${this.base}/listing/${id}` }
  }

  async retract(): Promise<void> {
    // PLACEHOLDER(publishing#5): real delist deferred. The spine flips the Editio
    // to 'retracted' (dropping it from the marketplace feed); nothing else to do.
  }
}
