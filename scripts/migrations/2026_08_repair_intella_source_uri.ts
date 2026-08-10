#!/usr/bin/env -S npx tsx
// =============================================================================
// Repair dead HuggingFace download URIs on `Intella.sources[]` after the hub
// org rename (`ms2stationthis` → `noema-art`).
// =============================================================================
//
// READ THIS BEFORE "SIMPLIFYING" THE SCRIPT INTO A STRING REPLACE.
//
// Stored `sources[].uri` values still name the old org, and they are dead on
// TWO independent axes:
//
//   1. the `/resolve/` DOWNLOAD path does not follow an org rename — the API
//      path `/api/models/{org}/{repo}` does, the download path does not; and
//   2. filenames inside the renamed repos changed as well
//      (e.g. `<slug>-<hash>.safetensors` → `<Repo>.safetensors`).
//
// So rewriting only the org yields a set of DIFFERENTLY broken URLs while
// making the records look repaired. This script therefore reconciles instead
// of rewriting: it discovers affected records, resolves each repo's real file
// listing from the HF API, and — the load-bearing rule —
//
//     A URI IS NEVER WRITTEN UNTIL THAT EXACT URI HAS RETURNED 200.
//
// Anything it cannot prove (repo not reachable, file listing ambiguous, rebuilt
// URI not 200) is REPORTED and SKIPPED, never guessed at.
//
// Scope notes:
//   * `sha256` and `contentHash` are NOT touched. A renamed file may or may not
//     be byte-identical and this script cannot cheaply know. Leaving the hash
//     alone is the safe failure mode: the downloader verifies after download,
//     so a genuine content change fails LOUDLY at fetch time rather than
//     silently installing different weights. Every repaired record that carries
//     a `sha256` is called out at the end so it can be re-hashed deliberately.
//   * `sources[].meta` is left as stored; only the `uri` is rewritten.
//   * Stale strings found only inside an untyped `legacy` blob are REPORTED and
//     never rewritten — that blob is not the download path.
//   * Sources whose URI is not a HuggingFace `/resolve/` URL (miladystation,
//     civitai, anything else) are ignored entirely.
//
// Idempotent: a repaired URI no longer names the stale org, so a re-run is a
// no-op over records already fixed.
//
// SAFETY: the target DB MUST be named explicitly via `--db <name>` (there is NO
// default — `.env` points `MONGODB_URI` at the live cluster). Dev/test work uses
// `noemaplane`; `noema` is the live app DB and is refused unless you also pass
// `--prod` (a deliberate, eyes-open production migration).
//
// Run (dev):  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_08_repair_intella_source_uri.ts --db noemaplane --dry-run
//   drop --dry-run to write.
// Run (prod): …same… --db noema --prod        (only when intentionally migrating production)

import { MongoClient } from 'mongodb'
import {
  CURRENT_HF_ORG,
  STALE_HF_ORG,
  buildResolveUri,
  chooseReplacementFile,
  isStaleOrg,
  parseHfResolveUri,
} from '../../src/crystal/intellaSourceRepair.js'

const TAG = '[repair-intella-source-uri]'
const DRY_RUN = process.argv.includes('--dry-run')
const HF_API = 'https://huggingface.co/api/models'

/** Read `--db <name>`; no default — an unset target is an error, not a guess at production. */
function targetDb(): string {
  const i = process.argv.indexOf('--db')
  const name = i >= 0 ? process.argv[i + 1] : undefined
  if (!name) {
    console.error(`${TAG} refusing to run: pass --db <name> (e.g. --db noemaplane). No default — .env points at the live cluster.`)
    process.exit(1)
  }
  if (name === 'noema' && !process.argv.includes('--prod')) {
    console.error(`${TAG} refusing to target the PRODUCTION db "noema" without --prod. Use --db noemaplane for dev/test.`)
    process.exit(1)
  }
  return name
}

interface Repaired { id: string; index: number; oldUri: string; newUri: string; hasSha256: boolean }
interface Skipped { id: string; index: number; oldUri: string; reason: string }

/** Fetch a repo's sibling file listing under the current org. `null` = not reachable. */
async function fetchSiblings(repo: string): Promise<string[] | null> {
  const res = await fetch(`${HF_API}/${CURRENT_HF_ORG}/${encodeURIComponent(repo)}`)
  if (!res.ok) return null
  const body = (await res.json()) as { siblings?: Array<{ rfilename?: string }> }
  return (body.siblings ?? []).map(s => s.rfilename).filter((f): f is string => typeof f === 'string')
}

