/**
 * seed-canon.ts
 *
 * Registers canonical Intellae and Essentiae into the crystal's staging DB.
 * Safe to run multiple times — registration is idempotent (upsert by id+versio).
 *
 * Usage:
 *   ./scripts/run-with-env.sh npx tsx scripts/crystal/seed-canon.ts
 *
 * Targets the DB named by CRYSTAL_DB env var (default: noemaplane_stage).
 * Never touches the 'noema' or 'noemaplane' production databases.
 */

import { MongoClient } from 'mongodb'
import { MongoModorum } from '../../src/crystal/MongoModorum.js'
import { hashModus } from '../../src/crystal/hashModus.js'
import { CANONICAL_ESSENTIAE } from '../../src/crystal/seeds/essentiae.js'
import { CANONICAL_COMPOSITI } from '../../src/crystal/seeds/compositi.js'
import { CANONICAL_INTELLAE } from '../../src/crystal/seeds/intellae.js'

const URI = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
const DB = process.env.CRYSTAL_DB ?? 'noemaplane_stage'

if (DB === 'noema' || DB === 'noemaplane') {
  console.error(`[seed-canon] Refusing to seed into protected DB '${DB}'. Set CRYSTAL_DB.`)
  process.exit(1)
}

const client = new MongoClient(URI)

async function run() {
  await client.connect()
  console.log(`[seed-canon] Connected. Seeding into DB: ${DB}`)

  const db = client.db(DB)

  // ── Intellae ────────────────────────────────────────────────────────────────
  const intellaCol = db.collection('intellae')
  await intellaCol.createIndex({ id: 1 }, { unique: true })

  let intellaSeeded = 0
  for (const intella of CANONICAL_INTELLAE) {
    await intellaCol.updateOne(
      { id: intella.id },
      { $set: { ...intella, natum: intella.natum ?? new Date() } },
      { upsert: true },
    )
    intellaSeeded++
    console.log(`  intella: ${intella.id} (${intella.genus})`)
  }

  // ── Essentiae / Modi ────────────────────────────────────────────────────────
  const modiCol = db.collection('modi')
  await modiCol.createIndex({ id: 1, versio: 1 }, { unique: true })
  const modorum = new MongoModorum(modiCol)

  let modiSeeded = 0
  for (const essentia of CANONICAL_ESSENTIAE) {
    const withHash = { ...essentia, contentHash: hashModus(essentia) }
    await modorum.register(withHash)
    modiSeeded++
    console.log(`  essentia: ${essentia.id}@${essentia.versio}  hash=${withHash.contentHash.slice(0, 12)}…`)
  }

  // Compositus modi (spells) — registered after the atomic essentiae they reference.
  for (const compositus of CANONICAL_COMPOSITI) {
    const withHash = { ...compositus, contentHash: hashModus(compositus) }
    await modorum.register(withHash)
    modiSeeded++
    console.log(`  compositus: ${compositus.id}@${compositus.versio}  hash=${withHash.contentHash.slice(0, 12)}…`)
  }

  console.log(`[seed-canon] Done. intellae=${intellaSeeded} modi=${modiSeeded}`)
}

run()
  .catch(err => { console.error('[seed-canon] Fatal:', err); process.exit(1) })
  .finally(() => client.close())
