// =============================================================================
// loraSourceBackfill — pure decision rules for recovering a download source
// for a public LoRA that was stored with an empty `sources[]`.
// =============================================================================
//
// The legacy LoRA migration carried names, triggers, `dest` filenames and usage
// counts across, but not download URLs: it left `sources[]` empty, or holding a
// bare host or a Civitai model PAGE. The weights still exist in places worth
// asking:
//
//   1. our own weights mirror (models.miladystation2.net), under the record's
//      own `dest` filename — the platform trained and uploaded most of these;
//   2. the Civitai model the record's own source already links to;
//   3. Civitai search, for the ones that were imported from there.
//
// A wrong LoRA served under someone's trigger word is worse than none, so a
// Civitai version is accepted only on strong evidence (see `matchCivitaiVersion`)
// and never on a name that merely looks close. Every candidate URL is also
// probed by the migration before anything is written; these rules only decide
// which URLs are worth probing.
//
// Used by `scripts/migrations/2026_11_backfill_lora_sources.ts`.

import type { IntellaSource } from '../types/intelligendi.js'
import { hasDownloadSource } from './intellaSourceGuard.js'

/** Public base of our weights mirror — the `miladystation` provenance. */
export const MIRROR_BASE = 'https://models.miladystation2.net'

/** Tag the backfill puts on a record it could not recover, so an operator can find them all. */
export const UNRECOVERABLE_TAG = 'sources-unrecoverable'

/** Which Civitai `baseModel` strings load under each of our families. Pony/Illustrious are
 *  SDXL-derived but are trained against different weights, so they are not accepted for `sdxl`. */
const CIVITAI_BASES: Record<string, readonly string[]> = {
  flux: ['Flux.1 D', 'Flux.1 S'],
  sdxl: ['SDXL 1.0'],
  sd15: ['SD 1.5'],
}

/** Fewest triggers that, all matching, identify a Civitai version without a file-name match. */
export const MIN_TRIGGERS = 2

/** The fields of a Civitai model version the matcher reads (API `/api/v1/models`). */
export interface CivitaiVersion {
  modelId: number
  versionId: number
  baseModel?: string
  trainedWords?: string[]
  files: string[]
}

export interface CivitaiMatch {
  modelId: number
  versionId: number
  evidence: string
}

/** The file name a `dest` path ends in (`models/loras/x.safetensors` → `x.safetensors`). */
export function destFile(dest: string): string {
  return dest.split('/').pop() ?? ''
}

/** Where our mirror would serve a LoRA stored under `dest`. */
export function mirrorLoraUri(dest: string): string {
  return `${MIRROR_BASE}/loras/${encodeURIComponent(destFile(dest))}`
}

/** Civitai's anonymous download endpoint for a model version. */
export function civitaiDownloadUri(versionId: number): string {
  return `https://civitai.com/api/download/models/${versionId}`
}

/** True when a Civitai `baseModel` loads under our `familia`. */
export function baseCompatible(familia: string | undefined, baseModel: string | undefined): boolean {
  if (!familia || !baseModel) return false
  return (CIVITAI_BASES[familia] ?? []).includes(baseModel)
}

