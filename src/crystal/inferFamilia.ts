// =============================================================================
// inferFamilia — the tag/name heuristic that backfills the first-class `familia`.
// =============================================================================
//
// `Intella.familia` is the LoRA-compatibility key (exact string equality; a base
// weight and its compatible LoRAs share it). The IMPORTED catalog predates the
// field: it encodes family loosely in `tags` (and, failing that, the name/dest).
//
// This module is the SINGLE SOURCE of that inference. It is used to POPULATE
// `familia` — once at the write seam (`MongoIntella.upsert` self-heals a record
// that arrives without one) and in bulk by the backfill migration
// (`scripts/migrations/2026_06_backfill_intella_familia.ts`). Read sites
// (`triggerMap`, the Compiler) then key on `familia` directly, never re-deriving.
//
// `familiaOf` is the read-time accessor: prefer the first-class field, fall back
// to inference only for a record not yet backfilled (belt-and-suspenders).

import type { Intella } from '../types/intelligendi.js'

/** Recognized base-model families, lowercased. Image-gen families first, then LLM
 *  families (which route to the llama.cpp runtime). A model's family is encoded in
 *  its TAGS (and, for base models, its name) across the imported catalog. */
export const FAMILY_TAGS = [
  'flux', 'sdxl', 'sd3', 'sd15', 'pony', 'illustrious', 'kontext', 'hunyuan',
  'wan', 'ltx', 'noobai', 'smollm', 'qwen', 'llama', 'mistral', 'gemma', 'phi',
] as const

/** The shape inference reads — a loose subset of Intella so callers (incl. the
 *  raw-document migration) need not produce a fully-typed Intella. */
type FamiliaSource = {
  nomen?: string
  dest?: string
  architectura?: string
  familia?: string
  tags?: Array<string | { tag?: string }>
}

/** Lowercased tag strings on an Intella (tags are `{tag, source}` objects, untyped on v1). */
function tagsOf(i: FamiliaSource): string[] {
  const raw = i.tags ?? []
  return raw.map(t => (typeof t === 'string' ? t : t?.tag ?? '')).filter(Boolean).map(t => t.toLowerCase())
}

/** Infer a model's family from a recognized tag first, else from its name/dest/architectura.
 *  Returns undefined when nothing recognizable is present. This is the LEGACY heuristic — used
 *  only to populate `familia`, never as a read-time substitute for it. */
export function inferFamilia(i: FamiliaSource): string | undefined {
  const tags = tagsOf(i)
  const tagged = FAMILY_TAGS.find(f => tags.includes(f))
  if (tagged) return tagged
  const hay = `${i.nomen ?? ''} ${i.dest ?? ''} ${i.architectura ?? ''}`.toLowerCase()
  return FAMILY_TAGS.find(f => hay.includes(f))
}

/** Read-time accessor: the authoritative first-class `familia`, falling back to inference for
 *  any straggler not yet backfilled. Once the backfill + upsert self-heal cover the catalog the
 *  fallback is inert, but it keeps callers correct in the meantime. */
export function familiaOf(i: Pick<Intella, 'nomen' | 'dest' | 'architectura' | 'familia'> & { tags?: FamiliaSource['tags'] }): string | undefined {
  return i.familia ?? inferFamilia(i)
}
