import type { Collection, Document } from 'mongodb'
import type { Intella, Intellae, IntellaGenus, IntellaSource, Intellarum } from '../types/intelligendi.js'
import { inferFamilia } from './inferFamilia.js'

// =============================================================================
// V2 → V1 backward-compat shim
// =============================================================================
//
// The chunk migration's output uses the v2 schema (`docs/spec/intella-schema.md`):
//   - LoRA-activation fields nested under `params.{triggerWords[], slug,
//     defaultWeight, baseIntellaId}`
//   - Access as a discriminated union `{ kind: 'public' | 'private' | ... }`
//
// The current `Intella` TypeScript type and every read site downstream
// (resolver, Compiler, bulletin) still expects v1 shape: flat `trigger` (string,
// comma-separated), `slug`, `defaultWeight`, `baseIntellaId`, `access: 'public'
// | 'private'`, `ownerAnimaId`. Until the proper type refactor lands (separate
// sprint), this shim normalizes v2 records to v1 at read time.
//
// Two places need updating, not just one:
//   1. `fromDoc` — project the document shape on the way out
//   2. The query builders for `findByTrigger` / `triggerMap` — `$or` over both
//      shapes so v2 records actually match. Without this, projecting on the way
//      out is moot because v2 docs never get returned.
//
// v1 records pass through both layers unchanged.

interface V2Doc {
  params?: {
    triggerWords?: string[]
    slug?: string
    defaultWeight?: number
    baseIntellaId?: string
  }
  access?: { kind?: string; ownerAnimaId?: string } | string
  ownerAnimaId?: string
  [key: string]: unknown
}

function isV2(doc: Document): boolean {
  const d = doc as V2Doc
  return Array.isArray(d.params?.triggerWords)
}

/** Collapse the v2 access discriminated union into the v1 binary axis. */
function collapseAccess(access: V2Doc['access']): 'public' | 'private' | undefined {
  if (access === undefined) return undefined
  if (typeof access === 'string') return access === 'public' ? 'public' : 'private'
  // discriminated union: only 'public' projects to v1 public; 'unlisted',
  // 'private', 'group', 'hidden' all collapse to private (resolver-conservative —
  // never wider than the source). The resolver's per-anima visibility still
  // gates final selection.
  return access.kind === 'public' ? 'public' : 'private'
}

function projectV2ToV1(doc: Document): Intella {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, ...rest } = doc as Document & { _id: unknown }
  if (!isV2(rest as Document)) return rest as Intella

  const d = rest as V2Doc
  const p = d.params ?? {}
  const accessV1 = collapseAccess(d.access)
  const ownerAnimaId =
    (typeof d.access === 'object' && d.access?.ownerAnimaId) || d.ownerAnimaId

  const projected: Record<string, unknown> = {
    ...rest,
    // v1 expects a comma-separated trigger string; the resolver's caller-side
    // map builder (MongoIntella.triggerMap) splits on comma before lower/dedupe.
    trigger: (p.triggerWords ?? []).join(','),
    slug: p.slug,
    defaultWeight: p.defaultWeight,
    baseIntellaId: p.baseIntellaId,
  }
  if (accessV1) projected.access = accessV1
  if (ownerAnimaId) projected.ownerAnimaId = ownerAnimaId
  // Drop the v2-only nested params block from the projection so consumers don't
  // see both shapes simultaneously.
  delete projected.params
  return projected as unknown as Intella
}

/**
 * Build the access half of a $or query: matches a public record (v1 OR v2)
 * plus (when animaId given) any private record owned by that anima.
 */
function buildAccessOrClauses(animaId: string | undefined): Record<string, unknown>[] {
  const clauses: Record<string, unknown>[] = [
    { access: 'public' },              // v1
    { 'access.kind': 'public' },       // v2
    { canonica: true },                // platform-curated Intellae are public by definition —
                                       // seeded LoRAs set no `access` field, so without this they'd
                                       // be filtered out of trigger resolution entirely.
  ]
  if (animaId) {
    clauses.push({ ownerAnimaId: animaId })            // v1
    clauses.push({ 'access.ownerAnimaId': animaId })   // v2
  }
  return clauses
}

export class MongoIntella implements Intellarum {
  constructor(private readonly col: Collection) {}

  async find(id: string): Promise<Intella | null> {
    const doc = await this.col.findOne({ id })
    return doc ? projectV2ToV1(doc) : null
  }

  async list(genus?: IntellaGenus): Promise<Intellae> {
    const query = genus !== undefined ? { genus } : {}
    const docs = await this.col.find(query).toArray()
    return docs.map(projectV2ToV1)
  }

