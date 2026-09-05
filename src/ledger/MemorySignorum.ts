import { randomUUID } from 'node:crypto'
import type {
  Signum, Signa, Signorum, Reservatio, Transferatio, SignumForma, SignumStatus,
  EarningTotal, EarningsPage,
} from '../types/significandi.js'
import { transferVia } from './transfer.js'
import { EARNING_AUCTORS } from './earnings.js'

/**
 * Auctor stamped on BOTH halves of a note split at reserve time — the register that names the
 * operation, mirroring `settle:delta` on the overshoot refund. MongoSignorum uses the same value.
 */
export const RESERVE_CHANGE_AUCTOR = 'reserve:change'

/** The `${iso}|${id}` earnings cursor, read back. Mirrors MongoSignorum's decoder. */
function decodeMemoryCursor(cursor: string): { natum: Date; id: string } | null {
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

export class MemorySignorum implements Signorum {
  private readonly store = new Map<string, Signum>()

  async issue(signum: Omit<Signum, 'id' | 'natum' | 'status'>): Promise<Signum> {
    if ((signum.forma === 'arcanum' || signum.forma === 'tessera') && signum.animaId !== undefined) {
      throw new Error(`Privacy partition violation: ${signum.forma} signum must not have animaId`)
    }
    if ((signum.forma === 'arcanum' || signum.forma === 'tessera') && signum.commitment !== undefined) {
      throw new Error(`One-way link violation: ${signum.forma} signum must not have commitment — it is the anonymous end, not the deposit end`)
    }
    const record: Signum = {
      ...signum,
      id: randomUUID(),
      natum: new Date(),
      status: 'valid',
    }
    this.store.set(record.id, record)
    return record
  }

  async balance(by: { animaId: string } | { commitment: string }): Promise<bigint> {
    return this.forIdentity(by)
      .filter(s => s.status === 'valid')
      .reduce((sum, s) => sum + s.valor, 0n)
  }

  async history(by: { animaId: string } | { commitment: string }): Promise<Signa> {
    return this.forIdentity(by)
  }

  /** Memory parity for the Mongo `$group`: the single-writer Map has no index, so the scan
   *  IS the aggregation (as `history()` is the listing). Same allowlist, same all-status rule. */
  async earningTotals(by: { animaId: string } | { commitment: string }): Promise<EarningTotal[]> {
    const totals = new Map<string, EarningTotal>()
    for (const s of this.earningsFor(by)) {
      const t = totals.get(s.auctor) ?? { auctor: s.auctor, impetus: 0n, count: 0 }
      totals.set(s.auctor, { auctor: s.auctor, impetus: t.impetus + s.valor, count: t.count + 1 })
    }
    return Array.from(totals.values())
  }

  async listEarnings(
    by: { animaId: string } | { commitment: string },
    opts: { limit: number; cursor?: string },
  ): Promise<EarningsPage> {
    const limit = Math.min(Math.max(Math.trunc(opts.limit) || 0, 1), 100)
    // (natum desc, id desc) — the same deterministic order the Mongo cursor resumes.
    const sorted = this.earningsFor(by).sort((a, b) =>
      b.natum.getTime() - a.natum.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))

    let rest = sorted
    if (opts.cursor) {
      const c = decodeMemoryCursor(opts.cursor)
      if (c) rest = sorted.filter(s => s.natum.getTime() < c.natum.getTime()
        || (s.natum.getTime() === c.natum.getTime() && s.id < c.id))
    }

    const entries = rest.slice(0, limit)
    const last = entries[entries.length - 1]
    const nextCursor = rest.length > limit && last
      ? Buffer.from(`${last.natum.toISOString()}|${last.id}`, 'utf8').toString('base64url')
      : undefined
    return { entries, ...(nextCursor ? { nextCursor } : {}) }
  }

  async findByTestis(testis: string): Promise<Signum | null> {
    // Memory parity for the Mongo unique-partial lookup: scan for the stripe:purchase credit stamped
    // with this testis. The single-writer Map has no index, so this linear scan IS the lookup (as
    // history() is). testis is unique within the stripe:purchase scope (the payment_intent id).
    for (const s of this.store.values()) {
      if (s.auctor === 'stripe:purchase' && s.testis === testis) return s
    }
    return null
  }

  async sessionBudget(modoId: string): Promise<bigint> {
    return Array.from(this.store.values())
      .filter(s => s.forma === 'tessera' && s.modoId === modoId && s.status === 'valid')
      .reduce((sum, s) => sum + s.valor, 0n)
  }

  async ownsAny(by: { animaId: string } | { commitment: string }, signumIds: string[]): Promise<boolean> {
    if (signumIds.length === 0) return false
    const ids = new Set(signumIds)
    return this.forIdentity(by).some(s => ids.has(s.id))
  }

  async lock(signaIds: string[], actumId: string): Promise<void> {
    // Validate all exist before mutating any (atomicity)
    for (const id of signaIds) {
      if (!this.store.has(id)) throw new Error(`Signum '${id}' not found`)
    }
    for (const id of signaIds) {
      const s = this.store.get(id)!
      this.store.set(id, { ...s, status: 'locked', actumId })
    }
  }

  async reserve(
    by: { animaId: string } | { commitment: string },
    amount: bigint,
    actumId: string,
  ): Promise<Reservatio> {
    if (amount <= 0n) return { ok: true, signaIds: [], locked: 0n }

    // Greedy, smallest-first — matches the historical selection order in ActumInceptor.
    // Only strictly-positive valor is spendable: the ledger holds negative-valor debit signa
    // (e.g. nexus:studioSpend / tee:spend / publish:scanFee mint `valor: -impetus, status:'valid'`
    // rows that balance() correctly NETS). Those are liabilities, never spend candidates — locking
    // one into a reservation and feeding it to settle() would corrupt the cover arithmetic. Zero
    // carries no value, so exclude it too (valor <= 0n).
    const candidates = this.forIdentity(by)
      .filter(s => s.status === 'valid' && s.valor > 0n)
      .sort((a, b) => (a.valor < b.valor ? -1 : 1))

    const selected: string[] = []
    let covered = 0n
    for (const s of candidates) {
      if (covered >= amount) break
      // Guarded per-signum lock: only a still-valid signum can be taken (single-writer here,
      // but the check mirrors the Mongo atomic-write contract so the two impls stay in step).
      const cur = this.store.get(s.id)
      if (!cur || cur.status !== 'valid') continue
      this.store.set(s.id, { ...cur, status: 'locked', actumId })
      selected.push(s.id)
      covered += cur.valor
    }

    if (covered < amount) {
      // Fail closed: release everything this call locked, report what was coverable.
      for (const id of selected) {
        const s = this.store.get(id)
        if (s && s.status === 'locked' && s.actumId === actumId) {
          this.store.set(id, { ...s, status: 'valid', actumId: undefined })
        }
      }
      return { ok: false, available: covered }
    }

    // ── change at reserve time ────────────────────────────────────────────────
    // A reservation holds exactly `amount`, never a whole note that happens to be larger.
    // Walk the notes this call locked, smallest-first: those fully consumed by the cover stay
    // locked whole; the one that pushes coverage past `amount` is SPLIT — consumed into the
    // ledger's terminal status ('spent', the same terminal write `settle` performs) and replaced
    // by two fresh mints, one locked into this reservation for the exact shortfall and one
    // immediately spendable for the remainder. No valor is ever mutated in place, so the ledger
    // stays append-only: the parent's face value is exactly the sum of its two children.
    const ascending = selected
      .map(id => this.store.get(id)!)
      .sort((a, b) => (a.valor < b.valor ? -1 : a.valor > b.valor ? 1 : 0))

    const signaIds: string[] = []
    let running = 0n
    for (const s of ascending) {
      if (running >= amount) {
        // The cover no longer needs this note — return it to spendable rather than hold it.
        this.store.set(s.id, { ...s, status: 'valid', actumId: undefined })
        continue
      }
      const shortfall = amount - running
      if (shortfall >= s.valor) {          // fully consumed by the cover — stays locked whole
        signaIds.push(s.id)
        running += s.valor
        continue
      }
      if (!this.splittable(s)) {           // provenance cannot be carried — leave it locked whole
        signaIds.push(s.id)
        running += s.valor
        continue
      }
      const lockedChild = this.mintSplitChild(s, shortfall, 'locked', actumId)
      this.mintSplitChild(s, s.valor - shortfall, 'valid')
      this.store.set(s.id, { ...s, status: 'spent', actumId, expensum: new Date() })
      signaIds.push(lockedChild.id)
      running += shortfall
    }

    return { ok: true, signaIds, locked: running }
  }

  /**
   * Can a note's identity be carried onto a split child? Mirrors `settle`'s refund-identity
   * selection: an arcanum note is identified by its `testis` commitment, an identified note by
   * `animaId`. Selection already guarantees one of the two holds; a note that satisfies neither
   * is left locked whole rather than split into children with no owner.
   */
  private splittable(s: Signum): boolean {
    return s.forma === 'arcanum' ? typeof s.testis === 'string' : typeof s.animaId === 'string'
  }

  /**
   * Mint one half of a split note. Synchronous by design (no `await` between the two children and
   * the parent's consumption) so a concurrent caller can never observe a locked child as
   * spendable, nor a parent consumed without its children present. Provenance follows `settle`'s
   * delta mint exactly: arcanum keeps `testis`, identified keeps `animaId` + `forma`. The privacy
   * invariants `issue()` enforces hold by construction — the parent already passed them.
   */
  private mintSplitChild(parent: Signum, valor: bigint, status: SignumStatus, actumId?: string): Signum {
    const base = parent.forma === 'arcanum'
      ? { forma: 'arcanum' as SignumForma, valor, auctor: RESERVE_CHANGE_AUCTOR, testis: parent.testis }
      : { animaId: parent.animaId, forma: parent.forma, valor, auctor: RESERVE_CHANGE_AUCTOR }
    const child: Signum = {
      ...base,
      id: randomUUID(),
      natum: new Date(),
      status,
      ...(actumId !== undefined ? { actumId } : {}),
    }
    this.store.set(child.id, child)
    return child
  }

  transfer(
    from: { animaId: string } | { commitment: string },
    to: { animaId: string },
    amount: bigint,
    opts?: { auctor?: string; forma?: SignumForma; testis?: string; contextId?: string },
  ): Promise<Transferatio> {
    return transferVia(this, from, to, amount, opts)
  }

  async release(signaIds: string[]): Promise<void> {
    for (const id of signaIds) {
      const s = this.store.get(id)
      if (!s || s.status !== 'locked') continue  // no-op if spent or missing
      this.store.set(id, { ...s, status: 'valid', actumId: undefined })
    }
  }

  async createMany(signa: Array<Omit<Signum, 'id' | 'natum' | 'status'>>): Promise<Signum[]> {
    return Promise.all(signa.map(s => this.issue(s)))
  }

  async settle(signaIds: string[], actualImpetus: bigint, actumId: string): Promise<void> {
    const signa = signaIds.map(id => {
      const s = this.store.get(id)
      if (!s) throw new Error(`Signum '${id}' not found`)
      if (s.status === 'spent') throw new Error(`Signum '${id}' is already spent`)
      if (s.status !== 'locked') throw new Error(`Signum '${id}' must be locked before settle (status: ${s.status})`)
      return s
    })

    const totalLocked = signa.reduce((sum, s) => sum + s.valor, 0n)
    if (actualImpetus > totalLocked) {
      throw new Error(`Cursor overcharge: actual impetus ${actualImpetus} exceeds locked total ${totalLocked}`)
    }
    const delta = totalLocked - actualImpetus

    // Spend all locked signa
    const now = new Date()
    for (const s of signa) {
      this.store.set(s.id, { ...s, status: 'spent', actumId, expensum: now })
    }

    // Issue refund signum for the delta — preserves the original identity
    if (delta > 0n) {
      const first = signa[0]
      const refund: Omit<Signum, 'id' | 'natum' | 'status'> = first.forma === 'arcanum'
        ? { forma: 'arcanum', valor: delta, auctor: 'settle:delta', testis: first.testis }
        : { animaId: first.animaId, forma: first.forma, valor: delta, auctor: 'settle:delta' }
      await this.issue(refund)
    }
  }

  /** The identity's rows minted by an earning hook — the allowlist filter both earning
   *  reads share, so the totals and the statement can never disagree on what counts. */
  private earningsFor(by: { animaId: string } | { commitment: string }): Signa {
    return this.forIdentity(by).filter(s => EARNING_AUCTORS[s.auctor] !== undefined)
  }

  private forIdentity(by: { animaId: string } | { commitment: string }): Signa {
    const signa = Array.from(this.store.values())
    if ('animaId' in by) {
      return signa.filter(s => s.animaId === by.animaId)
    }
    // commitment: anonymous signa store their commitment in signum.testis
    return signa.filter(s => s.forma === 'arcanum' && s.testis === by.commitment)
  }
}
