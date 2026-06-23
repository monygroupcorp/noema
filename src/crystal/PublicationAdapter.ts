// =============================================================================
// PublicationAdapter — the destination seam of the publishing spine
// =============================================================================
//
// One artifact (an Actum / Intella / Collectio) is put forth to a destination
// by a PublicationAdapter, registered by `key` (the Editio.destination). New
// destinations — feed, R2 bucket, HuggingFace, mint, marketplace — accrete as
// adapters on this identical interface WITHOUT touching the spine, exactly the
// way `Cursorum` registers execution cursors and the deterministic runtimes
// register their engines. See docs/spec/publishing.md §5b.
//
// The artifact stays canonical and singular — an adapter receives a *reference*
// plus the artifact's already-produced output (e.g. an Actum's exitus media),
// never ownership of the bytes.
// =============================================================================

import type { ArtifactRef, Editio, EditioVisibility, EditioCustody } from '../types/editio.js'

/** The policy under which an artifact is put forth (the Editio's policy layer). */
export interface PublishPolicy {
  visibility: EditioVisibility
  custody: EditioCustody
  /** Rights split snapshot (from a Sodalitas), if any. */
  owners?: Array<{ animaId: string; weight: number }>
  /** License tag — 'catalog' (our liability) | a BYO license id. */
  license?: string
  /**
   * BYO custody target — the user's own account/token at the destination, resolved
   * from `Anima.publicatio` when `custody:'theirs'`. Used by the model-registry
   * adapters (HuggingFace/Civitai) to publish under the user's account.
   */
  custodyTarget?: { account?: string; token?: string }
}

/** What an adapter is handed: the artifact reference + its produced output. */
export interface PublishArtifact {
  ref: ArtifactRef
  /** The artifact's produced output — e.g. an Actum's `exitus` (media urls). */
  output?: Record<string, unknown>
  /**
   * The publication record's id (the `Editio.id`). Lets an adapter mint a STABLE
   * per-publication handle/key (so `retract` can target the same bytes) rather than
   * a random one. Used by the bucket/mint adapters; the feed adapter ignores it.
   */
  editioId?: string
}

/**
 * PublicationAdapter — projects a canonical artifact onto a destination.
 *
 * `publish` returns the destination's handle (`externalRef`): a feed post id, an
 * HF repo id, a token id, an R2 url. `retract` is OPTIONAL — feed/bucket support
 * real unpublish; a MintAdapter does not (minted = permanent), so it omits it.
 */
export interface PublicationAdapter {
  readonly key: string
  publish(artifact: PublishArtifact, policy: PublishPolicy): Promise<{ externalRef: string }>
  retract?(editio: Editio): Promise<void>
}
