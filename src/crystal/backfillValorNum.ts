import type { Collection } from 'mongodb'

/**
 * One-shot backfill of the `valorNum` numeric sort-mirror onto legacy signa (ledger-hardening
 * Debt #1). `MongoSignorum.reserve` now selects smallest-first via `.sort({ valorNum: 1 })`, but
 * any signum written before this field existed (earlier prod/staging writes, direct-insert seeds)
 * has NO valorNum. In an ascending Mongo sort a MISSING field ranks as `null`, BELOW every number —
 * so a legacy coin would sort first and be picked ahead of genuinely-smaller coins, silently
 * regressing selection (a large legacy coin gets split instead of a small one being taken whole).
 *
 * A partial index / `$exists` filter does NOT fix this: it would hide the legacy coin from the
 * query entirely, which can make an otherwise-coverable reserve under-cover. The only correct fix
 * is to stamp valorNum on every pre-existing doc, so no valid signum reaches reserve without it.
 *
 * `valorNum = Number(BigInt(valor))` reproduces exactly what `toDoc` writes for new signa: valor is
 * the authoritative bigint serialized as a string, always impetus-scale (well under 2^53), so the
 * Number() mirror is lossless. Idempotent: only touches docs missing valorNum unless `force`.
 */
export interface BackfillValorNumResult {
  /** Docs matched (missing valorNum, or all when `force`). */
  scanned: number
  /** Docs stamped with valorNum (0 when `dryRun`). */
  updated: number
}

export async function backfillValorNum(
  col: Collection,
  opts: { force?: boolean; dryRun?: boolean } = {},
): Promise<BackfillValorNumResult> {
  // Default: only legacy docs missing the mirror. `force` re-derives every doc (e.g. after a
  // serialization fix) — safe because the derivation is a pure function of the authoritative valor.
  const query = opts.force ? {} : { valorNum: { $exists: false } }
  const cursor = col.find(query, { projection: { _id: 1, valor: 1 } })

  let scanned = 0
  let updated = 0
  for await (const doc of cursor) {
    scanned++
    // valor is the source of truth (bigint-as-string). Mirror toDoc's `Number(v)` exactly; a
    // missing/empty valor defaults to 0 (matches toDoc's `valor ?? 0n` fallback).
    const raw = doc.valor as string | number | undefined
    const valorNum = Number(BigInt(raw === undefined || raw === '' ? 0 : raw))
    if (!opts.dryRun) {
      await col.updateOne({ _id: doc._id }, { $set: { valorNum } })
      updated++
    }
  }

  return { scanned, updated }
}