/** Fold a trigger for comparison: `starter_pack_with_toy_figure` ≡ `Starter pack with toy figure`. */
export function foldTrigger(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Pick the Civitai version that IS this LoRA, or `null`.
 *
 * Only base-compatible versions are considered, and the first rule that yields
 * exactly one version wins:
 *   1. a file whose name equals the record's `dest` filename (case-insensitive);
 *   2. every one of the record's triggers is among the version's trained words,
 *      and there are at least two of them — one generic trigger ('hat')
 *      names a concept many unrelated LoRAs share, so it proves nothing.
 *
 * Two or more versions satisfying the same rule is ambiguous and yields `null`.
 */
export function matchCivitaiVersion(
  record: { dest: string; familia?: string; triggers: string[] },
  versions: readonly CivitaiVersion[],
): CivitaiMatch | null {
  const usable = dedupe(versions.filter(v => baseCompatible(record.familia, v.baseModel)))
  const file = destFile(record.dest).toLowerCase()

  const byFile = usable.filter(v => v.files.some(f => f.toLowerCase() === file))
  if (byFile.length === 1) {
    const v = byFile[0]
    return { modelId: v.modelId, versionId: v.versionId, evidence: `file name ${destFile(record.dest)} on ${v.baseModel}` }
  }
  if (byFile.length > 1) return null

  const triggers = record.triggers.map(foldTrigger).filter(Boolean)
  if (triggers.length < MIN_TRIGGERS) return null
  const byTrigger = usable.filter(v => {
    const words = new Set((v.trainedWords ?? []).map(foldTrigger))
    return triggers.every(t => words.has(t))
  })
  if (byTrigger.length === 1) {
    const v = byTrigger[0]
    return { modelId: v.modelId, versionId: v.versionId, evidence: `all triggers (${record.triggers.join(', ')}) on ${v.baseModel}` }
  }
  return null
}

/** True when a record needs a source recovered: none of its sources is download-shaped. */
export function needsBackfill(sources: unknown): boolean {
  return !hasDownloadSource(sources)
}

/** A Civitai model reference recovered from a stored (page) URL. */
export interface CivitaiLink { modelId: number; versionId?: number }

/** Parse `civitai.com/models/{id}[/slug][?modelVersionId={v}]`, or `null` for anything else. */
export function parseCivitaiLink(uri: unknown): CivitaiLink | null {
  if (typeof uri !== 'string') return null
  let url: URL
  try { url = new URL(uri.trim()) } catch { return null }
  if (url.hostname.replace(/^www\./, '') !== 'civitai.com') return null
  const m = /^\/models\/(\d+)(?:\/|$)/.exec(url.pathname)
  if (!m) return null
  const v = Number(url.searchParams.get('modelVersionId'))
  return { modelId: Number(m[1]), ...(Number.isInteger(v) && v > 0 ? { versionId: v } : {}) }
}

/**
 * Pick the version of a Civitai model the record ALREADY links to. The link is the
 * provenance, so the bar is lower than for a search hit — but still never a guess:
 *   1. the version the link names (`modelVersionId`), if it is base-compatible;
 *   2. a version with the record's `dest` filename, on a compatible base;
 *   3. the only base-compatible version the model has.
 */
export function pickLinkedVersion(
  link: CivitaiLink,
  record: { dest: string; familia?: string },
  versions: readonly CivitaiVersion[],
): CivitaiMatch | null {
  const usable = dedupe(versions.filter(v => v.modelId === link.modelId && baseCompatible(record.familia, v.baseModel)))
  if (link.versionId !== undefined) {
    const named = usable.find(v => v.versionId === link.versionId)
    return named ? { modelId: named.modelId, versionId: named.versionId, evidence: `the record's own link names version ${named.versionId} (${named.baseModel})` } : null
  }
  const file = destFile(record.dest).toLowerCase()
  const byFile = usable.filter(v => v.files.some(f => f.toLowerCase() === file))
  if (byFile.length === 1) return { modelId: byFile[0].modelId, versionId: byFile[0].versionId, evidence: `linked model, file name ${destFile(record.dest)}` }
  if (byFile.length === 0 && usable.length === 1) return { modelId: usable[0].modelId, versionId: usable[0].versionId, evidence: `linked model's only ${usable[0].baseModel} version` }
  return null
}

/** The source entry written for a recovered mirror file. */
export function mirrorSource(dest: string): IntellaSource {
  return { provenance: 'miladystation', uri: mirrorLoraUri(dest), format: 'safetensors' }
}

/** The source entry written for a recovered Civitai version. Same shape as the seeds use. */
export function civitaiSource(m: CivitaiMatch): IntellaSource {
  return {
    provenance: 'civitai',
    uri: civitaiDownloadUri(m.versionId),
    format: 'safetensors',
    meta: { modelId: String(m.modelId), modelVersionId: String(m.versionId) },
  }
}

/**
 * Read a safetensors header length from its first 8 bytes (little-endian u64).
 * Returns `null` for anything that cannot be a safetensors header — which is how
 * a 200 that served an HTML error page instead of weights is caught.
 */
export function safetensorsHeaderLength(first8: Uint8Array): number | null {
  if (first8.length < 8) return null
  let n = 0
  for (let i = 7; i >= 0; i--) n = n * 256 + first8[i]
  // A header is a JSON object of tensor descriptors: never empty, and a LoRA's is well under
  // 16 MB — so a garbage length can never make the header read pull more than that.
  return n >= 2 && n < 16_000_000 ? n : null
}

function dedupe(versions: CivitaiVersion[]): CivitaiVersion[] {
  const seen = new Set<number>()
  return versions.filter(v => (seen.has(v.versionId) ? false : (seen.add(v.versionId), true)))
}
