import { Collection, MongoClient } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type {
  Signum, Signa, Signorum, Reservatio, Transferatio, SignumForma, SignumStatus,
  EarningTotal, EarningsPage,
} from '../types/significandi.js'
import { transferVia } from '../ledger/transfer.js'
import { RESERVE_CHANGE_AUCTOR } from '../ledger/MemorySignorum.js'
import { EARNING_AUCTOR_IDS } from '../ledger/earnings.js'

function toDoc(s: Partial<Signum>): Record<string, unknown> {
  const { valor, ...rest } = s
  const v = valor !== undefined ? valor : 0n
  // `valor` stays the authoritative bigint, serialized as a string (Mongo can't store bigint).
  // `valorNum` is a lossless numeric sort-mirror written alongside it (ledger-hardening Debt #1):
  // it exists ONLY to let `reserve` do an index-backed server-side `sort({ valorNum: 1 }).limit(k)`
  // instead of loading the whole pool and sorting in JS (string sort is lexicographic — "9" > "10").
  // valor is always impetus-scale (never wei), so Number() is exact well below 2^53 (~$3T of impetus).
  return { ...rest, valor: v.toString(), valorNum: Number(v) }
}

function fromDoc(doc: Record<string, unknown>): Signum {
  // valorNum is an internal sort-mirror — strip it so the domain Signum stays clean (valor is truth).
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _id, valor, valorNum, ...rest } = doc as Record<string, unknown> & { _id: unknown; valor: string; valorNum: unknown }
  return { ...rest, valor: BigInt(valor) } as Signum
}

function identityQuery(by: { animaId: string } | { commitment: string }): Record<string, unknown> {
  if ('animaId' in by) return { animaId: by.animaId }
  return { testis: by.commitment, forma: 'arcanum' }
}

/** Opaque earnings cursor = the (natum, id) of the last row on the previous page. Base64url of
 *  `${iso}|${id}`, enough to resume the deterministic (natum desc, id desc) sort with no dupes
 *  and no skips — the same construction the settled-run cursor uses. */
function encodeEarningCursor(natum: Date, id: string): string {
  return Buffer.from(`${natum.toISOString()}|${id}`, 'utf8').toString('base64url')
}
function decodeEarningCursor(cursor: string): { natum: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const sep = raw.lastIndexOf('|')
    if (sep < 0) return null
    const natum = new Date(raw.slice(0, sep))
    const id = raw.slice(sep + 1)
    if (Number.isNaN(natum.getTime()) || !id) return null
    return { natum, id }
  } catch {
    return null
  }
}

/**
 * Can a note's identity be carried onto a split child? Mirrors `settle`'s refund-identity
 * selection: an arcanum note is identified by its `testis` commitment, an identified note by
 * `animaId`. A note satisfying neither is left locked whole rather than split into children with
 * no owner. Kept in step with MemorySignorum's private `splittable`.
 */
function splittable(doc: Record<string, unknown>): boolean {
  return doc.forma === 'arcanum' ? typeof doc.testis === 'string' : typeof doc.animaId === 'string'
}

/**
 * One half of a split note, as a ready-to-insert doc. Provenance follows `settle`'s delta mint
 * exactly: arcanum keeps `testis`, identified keeps `animaId` + `forma`. The locked half is
 * inserted ALREADY locked to the reservation, so it is never briefly spendable.
 */
function splitChildDoc(
  parent: Record<string, unknown>,
  valor: bigint,
  status: SignumStatus,
  actumId?: string,
): Record<string, unknown> {
  const base = parent.forma === 'arcanum'
    ? { forma: 'arcanum' as SignumForma, valor, auctor: RESERVE_CHANGE_AUCTOR, testis: parent.testis as string }
    : { animaId: parent.animaId as string, forma: parent.forma as SignumForma, valor, auctor: RESERVE_CHANGE_AUCTOR }
  return toDoc({
    ...base,
    id: uuidv4(),
    natum: new Date(),
    status,
    ...(actumId !== undefined ? { actumId } : {}),
  } as Signum)
}

export class MongoSignorum implements Signorum {
  // `client` is required: settle spans two writes that must commit all-or-nothing, so it opens a
  // Mongo transaction (see settle). There is deliberately no client-less fallback — a silent
  // non-atomic settle path is the exact value-loss bug this class is being hardened against.
  constructor(private col: Collection, private client: MongoClient) {}

