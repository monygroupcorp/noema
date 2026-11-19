// =============================================================================
// intellaSourceGuard — a publicly resolvable LoRA must name a file to download.
// =============================================================================
//
// A canonica or public LoRA is reachable by anyone's trigger word. If it is
// stored with an empty `sources[]`, every prompt that triggers it compiles to a
// MODEL_UNFETCHABLE refusal, and the record itself gives no sign of it. Legacy
// records were migrated in exactly this state.
//
// The same holds for a `sources[]` that is non-empty but names no file: a bare
// host or a Civitai model page. So the write seams of the registry
// (`MongoIntella.upsert`, `setAccess` → public, `removeSource`) refuse to
// produce either state, loudly. A private LoRA is left alone: it is the
// owner's own record and resolves for no one else.
//
// Pure: no Mongo. The store calls these; the tests drive them directly.

/** The fields the guard reads. Accepts both the v1 (`access: 'public'`) and the
 *  v2 (`access: { kind: 'public' }`) shapes, since raw documents of both exist. */
export interface GuardedIntella {
  id?: string
  genus?: string
  canonica?: boolean
  access?: unknown
  sources?: unknown
}

/** Thrown when a write would leave a public LoRA with nothing to download. */
export class EmptyLoraSourcesError extends Error {
  constructor(readonly intellaId: string, action: string) {
    super(
      `refusing to ${action} LoRA '${intellaId}': it is canonica/public, so anyone's trigger word ` +
      `resolves it, but none of its sources is a download URL — every run that triggers it would fail`,
    )
    this.name = 'EmptyLoraSourcesError'
  }
}

/** True when the access field, in either shape, says public. */
export function isPublicAccess(access: unknown): boolean {
  if (access === 'public') return true
  return typeof access === 'object' && access !== null && (access as { kind?: unknown }).kind === 'public'
}

/** True when this record must carry at least one download source: a LoRA that
 *  resolves for everyone (platform-canonical, or published public). */
export function requiresSources(i: GuardedIntella): boolean {
  return i.genus === 'lora' && (i.canonica === true || isPublicAccess(i.access))
}

/**
 * True when `uri` has the shape of a file download, not merely of a string. Legacy records
 * carry a bare host (`miladystation2.net`) or a Civitai MODEL PAGE where the download URL
 * belongs; both are non-empty, and both hand the pod an HTML page or nothing. Shape only —
 * whether the file is really there takes a fetch, which a write seam does not make.
 */
export function isDownloadUri(uri: unknown): boolean {
  if (typeof uri !== 'string') return false
  let url: URL
  try { url = new URL(uri.trim()) } catch { return false }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const host = url.hostname.replace(/^www\./, '')
  if (host === 'civitai.com') return url.pathname.startsWith('/api/download/models/')
  if (host === 'huggingface.co') return url.pathname.includes('/resolve/')
  return url.pathname.length > 1
}

/** True when `sources` holds at least one entry whose `uri` is download-shaped. */
export function hasDownloadSource(sources: unknown): boolean {
  if (!Array.isArray(sources)) return false
  return sources.some(s => isDownloadUri((s as { uri?: unknown })?.uri))
}

/** Throw `EmptyLoraSourcesError` when `i` is a public LoRA with no download source. */
export function assertLoraSources(i: GuardedIntella, action = 'write'): void {
  if (requiresSources(i) && !hasDownloadSource(i.sources)) {
    throw new EmptyLoraSourcesError(String(i.id ?? '(no id)'), action)
  }
}
