// =============================================================================
// BucketAdapter — host an artifact's bytes in our bucket (custody 'ours')
// =============================================================================
//
// Build-order #2 (docs/spec/publishing.md §4b/§6). Re-hosts an artifact's media
// into R2 under a key WE control — a stable, publish-owned URL distinct from the
// ephemeral pod-output URL. This is the substrate living NFTs later reuse: we
// serve the hosted bytes (and, for #6, overwrite them to mutate the projection).
//
// custody = 'ours'. Real unpublish: `retract` DELETES the hosted bytes (feed/
// bucket = revocable; spec §8/§9). The hosted object is keyed by the publication
// id (`editioId`) so retract recomputes the exact key from the Editio.
//
// SCOPE (#2): hosts publicly-readable bytes — right for `unlisted` (link-only)
// and public surfaces. TRUE private custody (owner-only bytes via signed URLs /
// a private bucket) is deferred (§9); a `private` publish here is unlisted-grade.
// =============================================================================

import { v4 as uuidv4 } from 'uuid'
import type { PublicationAdapter, PublishArtifact, PublishPolicy } from './PublicationAdapter.js'
import type { Editio } from '../types/editio.js'
import type { IntellaSource } from '../types/intelligendi.js'
import type { MediaFetcher } from './MediaFetcher.js'
import type { ObjectStore } from './R2Uploader.js'

/** Output keys that may carry a single media URL, in priority order. */
const SINGLE_MEDIA_KEYS = ['image', 'video', 'audio', 'url', 'file']
/** Output keys that may carry an array of media (strings or `{ url }` objects). */
const ARRAY_MEDIA_KEYS = ['images', 'videos', 'audios', 'files', 'media']

/** Pull the primary media URL out of an artifact's produced output (an exitus). */
export function primaryMediaUrl(output?: Record<string, unknown>): string | undefined {
  if (!output) return undefined
  for (const k of SINGLE_MEDIA_KEYS) {
    const v = output[k]
    if (typeof v === 'string' && v.length > 0) return v
  }
  for (const k of ARRAY_MEDIA_KEYS) {
    const v = output[k]
    if (!Array.isArray(v)) continue
    for (const item of v) {
      if (typeof item === 'string' && item.length > 0) return item
      if (item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string') {
        return (item as { url: string }).url
      }
    }
  }
  return undefined
}

/**
 * Pull EVERY media URL out of an artifact's produced output (deduped, order-preserving).
 * `primaryMediaUrl` picks the one the adapters re-host; the moderation gate must hash
 * ALL of them (an actum with multiple images, an intella's full `samples[]`) so nothing
 * crosses the trust boundary unscanned. Covers the single/array media keys plus `samples`
 * (the intella preview shape `_artifactOutput` emits).
 */
export function allMediaUrls(output?: Record<string, unknown>): string[] {
  if (!output) return []
  const urls: string[] = []
  const push = (v: unknown): void => { if (typeof v === 'string' && v.length > 0) urls.push(v) }
  for (const k of SINGLE_MEDIA_KEYS) push(output[k])
  for (const k of [...ARRAY_MEDIA_KEYS, 'samples']) {
    const v = output[k]
    if (!Array.isArray(v)) continue
    for (const item of v) {
      if (typeof item === 'string') push(item)
      else if (item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string') {
        push((item as { url: string }).url)
      }
    }
  }
  return [...new Set(urls)]
}

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
  json: 'application/json', glb: 'model/gltf-binary',
}

/** Infer `{ contentType, ext }` from a media URL's extension (query/fragment stripped). */
export function mediaTypeFor(url: string): { contentType: string; ext: string } {
  const segment = (url.split('?')[0].split('#')[0].split('/').pop() ?? '')
  const ext = segment.includes('.') ? (segment.split('.').pop() ?? '').toLowerCase() : ''
  return { contentType: CONTENT_TYPES[ext] ?? 'application/octet-stream', ext: ext || 'bin' }
}

/** The basename of a URL (query/fragment stripped), or a fallback. */
function urlBasename(url: string, fallback: string): string {
  const seg = url.split('?')[0].split('#')[0].split('/').pop() ?? ''
  return seg || fallback
}

export class BucketAdapter implements PublicationAdapter {
  readonly key = 'r2'
  private readonly prefix: string
  private readonly modelPrefix: string

  constructor(private readonly deps: { fetcher: MediaFetcher; store: ObjectStore; prefix?: string; modelPrefix?: string }) {
    this.prefix = deps.prefix ?? 'editiones'
    this.modelPrefix = deps.modelPrefix ?? 'models'
  }

  async publish(artifact: PublishArtifact, policy: PublishPolicy): Promise<{ externalRef: string }> {
    // A model (Intella) hosts its WEIGHTS (the durable, our-custody copy — the
    // training-finality path); everything else hosts its produced MEDIA.
    if (artifact.ref.kind === 'intella') return this._hostModel(artifact, policy)

    const url = primaryMediaUrl(artifact.output)
    if (!url) throw new Error('bucket-adapter: artifact has no resolvable media to host')
    const bytes = await this.deps.fetcher.fetch(url)
    const { contentType, ext } = mediaTypeFor(url)
    // Stable per-publication key — `retract` recomputes the same object key.
    const id = artifact.editioId ?? uuidv4()
    const hosted = await this.deps.store.put(`${this.prefix}/${id}.${ext}`, bytes, contentType)
    return { externalRef: hosted }
  }

  /** Host a trained model's primary weight file into OUR bucket → a durable,
   *  our-custody download URL (the `miladystation` mirror the resolver prefers).
   *  This is real byte movement — the our-custody half of model publishing.
   *
   *  STREAMS the weights when the fetcher + store both support it (model weights are
   *  large — a multi-GB checkpoint must never be buffered whole in memory); falls
   *  back to the buffered path otherwise (fine for LoRA-sized files + test fakes). */
  private async _hostModel(artifact: PublishArtifact, _policy: PublishPolicy): Promise<{ externalRef: string }> {
    const sources = (artifact.output?.sources as IntellaSource[] | undefined) ?? []
    const primary = sources.find((s) => typeof s?.uri === 'string' && s.uri.length > 0)
    if (!primary) throw new Error('bucket-adapter: model has no weight source to host')
    const slug = typeof artifact.output?.slug === 'string' ? artifact.output.slug : 'model'
    const filename = urlBasename(primary.uri, `${slug}.safetensors`)
    const id = artifact.editioId ?? uuidv4()
    // Keyed under a per-publication folder so `retract` can recompute + delete it.
    const key = `${this.modelPrefix}/${id}/${filename}`
    const { fetcher, store } = this.deps

    if (fetcher.fetchStream && store.putStream) {
      const { body, contentLength } = await fetcher.fetchStream(primary.uri)
      const hosted = await store.putStream(key, body, 'application/octet-stream', contentLength)
      return { externalRef: hosted }
    }
    const bytes = await fetcher.fetch(primary.uri)
    const hosted = await store.put(key, bytes, 'application/octet-stream')
    return { externalRef: hosted }
  }

  async retract(editio: Editio): Promise<void> {
    if (!editio.externalRef) return
    // Recover the object key from the hosted URL — media live under `<prefix>/…`,
    // model weights under `<modelPrefix>/…`; delete whichever this publication used.
    for (const prefix of [this.prefix, this.modelPrefix]) {
      const marker = `/${prefix}/`
      const at = editio.externalRef.indexOf(marker)
      if (at < 0) continue
      await this.deps.store.del(`${prefix}/${editio.externalRef.slice(at + marker.length)}`)
      return
    }
  }
}