  async issue(input: Omit<Signum, 'id' | 'natum' | 'status'>): Promise<Signum> {
    if ((input.forma === 'arcanum' || input.forma === 'tessera') && input.animaId !== undefined) {
      throw new Error(`privacy invariant: ${input.forma} forma must not have animaId`)
    }
    const signum: Signum = { ...input, id: uuidv4(), natum: new Date(), status: 'valid' }
    // insertOne surfaces a duplicate-key (E11000) error unswallowed — that is deliberate: the
    // fiat funding rail's unique PARTIAL index on (testis where auctor:'stripe:purchase') makes a
    // concurrent/redelivered Stripe credit collide here, and the credit helper catches the dup-key
    // to replay the original credit instead of double-minting. Do NOT swallow it.
    await this.col.insertOne(toDoc(signum))
    return signum
  }

  async balance(by: { animaId: string } | { commitment: string }): Promise<bigint> {
    const docs = await this.col.find({ ...identityQuery(by), status: 'valid' }).toArray()
    return docs.reduce((sum, d) => sum + BigInt(d.valor as string), 0n)
  }

  async sessionBudget(modoId: string): Promise<bigint> {
    const docs = await this.col.find({ forma: 'tessera', modoId, status: 'valid' }).toArray()
    return docs.reduce((sum, d) => sum + BigInt(d.valor as string), 0n)
  }

  async lock(signaIds: string[], actumId: string): Promise<void> {
    await this.col.updateMany(
      { id: { $in: signaIds }, status: 'valid' },
      { $set: { status: 'locked', actumId } }
    )
  }

  async release(signaIds: string[]): Promise<void> {
    await this.col.updateMany(
      { id: { $in: signaIds }, status: 'locked' },
      { $set: { status: 'valid' }, $unset: { actumId: '' } }
    )
  }

  async reserve(
    by: { animaId: string } | { commitment: string },
    amount: bigint,
    actumId: string,
  ): Promise<Reservatio> {
    if (amount <= 0n) return { ok: true, signaIds: [], locked: 0n }

    const idq = identityQuery(by)
    let lockedIds: string[] = []
    let lockedDocs: Record<string, unknown>[] = []
    let lockedTotal = 0n

    // Bounded retry: each successful grab consumes finite valid signa, so the loop terminates;
    // the cap is a backstop against pathological churn (a competitor stealing every pick).
    const MAX_ATTEMPTS = 64
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const remaining = amount - lockedTotal
      if (remaining <= 0n) break

      // Fresh read of still-valid candidates, smallest-first. Ordering is pushed into Mongo via the
      // `valorNum` sort-mirror (index-backed sort on { ...idq, status:'valid', valorNum:1 }), so we
      // stream candidates in true numeric order instead of full-loading + sorting in JS. Iterating
      // the cursor and breaking once `remaining` is covered pulls only the ~k coins actually needed
      // (k tiny + bounded), turning the old O(n)-in-pool-size read into ~O(k). Same greedy smallest-
      // first SELECTION as before — just server-side ordering + early termination.
      // `valorNum: { $gt: 0 }` — only strictly-positive valor is spendable. The ledger holds
      // negative-valor debit signa (nexus:studioSpend / tee:spend / publish:scanFee mint
      // `valor: -impetus, status:'valid'` rows that balance() correctly NETS); those are
      // liabilities, never spend candidates — locking one into a reservation would corrupt the
      // cover arithmetic. The filter is on the numeric sort-mirror `valorNum` (the field this
      // selection actually reads/sorts on), NOT the string `valor`, so it stays a range on the
      // same { animaId, status, valorNum } index — no blocking sort, no collscan.
      const cursor = this.col
        .find({ ...idq, status: 'valid', valorNum: { $gt: 0 } })
        .sort({ valorNum: 1 })

      const pick: string[] = []
      let pickSum = 0n
      try {
        for await (const d of cursor) {
          if (pickSum >= remaining) break
          pick.push(d.id as string)
          pickSum += BigInt(d.valor as string)
        }
      } finally {
        await cursor.close()
      }
      if (pick.length === 0) break   // nothing valid left to grab → uncoverable

      // Guarded atomic lock — only currently-valid docs flip. Two concurrent reservers racing
      // for the same signum: Mongo applies the per-document writes serially, so exactly one wins
      // (the loser's `status:'valid'` predicate no longer matches). Overdraw is impossible.
      await this.col.updateMany(
        { id: { $in: pick }, status: 'valid' },
        { $set: { status: 'locked', actumId } },
      )

      // Re-read everything we now own under this actumId (may be fewer than `pick` if contended).
      const won = await this.col.find({ actumId, status: 'locked' }).toArray()
      lockedDocs = won as unknown as Record<string, unknown>[]
      lockedIds = won.map(d => d.id as string)
      lockedTotal = won.reduce((sum, d) => sum + BigInt(d.valor as string), 0n)
    }