/** Prove a rebuilt download URI actually serves. HEAD first; ranged GET if HEAD is not honoured. */
async function uriServes(uri: string): Promise<boolean> {
  try {
    const head = await fetch(uri, { method: 'HEAD', redirect: 'follow' })
    if (head.ok) return true
    if (head.status !== 405 && head.status !== 501) return false
  } catch {
    // fall through to the ranged GET
  }
  try {
    const ranged = await fetch(uri, { method: 'GET', redirect: 'follow', headers: { Range: 'bytes=0-0' } })
    // Never read the body — a weight file is not something to download here.
    return ranged.status === 200 || ranged.status === 206
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const dbName = targetDb()
  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('intellae')

    // Discover, never assume a count. Records are found by the stale org appearing in a
    // source URI; the parse decides whether it is really an HF /resolve/ download path.
    const docs = await col.find({ 'sources.uri': { $regex: STALE_HF_ORG } }).toArray()
    console.log(`${TAG} ${dbName}.intellae — ${docs.length} record(s) with a source URI naming the renamed org`)

    const repaired: Repaired[] = []
    const ambiguous: Skipped[] = []
    const unreachable: Skipped[] = []
    const siblingCache = new Map<string, string[] | null>()

    for (const doc of docs) {
      const sources = Array.isArray(doc.sources) ? doc.sources : []
      for (let index = 0; index < sources.length; index++) {
        const source = sources[index] as { uri?: string; sha256?: string; format?: string }
        const oldUri = typeof source?.uri === 'string' ? source.uri : ''
        const parts = parseHfResolveUri(oldUri)
        if (!parts || !isStaleOrg(parts.org)) continue

        const id = String(doc.id ?? doc._id)

        if (!siblingCache.has(parts.repo)) siblingCache.set(parts.repo, await fetchSiblings(parts.repo))
        const siblings = siblingCache.get(parts.repo) ?? null
        if (siblings === null) {
          unreachable.push({ id, index, oldUri, reason: `repo listing not reachable under the current org` })
          continue
        }

        const choice = chooseReplacementFile(parts.file, siblings, source.format)
        if ('ambiguous' in choice) {
          ambiguous.push({ id, index, oldUri, reason: choice.ambiguous })
          continue
        }

        const newUri = buildResolveUri({ ...parts, file: choice.file })
        if (!(await uriServes(newUri))) {
          unreachable.push({ id, index, oldUri, reason: `rebuilt URI did not return 200: ${newUri}` })
          continue
        }

        repaired.push({ id, index, oldUri, newUri, hasSha256: typeof source.sha256 === 'string' })
        if (!DRY_RUN) {
          await col.updateOne({ _id: doc._id }, { $set: { [`sources.${index}.uri`]: newUri } })
        }
      }
    }

    // Untyped `legacy` blobs: probe the raw document, report only — never rewrite.
    const legacyHits: string[] = []
    const legacyDocs = await col.find({ legacy: { $exists: true } }, { projection: { id: 1, legacy: 1 } }).toArray()
    for (const doc of legacyDocs) {
      if (JSON.stringify(doc.legacy ?? null).includes(STALE_HF_ORG)) legacyHits.push(String(doc.id ?? doc._id))
    }

    console.log(`${TAG} --- repaired (${repaired.length})${DRY_RUN ? ' [dry-run, no writes]' : ''}`)
    for (const r of repaired) console.log(`${TAG}   ${r.id} sources[${r.index}]: ${r.oldUri} -> ${r.newUri}`)
    console.log(`${TAG} --- skipped, ambiguous (${ambiguous.length})`)
    for (const s of ambiguous) console.log(`${TAG}   ${s.id} sources[${s.index}]: ${s.oldUri} — ${s.reason}`)
    console.log(`${TAG} --- skipped, unreachable (${unreachable.length})`)
    for (const s of unreachable) console.log(`${TAG}   ${s.id} sources[${s.index}]: ${s.oldUri} — ${s.reason}`)

    const withSha = repaired.filter(r => r.hasSha256)
    if (withSha.length > 0) {
      console.log(
        `${TAG} WARNING: ${withSha.length} repaired source(s) carry a sha256 that was NOT updated — ` +
        `the renamed file may not be byte-identical. The downloader verifies after download, so a real ` +
        `content change fails at fetch time; re-hash these deliberately if needed: ` +
        withSha.map(r => `${r.id}[${r.index}]`).join(', '),
      )
    }
    if (legacyHits.length > 0) {
      console.log(
        `${TAG} NOTE: ${legacyHits.length} record(s) carry the renamed org inside an untyped 'legacy' blob. ` +
        `That blob is not the download path and is left untouched: ${legacyHits.join(', ')}`,
      )
    }

    console.log(
      `${TAG} done — repaired=${repaired.length} ambiguous=${ambiguous.length} ` +
      `unreachable=${unreachable.length} legacy-only-mentions=${legacyHits.length}` +
      `${DRY_RUN ? ' [dry-run, no writes]' : ''}`,
    )
  } finally {
    await client.close()
  }
}

main().catch(err => { console.error(`${TAG} failed:`, err); process.exit(1) })
