#!/usr/bin/env -S npx tsx
// =============================================================================
// report-addressless-intellae — which registry records name no file?
// =============================================================================
//
// A registry record with no `sources[].uri` is a name without a file. The Compiler refuses such a
// weight when a user adds it to a run (MODEL_UNFETCHABLE) and the Telegram picker no longer offers
// it, but neither of those puts the file back. This lists every such record in a live registry so
// the addresses can be filled in — the legacy LoRA migration leaves `sources` empty whenever the
// old document carried no download URL, and those records keep their trigger words, so each one
// here is a word an old customer may still be typing.
//
// READ-ONLY. Connects, queries, prints, exits. Nothing is written.
//
// Usage (the same env the migrations read):
//
//     MONGODB_URI=... DB_NAME=... npx tsx scripts/report-addressless-intellae.ts
//     ./scripts/run-with-env.sh npx tsx scripts/report-addressless-intellae.ts     # from .env
//     ... --json                                                                     # machine-readable
//
// Env: MONGODB_URI (required), DB_NAME (required), INTELLAE_COLLECTION (default 'intellae').
// =============================================================================

import { MongoClient, type Document } from 'mongodb'

interface Row {
  id: string
  nomen: string
  genus: string
  familia: string
  trigger: string
  access: string
  canonica: boolean
  owner: string
}

/** The query: no `sources`, an empty list, or a first source with no usable uri. */
export const ADDRESSLESS_QUERY: Document = {
  $or: [
    { sources: { $exists: false } },
    { sources: { $size: 0 } },
    { 'sources.0.uri': { $in: [null, ''] } },
  ],
}

function asRow(doc: Document): Row {
  const trigger = typeof doc.trigger === 'string' && doc.trigger !== ''
    ? doc.trigger
    : Array.isArray(doc.params?.triggerWords) ? doc.params.triggerWords.join(',') : ''
  return {
    id: String(doc.id ?? doc._id ?? ''),
    nomen: String(doc.nomen ?? doc.slug ?? ''),
    genus: String(doc.genus ?? ''),
    familia: String(doc.familia ?? ''),
    trigger,
    access: String(doc.access ?? 'public'),
    canonica: doc.canonica === true,
    owner: doc.ownerKey ? String(doc.ownerKey) : doc.ownerAnimaId ? `anima:${doc.ownerAnimaId}` : '',
  }
}

export async function run(argv: string[]): Promise<number> {
  const uri = process.env.MONGODB_URI
  const dbName = process.env.DB_NAME
  const coll = process.env.INTELLAE_COLLECTION ?? 'intellae'
  if (!uri || !dbName) {
    console.error('report-addressless-intellae: MONGODB_URI and DB_NAME are required (read-only; nothing is written)')
    return 2
  }
  const json = argv.includes('--json')
  const client = new MongoClient(uri)
  try {
    await client.connect()
    const col = client.db(dbName).collection(coll)
    const total = await col.countDocuments({})
    const docs = await col.find(ADDRESSLESS_QUERY).sort({ genus: 1, nomen: 1 }).toArray()
    const rows = docs.map(asRow)

    if (json) {
      console.log(JSON.stringify({ total, addressless: rows.length, rows }, null, 2))
      return 0
    }

    const byGenus = new Map<string, number>()
    for (const r of rows) byGenus.set(r.genus || '?', (byGenus.get(r.genus || '?') ?? 0) + 1)
    const triggered = rows.filter(r => r.trigger !== '').length
    const canonical = rows.filter(r => r.canonica).length

    console.log(`${coll}: ${total} record(s), ${rows.length} with no download address`)
    for (const [g, n] of [...byGenus.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${g}: ${n}`)
    console.log(`  with a trigger word (a prompt can still reach them): ${triggered}`)
    console.log(`  canonical (a seeded flow may depend on them): ${canonical}`)
    if (rows.length > 0) {
      console.log('')
      console.log('id\tgenus\tfamilia\tnomen\ttrigger\taccess\towner')
      for (const r of rows) console.log([r.id, r.genus, r.familia, r.nomen, r.trigger, r.access, r.owner].join('\t'))
      console.log('')
      console.log('Each row is a weight no pod can fetch. Fill in sources[0] (mirror the file to an auth-free')
      console.log('host and record that address), or retire the record. A canonical row is a seed to fix.')
    }
    return 0
  } finally {
    await client.close().catch(() => undefined)
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  run(process.argv.slice(2)).then(code => { process.exitCode = code }, err => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}
