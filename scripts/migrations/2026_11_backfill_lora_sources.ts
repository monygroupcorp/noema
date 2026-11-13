#!/usr/bin/env -S npx tsx
// =============================================================================
// Backfill download sources for canonica/public LoRAs whose `sources[]` names
// no file to download.
// =============================================================================
//
// The legacy LoRA migration brought these records across with their names,
// triggers, `dest` filenames and usage counts but no download URL — `sources[]`
// is empty, or holds a bare host or a Civitai model page — so every prompt that
// triggers one fails on the pod. This script finds them (by shape: no source is
// download-shaped, see `isDownloadUri`), looks for the weights where they
// plausibly still live, and:
//
//     A SOURCE IS NEVER WRITTEN UNTIL ITS URI HAS BEEN FETCHED ANONYMOUSLY
//     AND SERVED A VALID SAFETENSORS HEADER.
//
// "Anonymously" matters: a public LoRA's source URI goes to the pod as-is, with
// no token (only private imports are proxied). A Civitai version that serves
// only with an API key would still fail on the pod, so it is reported as a lead
// for an operator to mirror, not written.
//
// Where it looks, in order (rules in src/crystal/loraSourceBackfill.ts):
//   1. our weights mirror, at loras/<the record's own dest filename>;
//   2. the Civitai model a stored source already links to (its named version,
//      else the version with the dest filename, else its only same-family one);
//   3. Civitai search — accepted only on an exact file-name match or on ALL of
//      (at least two of) the record's triggers, against a same-family base.
//
// A recovered source is PREPENDED: whatever the record held stays behind it as
// provenance, and sources[0] — what the pod downloads — is the proven URI.
//
// A record with no provable source is tagged `sources-unrecoverable` (so it can
// be found, and so the guard's history is legible) and listed — with its usage
// count, since one that is still being triggered is a broken promise to users.
//
// Writes are conditional on `sources` being exactly what was read, so a record
// repaired by hand in the meantime is never overwritten. Idempotent: a repaired
// record has a download-shaped source and is not discovered again.
//
// SAFETY: `--db <name>` is required; see _dbTarget.ts. `--report <file>` writes
// the full per-record outcome as JSON.
//
// Run (READ, prod):  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_11_backfill_lora_sources.ts --db <LIVE_DB> --prod --dry-run --report out.json
// Run (WRITE, prod): …same, minus --dry-run…

import { writeFileSync } from 'node:fs'
import { MongoClient, type Document, type UpdateFilter } from 'mongodb'
import {
  UNRECOVERABLE_TAG,
  civitaiDownloadUri,
  civitaiSource,
  destFile,
  matchCivitaiVersion,
  mirrorLoraUri,
  mirrorSource,
  needsBackfill,
  parseCivitaiLink,
  pickLinkedVersion,
  safetensorsHeaderLength,
  type CivitaiMatch,
  type CivitaiVersion,
} from '../../src/crystal/loraSourceBackfill.js'
import type { IntellaSource } from '../../src/types/intelligendi.js'
import { resolveDbTarget } from './_dbTarget.js'

const TAG = '[backfill-lora-sources]'
const TAG_SOURCE = 'lora-source-backfill'

/** The driver's operator types reject `$push`/`$pull` on an untyped collection's array field;
 *  these documents are plain Mongo updates, so state that once here. */
const update = (u: Document): UpdateFilter<Document> => u as UpdateFilter<Document>

type Outcome =
  | { kind: 'recovered'; source: IntellaSource; evidence: string; bytes: number | null }
  | { kind: 'unrecoverable'; leads: string[] }

interface Row {
  id: string
  nomen: string
  dest: string
  familia?: string
  usageCount: number
  outcome: Outcome
  /** False when the conditional write matched nothing (the record changed since it was read). */
  written?: boolean
}

/** The first `n` bytes of a response body, then cancel — a server that ignores Range must not
 *  make this download a whole weight file. */
async function firstBytes(res: Response, n: number): Promise<Uint8Array> {
  const out = new Uint8Array(n)
  let got = 0
  const reader = res.body?.getReader()
  if (!reader) return out.slice(0, 0)
  while (got < n) {
    const { done, value } = await reader.read()
    if (done) break
    const take = Math.min(value.length, n - got)
    out.set(value.subarray(0, take), got)
    got += take
  }
  await reader.cancel()
  return out.slice(0, got)
}

