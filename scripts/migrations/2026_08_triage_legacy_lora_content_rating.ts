#!/usr/bin/env -S npx tsx
// =============================================================================
// Backfill `Intella.contentRating` 'untriaged' -> 'sfw' on a pinned, reviewed set
// of legacy LoRAs.
// =============================================================================
//
// The model catalog's adult-content partition (noema-091, `CrystalApi.ts` —
// `ADULT_CONTENT_RATINGS`) gates only `{suggestive, explicit}` behind spicyMode;
// `{untriaged, sfw}` (and unrated) stay in the always-visible bucket. Every import
// stamps `contentRating: 'untriaged'` by design (`ModelImporter.ts`), and the
// legacy LoRA migration stamped `'untriaged'` for anything without a clean prior
// review. Nothing has ever triaged them, so `'untriaged'` currently means "the
// legacy tail" rather than "new, unreviewed."
//
// An operator reviewed the full legacy `untriaged` set by name and approved the
// PINNED_APPROVED_IDS below. This script stamps that ruling into the data. It
// does NOT re-derive the set from a live query — a re-query would pick up
// anything imported since the ruling, which has not been reviewed. The ids are
// the input; re-running against a wider set is out of scope for this script.
//
// Per-record decision, applied only to a pinned id:
//   - `contentRating === 'untriaged'`              -> update to 'sfw'
//   - `contentRating === 'sfw'` already             -> no-op (idempotent)
//   - `contentRating` is 'suggestive' or 'explicit' -> SKIP, report (never downgrade
//     a real adult rating — see the same-shaped skip in modelImportResolver reviews)
//   - `canonica: true`                              -> SKIP, report (canonical records
//     author their rating in src/crystal/seeds/, same rule as
//     2026_07_backfill_intella_license.ts)
// An id not in the pinned set is NEVER touched, whatever its rating.
// A pinned id whose record is missing is reported, not a failure (a model can be deleted).
//
// Idempotent: re-running after a successful pass touches nothing (every pinned
// 'untriaged' record is now 'sfw').
//
// SAFETY: the target DB MUST be named explicitly via `--db <name>` (there is NO
// default — `.env` points `MONGODB_URI` at the live cluster). Dev/test work uses
// `noemaplane`; `noemaplane` IS the live app DB and is refused unless you also pass
// `--prod` (a deliberate, eyes-open production migration). `noema` is the
// pre-cutover legacy db and is always refused — see `_dbTarget.ts`.
//
// Run (dev):  ./scripts/run-with-env.sh npx tsx scripts/migrations/2026_08_triage_legacy_lora_content_rating.ts --db noemaplane --dry-run
//   drop --dry-run to write.
// Run (prod): …same… --db noemaplane --prod        (only when intentionally migrating production)

import { MongoClient } from 'mongodb'
import { resolveDbTarget } from './_dbTarget.js'

const TAG = '[triage-legacy-lora-content-rating]'

/** rth's ruling, captured 2026-08-10 from the live catalog. Pinned input — do not
 *  re-derive, do not extend. id -> nomen, for operator audit against the reviewed list. */
export const PINNED_APPROVED_IDS: Readonly<Record<string, string>> = {
  '6840901d0c6e432ada9d08ff': 'diffusioN64-v2-merge',
  '6840901d0c6e432ada9d0900': 'wojak_SDXL',
  '6840901d0c6e432ada9d0901': 'ponydiffusionv6_pepethefrog',
  '6840901d0c6e432ada9d0902': 'vanta-black_contrast_V3.0',
  '6840901d0c6e432ada9d0903': 'CLAYMATE',
  '6840901d0c6e432ada9d0904': 'RW_PS1v1',
  '6840901d0c6e432ada9d0905': 'LOW_POLY_PLAYSTATION_1_STILL',
  '6840901d0c6e432ada9d0906': 'asciiart',
  '6840901d0c6e432ada9d0907': 'ghibli_style',
  '6840901d0c6e432ada9d0908': 'HeavyMetalStyle-000009',
  '6840901d0c6e432ada9d0909': 'y2kmadmix_v0.0.1',
  '6840901d0c6e432ada9d090a': 'Lego_XL_v2.1',
  '6840901d0c6e432ada9d090b': 'MOGGLES_MOGCAT_PIT_VIPERS',
  '6840901d0c6e432ada9d090c': 'joycatv2',
  '6840901d0c6e432ada9d090d': 'mewing1',
  '6840901d0c6e432ada9d090e': '13angel332',
  '6840901d0c6e432ada9d090f': 'petravoice3',
  '6840901d0c6e432ada9d0910': 'remilia',
  '6840901d0c6e432ada9d0911': 'XL_Weapon_Dual_Pistols',
  '6840901d0c6e432ada9d0913': 'supersaiyanauraXL3',
  '6840901d0c6e432ada9d0914': 'single_thumbs_up',
  '6840901d0c6e432ada9d0915': 'sdxl_wojakpoint_v14',
  '6840901d0c6e432ada9d0916': 'pk_trainer_xl_v1',
  '6840901d0c6e432ada9d0917': 'PE_CourtRoomSketchV2',
  '6840901d0c6e432ada9d0918': 'felted_doll',
  '6840901d0c6e432ada9d0919': 'oidrater',
  '6840901d0c6e432ada9d091a': 'MinionStyle',
  '6840901d0c6e432ada9d091b': 'frieren-10',
  '6840901d0c6e432ada9d091c': 'dark_magician_girl',
  '6840901d0c6e432ada9d091d': 'ohisee',
  '6840901d0c6e432ada9d091e': 'hellkitt',
  '6840901d0c6e432ada9d091f': 'cultkat9',
  '6840901d0c6e432ada9d0920': 'cigawrette',
  '6840901d0c6e432ada9d0921': 'minote',
  '6840901d0c6e432ada9d0922': 'whitehearts',
  '6840901d0c6e432ada9d0923': 'longcat',
  '6840901d0c6e432ada9d0924': 'psyduck',
  '6840901d0c6e432ada9d0925': 'animalcrossinggc',
  '6840901d0c6e432ada9d0926': 'chudjak2',
  '6840901d0c6e432ada9d0927': 'kemonokaki5',
  '6840901d0c6e432ada9d0928': 'meerkat',
  '6840901d0c6e432ada9d0929': 'munyun',
  '6840901d0c6e432ada9d092c': 'mactonight',
  '6840901d0c6e432ada9d092d': 'Xiaohongshu',
  '6840901d0c6e432ada9d0930': 'mimanynft',
  '6840901d0c6e432ada9d0931': 'cobson',
  '6840901d0c6e432ada9d0932': 'fionaogre',
  '6840901d0c6e432ada9d0933': 'Princess_Fiona_PonyXL',
  '6840901d0c6e432ada9d0934': 'ansem',
  '6840901d0c6e432ada9d0935': 'smolting',
  '6840901d0c6e432ada9d0936': 'yakub2',
  '6840901d0c6e432ada9d0937': 'miladystation3',
  '6840901d0c6e432ada9d0938': 'MJ52_v2.0',
  '6982b31970d53071940c2226': 'N64_Game_Style_F1D',
  '6982b31970d53071940c2227': 'Textimprover-FLUX-V0.4',
  '6982b31970d53071940c2228': 'P5Xflux',
  '6982b31970d53071940c2229': 'ThisUserflux',
  '6982b31a70d53071940c222a': 'NEKOflux',
  '6982b31a70d53071940c222b': 'MetalMouthflux',
}

