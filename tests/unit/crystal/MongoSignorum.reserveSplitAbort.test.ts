import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MongoSignorum } from '../../../src/crystal/MongoSignorum.js'
import { bus } from '../../../src/lib/bus.js'
import type { LogEntry } from '../../../src/lib/logger.js'

// ─────────────────────────────────────────────────────────────────────────────
// reserve-split-silent-overlock
//
// `reserve`'s change-at-reserve-time step splits the one oversized note that pushes
// coverage past `amount`, so a small request only locks a small amount. If that split's
// transaction aborts, the catch-fallback re-reads what this actum still holds and, when it
// already covers `amount`, returns it as-is — which on a lopsided pool (many small notes,
// one big one) means the fallback is every note the greedy pick touched: the identity's
// ENTIRE balance, locked against a tiny request, with nothing written anywhere to say so.
//
// This test reproduces exactly that shape — three notes (100, 200, 47780) against a 900
// request, same ratio as the production incident (900cr request, 47780 note, 48041 total
// balance) — and forces the split transaction to abort. It asserts the fallback is no longer
// silent: an error/warn log fires carrying actumId, animaId, the requested amount and the
// over-locked total, so the over-lock is detectable without a raw Mongo read.
//
// PRE-FIX: the catch block returns `{ ok: true, locked: 48080n }` with zero log lines —
// this test's log-capture assertion FAILS (no entry).
// POST-FIX: the same return value is preceded by a `log.error` carrying the diagnostic
// fields — the assertion PASSES.
// ─────────────────────────────────────────────────────────────────────────────

type FakeDoc = Record<string, unknown>

function matchesFilter(doc: FakeDoc, filter: Record<string, unknown>): boolean {
  for (const [key, cond] of Object.entries(filter)) {
    const val = doc[key]
    if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>
      if ('$in' in c) { if (!(c.$in as unknown[]).includes(val)) return false; continue }
      if ('$gt' in c) { if (!(typeof val === 'number' && val > (c.$gt as number))) return false; continue }
      continue
    }
    if (val !== cond) return false
  }
  return true
}

function applyUpdate(doc: FakeDoc, update: { $set?: FakeDoc; $unset?: Record<string, unknown> }): void {
  if (update.$set) Object.assign(doc, update.$set)
  if (update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k]
}

/** Minimal in-memory stand-in for the Mongo Collection + MongoClient surface `reserve` uses —
 *  no live DB, no network. `withTransaction` stages writes made with `{ session }` onto a
 *  clone and only commits the clone back if the callback resolves, mirroring a real abort's
 *  all-or-nothing rollback closely enough to exercise reserve's catch-fallback path. */
function makeFakeMongo(seed: FakeDoc[]) {
  let docs = seed.map(d => ({ ...d }))
  let staging: FakeDoc[] | null = null
  let throwOnNextUpdateOne: string | null = null

  const col = {
    find(filter: Record<string, unknown>) {
      let arr = docs.filter(d => matchesFilter(d, filter))
      const cursor = {
        sort(spec: Record<string, 1 | -1>) {
          const [[key, dir]] = Object.entries(spec)
          arr = [...arr].sort((a, b) => ((a[key] as number) - (b[key] as number)) * dir)
          return cursor
        },
        toArray: async () => arr,
        close: async () => {},
        [Symbol.asyncIterator]: async function* () { for (const d of arr) yield d },
      }
      return cursor
    },
    updateMany: async (filter: Record<string, unknown>, update: { $set?: FakeDoc; $unset?: Record<string, unknown> }, opts?: { session?: unknown }) => {
      const target = opts?.session ? (staging ??= docs.map(d => ({ ...d }))) : docs
      let matchedCount = 0
      for (const d of target) if (matchesFilter(d, filter)) { applyUpdate(d, update); matchedCount++ }
      return { matchedCount }
    },
    updateOne: async (filter: Record<string, unknown>, update: { $set?: FakeDoc; $unset?: Record<string, unknown> }, opts?: { session?: unknown }) => {
      if (opts?.session && throwOnNextUpdateOne) {
        const reason = throwOnNextUpdateOne
        throwOnNextUpdateOne = null
        throw new Error(reason)
      }
      const target = opts?.session ? (staging ??= docs.map(d => ({ ...d }))) : docs
      const d = target.find(x => matchesFilter(x, filter))
      if (!d) return { matchedCount: 0 }
      applyUpdate(d, update)
      return { matchedCount: 1 }
    },
    insertMany: async (newDocs: FakeDoc[], opts?: { session?: unknown }) => {
      const target = opts?.session ? (staging ??= docs.map(d => ({ ...d }))) : docs
      target.push(...newDocs.map(d => ({ ...d })))
      return {}
    },
  }

  const client = {
    startSession() {
      return {
        withTransaction: async (fn: () => Promise<void>) => {
          staging = docs.map(d => ({ ...d }))
          try {
            await fn()
            docs = staging
          } finally {
            staging = null
          }
        },
        endSession: async () => {},
      }
    },
  }

  return {
    col: col as unknown as import('mongodb').Collection,
    client: client as unknown as import('mongodb').MongoClient,
    armSplitAbort: (reason: string) => { throwOnNextUpdateOne = reason },
    getDocs: () => docs,
  }
}

function note(id: string, valor: number): FakeDoc {
  return {
    id, animaId: 'anima-overlock', forma: 'minted', auctor: 'system:test',
    valor: String(valor), valorNum: valor, status: 'valid', natum: new Date(),
  }
}

test('reserve: split-transaction abort over-locks the whole balance, logged with the diagnostic fields', async () => {
  const { col, client, armSplitAbort, getDocs } = makeFakeMongo([
    note('n-small-1', 100),
    note('n-small-2', 200),
    note('n-big', 47780),
  ])
  const store = new MongoSignorum(col, client)

  const logs: LogEntry[] = []
  const onLog = (entry: LogEntry) => { logs.push(entry) }
  bus.on('log', onLog)

  armSplitAbort('injected: split transaction aborted (simulated transient transaction error)')

  try {
    const amount = 900n
    const result = await store.reserve({ animaId: 'anima-overlock' }, amount, 'actum-overlock')

    // The fallback shape the bug reported: ok, but the WHOLE balance locked against a tiny ask.
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.locked, 48080n)
      assert.equal(result.signaIds.length, 3)
    }

    const held = getDocs().filter(d => d.status === 'locked')
    assert.equal(held.length, 3, 'all three notes stayed whole-locked — the split never happened')

    const diag = logs.find(e =>
      (e.level === 'error' || e.level === 'warn') &&
      e.component === 'ledger:signorum' &&
      e.actumId === 'actum-overlock',
    )
    assert.ok(diag, 'no error/warn log carries the split-abort over-lock — it is undetectable without a raw Mongo read')
    assert.equal(diag!.animaId, 'anima-overlock')
    assert.equal(diag!.requested, amount.toString())
    assert.equal(diag!.locked, '48080')
    assert.equal(diag!.overLocked, '47180')
  } finally {
    bus.off('log', onLog)
  }
})