/** Fetch `uri` with no credentials and prove it serves a safetensors file. */
async function probeSafetensors(uri: string): Promise<{ ok: true; bytes: number | null } | { ok: false; why: string }> {
  try {
    const head = await fetch(uri, { headers: { Range: 'bytes=0-7' }, redirect: 'follow' })
    if (head.status !== 200 && head.status !== 206) { await head.body?.cancel(); return { ok: false, why: `HTTP ${head.status}` } }
    const first = await firstBytes(head, 8)
    const total = Number((head.headers.get('content-range') ?? '').split('/')[1]) || null
    const n = safetensorsHeaderLength(first)
    if (n === null) return { ok: false, why: 'served bytes are not a safetensors header' }
    const body = await fetch(uri, { headers: { Range: `bytes=8-${7 + n}` }, redirect: 'follow' })
    if (body.status !== 200 && body.status !== 206) { await body.body?.cancel(); return { ok: false, why: `header read HTTP ${body.status}` } }
    // A 200 is the whole file from byte 0; a 206 starts at byte 8.
    const raw = body.status === 206 ? await firstBytes(body, n) : (await firstBytes(body, 8 + n)).slice(8)
    const header = JSON.parse(new TextDecoder().decode(raw)) as Record<string, { dtype?: string }>
    const tensors = Object.entries(header).filter(([k, v]) => k !== '__metadata__' && typeof v?.dtype === 'string')
    if (tensors.length === 0) return { ok: false, why: 'safetensors header lists no tensors' }
    return { ok: true, bytes: total }
  } catch (err) {
    return { ok: false, why: `fetch failed: ${(err as Error).message}` }
  }
}

type CivitaiApiModel = { id: number; modelVersions?: Array<{ id: number; baseModel?: string; trainedWords?: string[]; files?: Array<{ name: string }> }> }

function versionsOf(m: CivitaiApiModel): CivitaiVersion[] {
  return (m.modelVersions ?? []).map(v => ({ modelId: m.id, versionId: v.id, baseModel: v.baseModel, trainedWords: v.trainedWords, files: (v.files ?? []).map(f => f.name) }))
}

/** Every version of one Civitai model, or `[]` when it cannot be read. Anonymous. */
async function civitaiModel(modelId: number): Promise<CivitaiVersion[]> {
  try {
    const res = await fetch(`https://civitai.com/api/v1/models/${modelId}`)
    await new Promise(r => setTimeout(r, 400))
    if (!res.ok) { console.log(`${TAG}   civitai model ${modelId} -> HTTP ${res.status}`); return [] }
    return versionsOf((await res.json()) as CivitaiApiModel)
  } catch (err) {
    // One bad response must not stop the batch; the record is simply not recovered this run.
    console.log(`${TAG}   civitai model ${modelId} -> ${(err as Error).message}`)
    return []
  }
}

/** Civitai LoRA versions found by searching for each query. Searches anonymously. */
async function civitaiVersions(queries: string[]): Promise<CivitaiVersion[]> {
  const out: CivitaiVersion[] = []
  for (const q of queries) {
    try {
      const res = await fetch(`https://civitai.com/api/v1/models?types=LORA&limit=20&nsfw=true&query=${encodeURIComponent(q)}`)
      await new Promise(r => setTimeout(r, 400))
      if (!res.ok) { console.log(`${TAG}   civitai search '${q}' -> HTTP ${res.status}`); continue }
      const body = (await res.json()) as { items?: CivitaiApiModel[] }
      for (const m of body.items ?? []) out.push(...versionsOf(m))
    } catch (err) {
      console.log(`${TAG}   civitai search '${q}' -> ${(err as Error).message}`)
    }
  }
  return out
}

/** Search terms for a record: its name, and its file stem without the `flux`/step-count suffixes. */
function searchQueries(nomen: string, dest: string): string[] {
  const stem = destFile(dest).replace(/(\.safetensors)+$/i, '')
  const bare = stem.replace(/[-_]?0*\d{3,}$/, '').replace(/flux$/i, '').replace(/[_-]+/g, ' ').trim()
  return [...new Set([bare, nomen].filter(s => s && s.length >= 3))]
}

function triggersOf(doc: Record<string, unknown>): string[] {
  const p = doc.params as { triggerWords?: unknown } | undefined
  if (Array.isArray(p?.triggerWords)) return p.triggerWords.map(String)
  return typeof doc.trigger === 'string' ? doc.trigger.split(',').map(s => s.trim()) : []
}