    if (lockedTotal < amount) {
      // Fail closed: release everything this call locked; report what was coverable.
      if (lockedIds.length > 0) {
        await this.col.updateMany(
          { id: { $in: lockedIds }, status: 'locked', actumId },
          { $set: { status: 'valid' }, $unset: { actumId: '' } },
        )
      }
      return { ok: false, available: lockedTotal }
    }

    // ── change at reserve time (contract documented on MemorySignorum.reserve) ──
    // Walk the notes this call locked, smallest-first: those fully consumed by the cover stay
    // locked whole; the one that pushes coverage past `amount` is split into a locked child for
    // the exact shortfall and a spendable child for the remainder, and is itself consumed into
    // the ledger's terminal status. `lockedDocs` is the re-read the loop already performed, so
    // this costs no extra round trip. The re-read is unordered — order is imposed here.
    const ascending = [...lockedDocs].sort((a, b) => {
      const av = BigInt(a.valor as string)
      const bv = BigInt(b.valor as string)
      return av < bv ? -1 : av > bv ? 1 : 0
    })

    const keepIds: string[] = []
    const excessIds: string[] = []
    let parent: Record<string, unknown> | null = null
    let shortfall = 0n
    let running = 0n
    for (const d of ascending) {
      const valor = BigInt(d.valor as string)
      if (running >= amount) {
        // Contention can leave this call holding a note the final cover no longer needs
        // (an earlier pick was stolen, a later fresh pick over-covered). Return it to spendable.
        excessIds.push(d.id as string)
        continue
      }
      const need = amount - running
      if (need >= valor || !splittable(d)) {
        keepIds.push(d.id as string)
        running += valor
        continue
      }
      parent = d
      shortfall = need
      running += need
    }

    if (!parent && excessIds.length === 0) {
      return { ok: true, signaIds: lockedIds, locked: lockedTotal }   // exact cover — nothing to split
    }

    // Both children are constructed — ids included — OUTSIDE the transaction, the same
    // idempotency discipline `settle` uses for its overshoot refund: a transient retry re-runs
    // against a rolled-back attempt and re-inserts the SAME ids, never a second pair.
    const childDocs: Record<string, unknown>[] = []
    let lockedChildId: string | null = null
    if (parent) {
      const parentValor = BigInt(parent.valor as string)
      const lockedChild = splitChildDoc(parent, shortfall, 'locked', actumId)
      childDocs.push(lockedChild, splitChildDoc(parent, parentValor - shortfall, 'valid'))
      lockedChildId = lockedChild.id as string
    }