export type TriageDecision =
  | { action: 'update' }
  | { action: 'noop-already-sfw' }
  | { action: 'skip-adult-rated'; rating: string }
  | { action: 'skip-canonical' }
  | { action: 'skip-not-pinned' }

/** Pure decision function: given an id and the fields the record carries, decide
 *  what (if anything) to do. No I/O — the hermetic test exercises this directly. */
export function decideTriage(
  id: string,
  record: { contentRating?: string; canonica?: boolean },
): TriageDecision {
  if (!(id in PINNED_APPROVED_IDS)) return { action: 'skip-not-pinned' }
  if (record.canonica === true) return { action: 'skip-canonical' }
  if (record.contentRating === 'suggestive' || record.contentRating === 'explicit') {
    return { action: 'skip-adult-rated', rating: record.contentRating }
  }
  if (record.contentRating === 'sfw') return { action: 'noop-already-sfw' }
  return { action: 'update' }
}

async function main(): Promise<void> {
  const uri = process.env.MONGO_PASS ?? process.env.MONGODB_URI ?? 'mongodb://localhost:27017'
  const { db: dbName, dryRun: DRY_RUN } = resolveDbTarget(process.argv, TAG)
  const client = await MongoClient.connect(uri)
  try {
    const col = client.db(dbName).collection('intellae')

    const updated: string[] = []
    const alreadySfw: string[] = []
    const skippedCanonical: string[] = []
    const skippedAdult: string[] = []
    const missing: string[] = []

    for (const [id, nomen] of Object.entries(PINNED_APPROVED_IDS)) {
      const doc = await col.findOne({ id })
      if (!doc) {
        missing.push(id)
        console.log(`${TAG}   MISSING ${id} (${nomen})`)
        continue
      }
      const decision = decideTriage(id, { contentRating: doc.contentRating, canonica: doc.canonica })
      switch (decision.action) {
        case 'update':
          updated.push(id)
          console.log(`${TAG}   UPDATE  ${id} (${nomen}) untriaged -> sfw${DRY_RUN ? ' [dry-run]' : ''}`)
          if (!DRY_RUN) await col.updateOne({ _id: doc._id }, { $set: { contentRating: 'sfw' } })
          break
        case 'noop-already-sfw':
          alreadySfw.push(id)
          console.log(`${TAG}   ALREADY-SFW ${id} (${nomen})`)
          break
        case 'skip-canonical':
          skippedCanonical.push(id)
          console.log(`${TAG}   SKIP-CANONICAL ${id} (${nomen}) — rated in src/crystal/seeds/, not swept`)
          break
        case 'skip-adult-rated':
          skippedAdult.push(id)
          console.log(`${TAG}   SKIP-ADULT-RATED ${id} (${nomen}) rating='${decision.rating}' — never downgraded`)
          break
        case 'skip-not-pinned':
          // Unreachable in this loop (we only iterate the pinned set) — kept for
          // decideTriage's completeness and the hermetic test's coverage.
          break
      }
    }

    console.log(
      `${TAG} done — updated=${updated.length} already-sfw=${alreadySfw.length} ` +
      `skipped-canonical=${skippedCanonical.length} skipped-adult-rated=${skippedAdult.length} ` +
      `missing=${missing.length}${DRY_RUN ? ' [dry-run, no writes]' : ''}`,
    )
  } finally {
    await client.close()
  }
}

// Guarded so the hermetic test can import PINNED_APPROVED_IDS/decideTriage without
// this script dialing Mongo — main() only runs when the file is executed directly.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(`${TAG} failed:`, err); process.exit(1) })
}
