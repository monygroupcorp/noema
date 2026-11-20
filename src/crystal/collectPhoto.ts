// =============================================================================
// collectPhoto — file a Telegram-sourced photo into the caller's default dataset
// =============================================================================
//
// noema/telegram-photos-into-a-dataset clause 2: a collected photo must land in OUR
// storage, not stay the transient `api.telegram.org` CDN link `_resolveFileUrl` yields —
// `DatasetMediaItem.url` is documented as a DURABLE reference (`src/types/dataset.ts`), and
// a Telegram file link lapses and carries the bot token besides. Platform-neutral: the
// caller (Telegram today) supplies the already-resolved download URL; this never touches
// bot internals, and follows the exact fetch-then-put shape `rehostPreviews`
// (`src/crystal/ModelImporter.ts`) already established for the same kind of re-host.
// =============================================================================

import { v4 as uuidv4 } from 'uuid'
import type { AuctorKey } from '../flow/types.js'
import type { DatasetMediaItem } from '../types/dataset.js'
import { liveMedia } from '../types/dataset.js'
import type { MediaFetcher } from './MediaFetcher.js'
import type { ObjectStore } from './R2Uploader.js'
import { ensureDefaultDataset, type DefaultDatasetDeps } from './defaultDataset.js'

export interface CollectPhotoDeps extends DefaultDatasetDeps {
  fetcher: MediaFetcher
  store: ObjectStore
}

export interface CollectedPhoto {
  datasetId: string
  datasetName: string
  /** The dataset's live media count AFTER this photo landed. */
  count: number
}

// Telegram's `photo` envelope (unlike `document`) always names a server-transcoded JPEG —
// no filename, no mime type to sniff, so one fixed content type is correct, not a guess.
const PHOTO_CONTENT_TYPE = 'image/jpeg'
const PHOTO_EXT = '.jpg'

/** Download `fileUrl`'s bytes and append them to the caller's default dataset (minting one
 *  first if they have none yet), re-hosted under our own key rather than kept as the
 *  Telegram link. */
export async function collectPhoto(owner: AuctorKey, fileUrl: string, deps: CollectPhotoDeps): Promise<CollectedPhoto> {
  const dataset = await ensureDefaultDataset(owner, deps)
  const bytes = await deps.fetcher.fetch(fileUrl)
  const key = `telegram-collect/${dataset.owner}/${dataset.id}/${uuidv4()}${PHOTO_EXT}`
  const hostedUrl = await deps.store.put(key, bytes, PHOTO_CONTENT_TYPE)
  const item: DatasetMediaItem = {
    id: uuidv4(),
    url: hostedUrl,
    source: 'upload',
    addedAt: new Date(),
    addedBy: dataset.owner,
  }
  const updated = await deps.datasets.addMedia(dataset.id, [item])
  if (!updated) throw new Error(`dataset '${dataset.id}' vanished mid-collect`)
  return { datasetId: updated.id, datasetName: updated.name, count: liveMedia(updated.media).length }
}
