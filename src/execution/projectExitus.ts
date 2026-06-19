import type { Modus } from '../types/modus.js'

// =============================================================================
// projectExitus — project a run's outputs into the Modus's DECLARED exitus schema
// =============================================================================
//
// A pod hands back raw output items (URLs in R2). `actum.exitus` must carry those
// under the keys the flow's `exitus` schema declares — the typed Porta names
// (`image`/`video`/`audio`/`mesh`/…), NOT a hardcoded `imageUrl`. This is what
// makes a compositus wire port-to-port: an upstream step's `image`-typed exitus
// feeds a downstream step's `image`-typed aditus, same name, same type. It also
// makes input and output symmetric — an `image` Porta holds a URL on both sides.
//
// Single source of truth for the projection, used by every completion site
// (the execution webhook + sync cursors), so the contract can't drift again.
// =============================================================================

/** Porta types whose value is a delivered media URL. */
const MEDIA_TYPES = new Set(['image', 'video', 'audio', '3d'])

const VIDEO_EXT = /^(mp4|webm|mov|m4v|mkv)$/
const AUDIO_EXT = /^(mp3|wav|ogg|flac|m4a|aac)$/
const MODEL3D_EXT = /^(glb|gltf|obj|ply|stl|fbx)$/

/** Best-guess media type of an output URL, by extension. Defaults to 'image'. */
export function urlMediaType(url: string): 'image' | 'video' | 'audio' | '3d' {
  const ext = url.split('?')[0].split('.').pop()?.toLowerCase() ?? ''
  if (VIDEO_EXT.test(ext)) return 'video'
  if (AUDIO_EXT.test(ext)) return 'audio'
  if (MODEL3D_EXT.test(ext)) return '3d'
  return 'image'
}

/**
 * The exitus key to land the primary media URL under, from the Modus's schema:
 *   - exactly ONE media-typed exitus Porta → its key (the flow declares one output;
 *     most reliable, no extension guessing);
 *   - several → the one whose type matches the URL's extension-guessed type;
 *   - none / no schema → undefined (caller falls back to the bare type name).
 */
function primaryMediaKey(
  exitus: Modus['exitus'] | undefined,
  urlType: string,
): string | undefined {
  if (!exitus) return undefined
  const media = Object.entries(exitus).filter(([, p]) => MEDIA_TYPES.has(p.type))
  if (media.length === 1) return media[0][0]
  return media.find(([, p]) => p.type === urlType)?.[0]
}

type OutputItem = { url?: string } | string

/**
 * Project raw pod outputs into `actum.exitus`, keyed by the Modus's declared
 * exitus schema. Extra media URLs beyond the first land under `<key>2`, `<key>3`…
 * (preserving the legacy multi-image behavior). When there are no URLs, the raw
 * items pass through under `outputs` (e.g. inline/text-only runs handled elsewhere).
 */
export function projectExitus(
  modus: Pick<Modus, 'exitus'> | null | undefined,
  outputItems: OutputItem[],
): Record<string, unknown> {
  const urls = outputItems
    .map(o => (typeof o === 'object' && o !== null && 'url' in o ? o.url : undefined))
    .filter((u): u is string => !!u)

  if (urls.length === 0) return { outputs: outputItems }

  const type = urlMediaType(urls[0])
  const key = primaryMediaKey(modus?.exitus, type) ?? type
  const out: Record<string, unknown> = { [key]: urls[0] }
  urls.slice(1).forEach((u, i) => { out[`${key}${i + 2}`] = u })
  return out
}