  async canonical(): Promise<Intellae> {
    const docs = await this.col.find({ canonica: true }).toArray()
    return docs.map(projectV2ToV1)
  }

  async findByTrigger(trigger: string, familia: string, animaId?: string): Promise<Intellae> {
    const triggerLower = trigger.toLowerCase()
    // Compat keys on the model FAMILY (`familia`, exact equality), not the old
    // baseIntellaId join. Trigger still substring-matches either v1's flat
    // `trigger` string or v2's `params.triggerWords[]` array (Mongo's $regex on
    // an array matches when any element matches).
    const query: Record<string, unknown> = {
      genus: 'lora',
      familia,
      $and: [
        {
          $or: [
            { trigger: { $regex: new RegExp(triggerLower, 'i') } },           // v1 flat string
            { 'params.triggerWords': { $regex: new RegExp(triggerLower, 'i') } }, // v2 array
          ],
        },
        { $or: buildAccessOrClauses(animaId) },
      ],
    }
    const docs = await this.col.find(query).toArray()
    return docs.map(projectV2ToV1)
  }

  async triggerMap(familia: string, animaId?: string): Promise<Map<string, Intellae>> {
    // Compat keys on the model FAMILY (`familia`, exact equality).
    const query: Record<string, unknown> = {
      genus: 'lora',
      familia,
      $and: [
        {
          $or: [
            { trigger: { $exists: true, $ne: '' } },          // v1 flat string
            { 'params.triggerWords.0': { $exists: true } },   // v2 array
          ],
        },
        { $or: buildAccessOrClauses(animaId) },
      ],
    }
    const docs = await this.col.find(query).toArray()
    const map = new Map<string, Intellae>()
    for (const doc of docs) {
      const intella = projectV2ToV1(doc)
      // Comma-split the (projected) trigger string into per-alias map keys.
      for (const raw of (intella.trigger ?? '').split(',')) {
        const key = raw.trim().toLowerCase()
        if (!key) continue
        const bucket = map.get(key)
        if (bucket) bucket.push(intella)
        else map.set(key, [intella])
      }
    }
    return map
  }

  /** Insert or fully replace an Intella record. Used for seeding canonical models. Self-heals
   *  the first-class `familia` from the tag/name heuristic when a record arrives without one, so
   *  every write seam keeps `familia` populated and `triggerMap` (which keys on it) stays whole. */
  async upsert(intella: Intella): Promise<void> {
    const record = intella.familia ? intella : (() => {
      const familia = inferFamilia(intella)
      return familia ? { ...intella, familia } : intella
    })()
    await this.col.replaceOne({ id: record.id }, record, { upsert: true })
  }

  /** Flip a model's resolvability — the publishing reconciler's write seam (§5d).
   *  Sets the v1 binary `access` string; the top-level `ownerAnimaId` gating is
   *  untouched, so a later flip back to 'private' restores owner-scoped resolution. */
  async setAccess(id: string, access: 'public' | 'private'): Promise<Intella | null> {
    const doc = await this.col.findOneAndUpdate(
      { id },
      { $set: { access, mutatum: new Date() } },
      { returnDocument: 'after' },
    )
    return doc ? projectV2ToV1(doc) : null
  }

  /** Prepend a download source (new sources[0]), de-duplicating by uri — the
   *  our-bucket self-host seam. `$pull` then `$push $position:0` in one round-trip
   *  would race; do it read-modify-write under the doc's current source list. */
  async addSource(id: string, source: IntellaSource): Promise<Intella | null> {
    const current = await this.col.findOne({ id })
    if (!current) return null
    const existing = (Array.isArray(current.sources) ? current.sources : []) as IntellaSource[]
    const sources = [source, ...existing.filter((s) => s?.uri !== source.uri)]
    const doc = await this.col.findOneAndUpdate(
      { id },
      { $set: { sources, mutatum: new Date() } },
      { returnDocument: 'after' },
    )
    return doc ? projectV2ToV1(doc) : null
  }

  /** Remove a download source by uri — the inverse of `addSource` (retract). */
  async removeSource(id: string, uri: string): Promise<Intella | null> {
    const current = await this.col.findOne({ id })
    if (!current) return null
    const existing = (Array.isArray(current.sources) ? current.sources : []) as IntellaSource[]
    const sources = existing.filter((s) => s?.uri !== uri)
    const doc = await this.col.findOneAndUpdate(
      { id },
      { $set: { sources, mutatum: new Date() } },
      { returnDocument: 'after' },
    )
    return doc ? projectV2ToV1(doc) : null
  }
}
