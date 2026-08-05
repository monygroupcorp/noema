// =============================================================================
// collectioArchiveSource — resolve a Collectio's exportable pieces
// =============================================================================
//
// The concrete `ArchiveSource` the ArchiveAdapter reads: given a collection id,
// return its header (name, provenance, size) plus every exportable piece. A piece
// is exportable when its Actum COMPLETED and the reviewer did not REJECT it — the
// same rule that counts a piece toward the drop (see CrystalApi.getCollectionRarity
// / listCollectionPieces). Media + trait attributes are pulled off the Actum, so
// no extra state is stored: the export is a pure projection of what already exists.
//
// NOT owner-scoped — ownership is enforced upstream in CrystalApi.publish before
// the publication is ever created.
// =============================================================================

import type { ArchiveSource, ExportManifest, ExportAttribute } from './ArchiveAdapter.js'
import type { Collectionum } from '../types/collectio.js'
import type { Actorum } from '../types/cursus.js'

export function collectioArchiveSource(deps: { collectiones: Collectionum; actorum: Actorum }): ArchiveSource {
  return {
    async read(collectioId: string): Promise<ExportManifest | null> {
      const c = await deps.collectiones.find(collectioId)
      if (!c) return null
      const pieces: ExportManifest['pieces'] = []
      for (const actumId of c.acta) {
        const actum = await deps.actorum.findById(actumId)
        if (!actum || actum.status !== 'completus') continue
        if (actum.exitus?.reviewOutcome === 'rejected') continue
        const attrs = actum.aditus?._attributes
        pieces.push({
          ...(actum.exitus !== undefined ? { output: actum.exitus } : {}),
          ...(Array.isArray(attrs) ? { attributes: attrs as ExportAttribute[] } : {}),
        })
      }
      return {
        ...(c.nomen !== undefined ? { nomen: c.nomen } : {}),
        provenanceHash: c.provenanceHash,
        numerus: c.numerus,
        pieces,
      }
    },
  }
}