    // Atomicity, exactly as in `settle`: mint the children, consume the parent, and drop any
    // excess in ONE transaction. Children-first ordering plus all-or-nothing commit means no
    // crash point can leave value minted without its parent consumed, or a parent consumed
    // without its children — the two windows this split would otherwise open.
    const session = this.client.startSession()
    try {
      await session.withTransaction(async () => {
        if (childDocs.length > 0) {
          await this.col.insertMany(childDocs, { session })
        }
        if (parent) {
          const consumed = await this.col.updateOne(
            { id: parent.id as string, status: 'locked', actumId },
            { $set: { status: 'spent', expensum: new Date(), actumId } },
            { session },
          )
          // The parent must still be the locked note this reservation selected. Anything else
          // means the ledger moved underneath us — abort rather than mint against it.
          if (consumed.matchedCount !== 1) throw new Error('split parent is no longer locked by this reservation')
        }
        if (excessIds.length > 0) {
          await this.col.updateMany(
            { id: { $in: excessIds }, status: 'locked', actumId },
            { $set: { status: 'valid' }, $unset: { actumId: '' } },
            { session },
          )
        }
      })
    } catch {
      // The split is all-or-nothing, so an abort leaves precisely the reservation the pre-split
      // path would have produced: whole notes locked, `locked >= amount`, no orphan children.
      // Return that rather than throwing — the notes are already locked under this actumId, and a
      // throw would strand them with no ids for the caller to release or settle.
      //
      // Re-read what this actum still holds instead of trusting the pre-split view: a commit
      // whose outcome the driver could not confirm may in fact have landed, and stale ids would
      // leave a locked child with no id to release or settle. Whatever survives either still
      // covers the ceiling, or it fails closed exactly like any other shortfall.
      const held = await this.col.find({ actumId, status: 'locked' }).toArray()
      const heldIds = held.map(d => d.id as string)
      const heldTotal = held.reduce((sum, d) => sum + BigInt(d.valor as string), 0n)
      if (heldTotal >= amount) return { ok: true, signaIds: heldIds, locked: heldTotal }
      if (heldIds.length > 0) {
        await this.col.updateMany(
          { id: { $in: heldIds }, status: 'locked', actumId },
          { $set: { status: 'valid' }, $unset: { actumId: '' } },
        )
      }
      return { ok: false, available: heldTotal }
    } finally {
      await session.endSession()
    }

