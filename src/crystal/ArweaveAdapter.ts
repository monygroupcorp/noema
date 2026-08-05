// =============================================================================
// ArweaveAdapter — graduate a Collectio to PERMANENT Arweave storage
// =============================================================================
//
// The durable counterpart to the GalleryAdapter's temporary R2 bridge: publishing a
// collection to destination `arweave` pushes its approved pieces to Arweave (via the
// Irys bundler) and returns a permanent base URI. PERMANENT → no `retract` (like a
// mint). PUBLIC → the moderation gate applies. PAID → the ArweaveUploader meters the
// byte cost against the publishing identity's credits (`artifact.by`).
//
// The upload orchestration + go-live caveats live in ArweaveUploader; this adapter is
// the thin spine seam that resolves the collection's pieces and hands them off.
// =============================================================================

import type { PublicationAdapter, PublishArtifact, PublishPolicy } from './PublicationAdapter.js'
import type { ArchiveSource } from './ArchiveAdapter.js'
import type { ArweaveUploader } from './ArweaveUploader.js'

export class ArweaveAdapter implements PublicationAdapter {
  readonly key = 'arweave'

  constructor(private readonly deps: { uploader: ArweaveUploader; source: ArchiveSource }) {}

  async publish(artifact: PublishArtifact, _policy: PublishPolicy): Promise<{ externalRef: string }> {
    if (artifact.ref.kind !== 'collectio') {
      throw new Error('arweave-adapter: only a collection can be graduated to Arweave')
    }
    if (!artifact.by) throw new Error('arweave-adapter: a publishing identity is required to meter the cost')
    const manifest = await this.deps.source.read(artifact.ref.id)
    if (!manifest) throw new Error(`arweave-adapter: collection ${artifact.ref.id} not found`)
    if (manifest.pieces.length === 0) throw new Error('arweave-adapter: collection has no approved pieces to graduate')

    const { baseUri } = await this.deps.uploader.graduate({
      pieces: manifest.pieces,
      ...(manifest.nomen !== undefined ? { nomen: manifest.nomen } : {}),
      by: artifact.by,
    })
    return { externalRef: baseUri }
  }
  // No `retract` — Arweave is permanent (the point of graduation).
}