async function decide(doc: Record<string, unknown>): Promise<Outcome> {
  const dest = String(doc.dest ?? '')
  const leads: string[] = []

  const mirror = mirrorLoraUri(dest)
  const m = await probeSafetensors(mirror)
  if (m.ok) return { kind: 'recovered', source: mirrorSource(dest), evidence: `our mirror serves ${destFile(dest)}`, bytes: m.bytes }
  leads.push(`mirror ${mirror}: ${m.why}`)

  const familia = typeof doc.familia === 'string' ? doc.familia : undefined
  const stored = (Array.isArray(doc.sources) ? doc.sources : []) as Array<{ uri?: unknown }>
  for (const link of stored.map(x => parseCivitaiLink(x?.uri)).filter(l => l !== null)) {
    const linked = pickLinkedVersion(link, { dest, familia }, await civitaiModel(link.modelId))
    if (!linked) { leads.push(`civitai model ${link.modelId} (linked by the record): no version to trust`); continue }
    const p = await probeSafetensors(civitaiDownloadUri(linked.versionId))
    if (p.ok) return { kind: 'recovered', source: civitaiSource(linked), evidence: `civitai ${linked.modelId}/${linked.versionId}: ${linked.evidence}`, bytes: p.bytes }
    leads.push(`civitai ${linked.modelId}/${linked.versionId} (${linked.evidence}) does not serve anonymously: ${p.why} — mirror it into our bucket`)
  }

  const match: CivitaiMatch | null = matchCivitaiVersion(
    { dest, familia, triggers: triggersOf(doc) },
    await civitaiVersions(searchQueries(String(doc.nomen ?? ''), dest)),
  )
  if (!match) { leads.push('civitai search: no version matched by file name or by all triggers'); return { kind: 'unrecoverable', leads } }

  const c = await probeSafetensors(civitaiDownloadUri(match.versionId))
  if (c.ok) return { kind: 'recovered', source: civitaiSource(match), evidence: `civitai ${match.modelId}/${match.versionId}: ${match.evidence}`, bytes: c.bytes }
  leads.push(`civitai ${match.modelId}/${match.versionId} (${match.evidence}) does not serve anonymously: ${c.why} — mirror it into our bucket`)
  return { kind: 'unrecoverable', leads }
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const { db: dbName, dryRun: DRY_RUN } = resolveDbTarget(process.argv, TAG)
  const r = process.argv.indexOf('--report')
  const reportPath = r >= 0 ? process.argv[r + 1] : undefined
  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('intellae')
    const publicLora = { $or: [{ canonica: true }, { access: 'public' }, { 'access.kind': 'public' }] }
    // Shape is decided in code (`isDownloadUri`), not in a query, so it has one definition.
    const docs = (await col.find({ genus: 'lora', ...publicLora }).toArray()).filter(d => needsBackfill(d.sources))
    console.log(`${TAG} ${dbName}.intellae — ${docs.length} canonica/public LoRA(s) with no download-shaped source`)

    const rows: Row[] = []
    for (const doc of docs) {
      const outcome = await decide(doc)
      const row: Row = {
        id: String(doc.id ?? doc._id), nomen: String(doc.nomen ?? ''), dest: String(doc.dest ?? ''),
        familia: typeof doc.familia === 'string' ? doc.familia : undefined,
        usageCount: typeof doc.usageCount === 'number' ? doc.usageCount : 0, outcome,
      }
      console.log(`${TAG}   ${row.outcome.kind.padEnd(13)} ${row.nomen} (used ${row.usageCount})`)
      if (DRY_RUN) { rows.push(row); continue }
      // Conditional on `sources` being exactly what was read: a concurrent repair wins.
      const unchanged = { _id: doc._id, sources: doc.sources ?? null }
      if (outcome.kind === 'recovered') {
        const kept = Array.isArray(doc.sources) ? doc.sources : []
        const res = await col.updateOne(
          unchanged,
          update({ $set: { sources: [outcome.source, ...kept], mutatum: new Date() }, $pull: { tags: { tag: UNRECOVERABLE_TAG } } }),
        )
        row.written = res.matchedCount === 1
        rows.push(row)
      } else {
        const res = await col.updateOne(
          { ...unchanged, 'tags.tag': { $ne: UNRECOVERABLE_TAG } },
          update({ $push: { tags: { tag: UNRECOVERABLE_TAG, source: TAG_SOURCE } }, $set: { mutatum: new Date() } }),
        )
        // Already tagged by an earlier run is not a skip: the record is marked either way.
        row.written = res.matchedCount === 1 || (doc.tags ?? []).some((t: { tag?: string }) => t?.tag === UNRECOVERABLE_TAG)
        rows.push(row)
      }
    }

    const skipped = rows.filter(x => x.written === false)
    const recovered = rows.filter(x => x.outcome.kind === 'recovered' && x.written !== false)
    const lost = rows.filter(x => x.outcome.kind === 'unrecoverable' && x.written !== false).sort((a, b) => b.usageCount - a.usageCount)
    console.log(`${TAG} --- recovered (${recovered.length})${DRY_RUN ? ' [dry-run, no writes]' : ''}`)
    for (const x of recovered) if (x.outcome.kind === 'recovered') console.log(`${TAG}   ${x.nomen}: ${x.outcome.source.uri} — ${x.outcome.evidence}`)
    console.log(`${TAG} --- unrecoverable (${lost.length}), tagged '${UNRECOVERABLE_TAG}'; still in use: ${lost.filter(x => x.usageCount > 0).length}`)
    for (const x of lost) if (x.outcome.kind === 'unrecoverable') console.log(`${TAG}   ${x.nomen} (used ${x.usageCount}): ${x.outcome.leads.join('; ')}`)
    if (skipped.length > 0) console.log(`${TAG} --- skipped (${skipped.length}): changed since read, not written — re-run: ${skipped.map(x => x.nomen).join(', ')}`)
    if (reportPath) writeFileSync(reportPath, JSON.stringify({ db: dbName, dryRun: DRY_RUN, at: new Date().toISOString(), rows }, null, 1))
    console.log(`${TAG} done — candidates=${rows.length} recovered=${recovered.length} unrecoverable=${lost.length} skipped=${skipped.length}${DRY_RUN ? ' [dry-run, no writes]' : ''}`)
  } finally {
    await client.close()
  }
}

main().catch(err => { console.error(`${TAG} failed:`, err); process.exit(1) })
