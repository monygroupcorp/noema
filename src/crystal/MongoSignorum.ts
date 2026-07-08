import { Collection } from 'mongodb'
import { v4 as uuidv4 } from 'uuid'
import type { Signum, Signa, Signorum, Reservatio, Transferatio, SignumForma } from '../types/significandi.js'
import { transferVia } from '../ledger/transfer.js'

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

export class MongoSignorum implements Signorum {
  constructor(private col: Collection) {}

  async issue(input: Omit<Signum, 'id' | 'natum' | 'status'>): Promise<Signum> {
    if ((input.forma === 'arcanum' || input.forma === 'tessera') && input.animaId !== undefined) {
      throw new Error(`privacy invariant: ${input.forma} forma must not have animaId`)
    }
    const signum: Signum = { ...input, id: uuidv4(), natum: new Date(), status: 'valid' }
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
      const cursor = this.col
        .find({ ...idq, status: 'valid' })
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

    return { ok: true, signaIds: lockedIds, locked: lockedTotal }
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
    await this.col.updateMany(
      { id: { $in: signaIds }, status: 'locked' },
      { $set: { status: 'spent', expensum, actumId } }
    )

    const delta = total - actualImpetus
    if (delta <= 0n || docs.length === 0) return

    // Refund the unspent delta to the same identity (mirrors MemorySignorum.settle).
    const first = docs[0] as Record<string, unknown>
    if (first.forma === 'arcanum' && first.testis) {
      await this.issue({ forma: 'arcanum', valor: delta, auctor: 'settle:delta', testis: first.testis as string })
    } else if (first.animaId) {
      await this.issue({ forma: first.forma as SignumForma, valor: delta, auctor: 'settle:delta', animaId: first.animaId as string })
    }
  }
}