    return { ok: true, signaIds: lockedChildId ? [...keepIds, lockedChildId] : keepIds, locked: running }
  }

  transfer(
    from: { animaId: string } | { commitment: string },
    to: { animaId: string },
    amount: bigint,
    opts?: { auctor?: string; forma?: SignumForma; testis?: string; contextId?: string },
  ): Promise<Transferatio> {
    return transferVia(this, from, to, amount, opts)
  }

  async history(by: { animaId: string } | { commitment: string }): Promise<Signa> {
    const docs = await this.col.find(identityQuery(by)).toArray()
    return docs.map(d => fromDoc(d as Record<string, unknown>))
  }

  /** Grouped in the DATABASE, not over a loaded history: one `$group` per auctor across the
   *  identity's earning rows. `valor` is stored as a string, so the sum runs through
   *  `$toDecimal` (exact past 2^53) and comes back as an integer string to revive as a bigint. */
  async earningTotals(by: { animaId: string } | { commitment: string }): Promise<EarningTotal[]> {
    const rows = await this.col
      .aggregate([
        { $match: { ...identityQuery(by), auctor: { $in: [...EARNING_AUCTOR_IDS] } } },
        { $group: { _id: '$auctor', total: { $sum: { $toDecimal: '$valor' } }, count: { $sum: 1 } } },
      ])
      .toArray()
    return rows.map(r => ({
      auctor: String(r._id),
      impetus: BigInt(String(r.total).split('.')[0] ?? '0'),
      count: Number(r.count ?? 0),
    }))
  }

  async listEarnings(
    by: { animaId: string } | { commitment: string },
    opts: { limit: number; cursor?: string },
  ): Promise<EarningsPage> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit) || 0, 1), 100)
    const filter: Record<string, unknown> = {
      ...identityQuery(by),
      auctor: { $in: [...EARNING_AUCTOR_IDS] },
    }
    if (opts.cursor) {
      const c = decodeEarningCursor(opts.cursor)
      // Rows strictly after the cursor in (natum desc, id desc) order.
      if (c) filter.$or = [{ natum: { $lt: c.natum } }, { natum: c.natum, id: { $lt: c.id } }]
    }

    // One extra row tells us whether another page exists without a second count query.
    const docs = await this.col.find(filter).sort({ natum: -1, id: -1 }).limit(limit + 1).toArray()
    const hasMore = docs.length > limit
    const entries = (hasMore ? docs.slice(0, limit) : docs).map(d => fromDoc(d as Record<string, unknown>))

    const last = entries[entries.length - 1]
    const nextCursor = hasMore && last ? encodeEarningCursor(new Date(last.natum), last.id) : undefined
    return { entries, ...(nextCursor ? { nextCursor } : {}) }
  }

  async findByTestis(testis: string): Promise<Signum | null> {
    // Scoped to auctor:'stripe:purchase' so the query rides the unique PARTIAL index on
    // { testis } (partialFilterExpression auctor:'stripe:purchase', ensureIndexes.ts) — a partial
    // index is only chosen when the query carries its filter predicate. `testis` is globally unique
    // within that scope (the Stripe payment_intent id), so findOne returns the single credit or null.
    const doc = await this.col.findOne({ auctor: 'stripe:purchase', testis })
    return doc ? fromDoc(doc as Record<string, unknown>) : null
  }

  async ownsAny(by: { animaId: string } | { commitment: string }, signumIds: string[]): Promise<boolean> {
    if (signumIds.length === 0) return false
    const doc = await this.col.findOne({ id: { $in: signumIds }, ...identityQuery(by) }, { projection: { _id: 1 } })
    return doc !== null
  }

  async createMany(signa: Array<Omit<Signum, 'id' | 'natum' | 'status'>>): Promise<Signum[]> {
    if (signa.length === 0) return []
    const now = new Date()
    const records: Signum[] = signa.map(s => ({ ...s, id: uuidv4(), natum: now, status: 'valid' as const }))
    await this.col.insertMany(records.map(toDoc))
    return records
  }

  async settle(signaIds: string[], actualImpetus: bigint, actumId: string): Promise<void> {
    const docs = await this.col.find({ id: { $in: signaIds } }).toArray()

    // Parity with MemorySignorum: every provided signum must be currently locked. This closes
    // the over-settle / double-refund surface (settling a 'valid' or already-'spent' signum).
    const byId = new Map(docs.map(d => [d.id as string, d]))
    for (const id of signaIds) {
      const d = byId.get(id)
      if (!d) throw new Error(`Signum '${id}' not found`)
      if (d.status === 'spent') throw new Error(`Signum '${id}' is already spent`)
      if (d.status !== 'locked') throw new Error(`Signum '${id}' must be locked before settle (status: ${d.status})`)
    }

    const total = docs.reduce((sum, d) => sum + BigInt(d.valor as string), 0n)
    if (actualImpetus > total) {
      throw new Error(`Cursor overcharge: actual impetus ${actualImpetus} exceeds locked total ${total}`)
    }

    const expensum = new Date()
    const delta = total - actualImpetus

    // Build the overshoot-refund signum up front (identity/forma selection mirrors
    // MemorySignorum.settle). Constructing it — id included — OUTSIDE the transaction keeps the
    // withTransaction callback idempotent: a transient retry re-runs against a rolled-back attempt
    // (nothing persisted), so it re-inserts the SAME id, never a second refund.
    let refundDoc: Record<string, unknown> | null = null
    if (delta > 0n && docs.length > 0) {
      const first = docs[0] as Record<string, unknown>
      let refund: Omit<Signum, 'id' | 'natum' | 'status'> | null = null
      if (first.forma === 'arcanum' && first.testis) {
        refund = { forma: 'arcanum', valor: delta, auctor: 'settle:delta', testis: first.testis as string }
      } else if (first.animaId) {
        refund = { forma: first.forma as SignumForma, valor: delta, auctor: 'settle:delta', animaId: first.animaId as string }
      }
      if (refund) {
        refundDoc = toDoc({ ...refund, id: uuidv4(), natum: new Date(), status: 'valid' } as Signum)
      }
    }

    // Atomicity (ledger Debt #2): the spend and the overshoot-refund must commit all-or-nothing.
    // Left as two separate writes, a crash between them spends `total` yet never issues the refund —
    // the identity loses `amount + overshoot`. A single-identity Mongo transaction makes a crash/abort
    // roll the spend back so the signa stay `locked` (recoverable), never half-applied. MemorySignorum
    // is single-threaded/synchronous → already atomic, so it needs no equivalent.
    const session = this.client.startSession()
    try {
      await session.withTransaction(async () => {
        await this.col.updateMany(
          { id: { $in: signaIds }, status: 'locked' },
          { $set: { status: 'spent', expensum, actumId } },
          { session },
        )
        if (refundDoc) {
          await this.col.insertOne(refundDoc, { session })
        }
      })
    } finally {
      await session.endSession()
    }
  }
}
