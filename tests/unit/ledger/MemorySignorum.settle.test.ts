import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'

// settle(signaIds, actualImpetus, actumId)
//
// The overshoot case: greedy signum selection locks more valor than needed.
// settle() spends all locked signa AND issues a refund signum for the delta,
// so the user is charged exactly actualImpetus — no more.
//
// This is the treasury protection invariant:
//   sum(spent signa that settle issues) === actualImpetus (never more)

async function issueAndLock(s: MemorySignorum, animaId: string, valor: bigint, actumId: string) {
  const sig = await s.issue({ animaId, forma: 'minted', valor, auctor: 'test' })
  await s.lock([sig.id], actumId)
  return sig
}

test('settle with exact impetus: no refund issued, signa are spent', async () => {
  const s = new MemorySignorum()
  const sig = await issueAndLock(s, 'anima-1', 1000n, 'act-1')

  await s.settle([sig.id], 1000n, 'act-1')

  const hist = await s.history({ animaId: 'anima-1' })
  const spent = hist.filter(x => x.status === 'spent')
  const valid = hist.filter(x => x.status === 'valid')

  assert.equal(spent.length, 1)
  assert.equal(valid.length, 0)
  assert.equal(await s.balance({ animaId: 'anima-1' }), 0n)
})

test('settle with overshoot: refund signum issued for delta', async () => {
  const s = new MemorySignorum()
  const sig = await issueAndLock(s, 'anima-1', 1000n, 'act-1')

  await s.settle([sig.id], 400n, 'act-1')

  // Original signum is spent
  const hist = await s.history({ animaId: 'anima-1' })
  const spent = hist.find(x => x.id === sig.id)
  assert.equal(spent!.status, 'spent')

  // A refund signum was issued for the delta (1000 - 400 = 600)
  const refund = hist.find(x => x.status === 'valid')
  assert.ok(refund, 'refund signum must be present')
  assert.equal(refund!.valor, 600n)
  assert.equal(refund!.animaId, 'anima-1')
})

test('settle overshoot: user balance equals unspent delta', async () => {
  const s = new MemorySignorum()
  const sig = await issueAndLock(s, 'anima-1', 1000n, 'act-1')

  await s.settle([sig.id], 400n, 'act-1')

  assert.equal(await s.balance({ animaId: 'anima-1' }), 600n)
})

test('settle multiple signa with overshoot: refund is total locked minus actual', async () => {
  const s = new MemorySignorum()
  const a = await issueAndLock(s, 'anima-1', 400n, 'act-1')
  const b = await issueAndLock(s, 'anima-1', 600n, 'act-1')

  // locked = 1000n, actual = 700n → refund = 300n
  await s.settle([a.id, b.id], 700n, 'act-1')

  assert.equal(await s.balance({ animaId: 'anima-1' }), 300n)
})

test('settle with arcanum signa: refund preserves anonymous identity', async () => {
  const s = new MemorySignorum()
  const sig = await s.issue({ forma: 'arcanum', valor: 1000n, auctor: 'test', testis: 'hash-abc' })
  await s.lock([sig.id], 'act-1')

  await s.settle([sig.id], 300n, 'act-1')

  // Refund signum must also be arcanum with same testis so anonymous identity is preserved
  const bal = await s.balance({ commitment: 'hash-abc' })
  assert.equal(bal, 700n)
})

test('settle: spent signa have actumId and expensum set', async () => {
  const s = new MemorySignorum()
  const sig = await issueAndLock(s, 'anima-1', 500n, 'act-1')

  await s.settle([sig.id], 500n, 'act-1')

  const hist = await s.history({ animaId: 'anima-1' })
  const spent = hist.find(x => x.id === sig.id)!
  assert.equal(spent.actumId, 'act-1')
  assert.ok(spent.expensum instanceof Date)
})

// ── settle against a reservation that split a note (noema-306) ───────────────
//
// reserve() hands settle() a set that covers the ceiling EXACTLY, so the common case has no delta
// to mint at all. These prove settle's arithmetic on the new shape, and that the identity carried
// onto the split children survives a second hop through the delta mint.

test('settle after a split: an exactly-covering reservation mints no delta', async () => {
  const s = new MemorySignorum()
  await s.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const r = await s.reserve({ animaId: 'anima-1' }, 400n, 'act-1')
  assert.ok(r.ok)
  await s.settle(r.signaIds, 400n, 'act-1')

  const hist = await s.history({ animaId: 'anima-1' })
  assert.equal(hist.filter(x => x.auctor === 'settle:delta').length, 0, 'exact cover leaves no delta to refund')
  assert.equal(await s.balance({ animaId: 'anima-1' }), 600n, 'charged exactly the actual impetus')
})

test('settle after a split: underspend refunds the delta on top of the change', async () => {
  const s = new MemorySignorum()
  await s.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const r = await s.reserve({ animaId: 'anima-1' }, 400n, 'act-1')
  assert.ok(r.ok)
  await s.settle(r.signaIds, 150n, 'act-1')   // ran cheaper than the ceiling → 250 delta

  const hist = await s.history({ animaId: 'anima-1' })
  const delta = hist.find(x => x.auctor === 'settle:delta')
  assert.ok(delta, 'delta refund must be present')
  assert.equal(delta.valor, 250n)
  assert.equal(delta.forma, 'minted')          // provenance survived the split
  // Net cost is exactly what the run consumed: 1000 − 150.
  assert.equal(await s.balance({ animaId: 'anima-1' }), 850n)
})

test('settle after a split: an arcanum reservation keeps the commitment through both mints', async () => {
  const s = new MemorySignorum()
  await s.issue({ forma: 'arcanum', valor: 1000n, auctor: 'test', testis: 'hash-abc' })

  const r = await s.reserve({ commitment: 'hash-abc' }, 400n, 'act-1')
  assert.ok(r.ok)
  await s.settle(r.signaIds, 150n, 'act-1')

  assert.equal(await s.balance({ commitment: 'hash-abc' }), 850n)
})

test('settle with zero actual impetus: full refund, nothing spent', async () => {
  const s = new MemorySignorum()
  const sig = await issueAndLock(s, 'anima-1', 800n, 'act-1')

  await s.settle([sig.id], 0n, 'act-1')

  // All valor returned as refund
  assert.equal(await s.balance({ animaId: 'anima-1' }), 800n)
})


// ═════════════════════════════════════════════════════════════════════════════
// CONSERVATION OVER THE DECOMPOSE RAIL, end to end (noema-338)
// ═════════════════════════════════════════════════════════════════════════════
//
// The same treasury invariant as above, asserted over a whole real dispatch rather than over
// `settle()` alone — because the decompose rail is where it newly has something to prove.
//
// A decompose used to settle on the SYNC return path: `dispatchInceptio` took the exitus the
// cursor returned and handed it to the completor in the same call stack as the dispatching
// request. The pass now runs OFF-REQUEST, so nothing downstream of `run()` settles it and no
// webhook is coming — the cursor completes its own run. These tests are the money proof for
// that move: the reservation is locked, the pass runs, and the payer ends up down exactly what
// the pass really cost — no more, no less, and once.
//
// Real MemorySignorum, real ActumInceptor, real ActumCompletor, real MuseDecomposeCursor. Only
// the dataset store and the chat transport are fakes, because those are the parts that would
// otherwise need Mongo and a network. It lives in THIS file rather than one of its own so it
// runs in CI: `test:hermetic` enumerates test files by name (tests/unit/architecture/
// testEnrolment.test.ts guards that), and a settlement-conservation test belongs with the
// settlement-conservation tests either way.

import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { MemoryModorum } from '../../../src/execution/MemoryModorum.js'
import { Cursorum } from '../../../src/execution/Cursorum.js'
import { ActumInceptor } from '../../../src/execution/ActumInceptor.js'
import { dispatchInceptio } from '../../../src/execution/dispatchInceptio.js'
import { ActumCompletor } from '../../../src/execution/ActumCompletor.js'
import { Nexus } from '../../../src/ledger/Nexus.js'
import {
  MuseDecomposeCursor,
  MUSE_DECOMPOSE_MINISTERIUM,
} from '../../../src/crystal/MuseDecomposeCursor.js'
import { OPENROUTER_PROVIDER, chatImpetus } from '../../../src/crystal/apiProviders.js'
import { MODUS_DATASET_DECOMPOSE } from '../../../src/crystal/seeds/modi.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Dataset, DatasetMediaItem } from '../../../src/types/dataset.js'
import type { Fragment } from '../../../src/crystal/muse/taxonomy.js'
import type { FetchLike } from '../../../src/crystal/muse/garden.js'

const PAYER = { animaId: 'anima-payer' }
const ENDOWMENT = 1_000_000n
const TOKENS_PER_CALL = 120
const PER_THOUSAND = OPENROUTER_PROVIDER.pricing.chatImpetusPer1kTokens

const mediaItem = (id: string): DatasetMediaItem =>
  ({ id, url: `https://example.invalid/${id}.png`, source: 'upload', addedAt: new Date(0) })

/** Two captioned images, nothing decomposed — a two-call pass. */
function makeDataset(): Dataset {
  return {
    id: 'ds-1',
    owner: 'anima-payer',
    name: 'sample-board',
    modality: 'image',
    custody: 'sealed',
    media: [mediaItem('m-first'), mediaItem('m-second')],
    captionsets: [{
      id: 'cs-1',
      name: 'pass one',
      method: 'sample',
      coverage: '2/2',
      captions: { 'm-first': 'a woman in a red coat', 'm-second': 'a cat on a wall' },
    }],
    versions: [],
    natum: new Date(0),
    mutatum: new Date(0),
  }
}

class FakeDatasets {
  writes = 0
  constructor(private readonly dataset: Dataset) {}
  async find(id: string): Promise<Dataset | null> {
    return this.dataset.id === id ? this.dataset : null
  }
  async setFragments(_datasetId: string, mediaId: string, fragments: Fragment[]): Promise<Dataset | null> {
    const item = this.dataset.media.find((m) => m.id === mediaId)
    if (!item) return null
    item.fragments = fragments
    this.writes++
    return this.dataset
  }
}

/** A chat transport that answers every call with the same usage, or refuses every call. */
function chat(ok: boolean): FetchLike {
  return async () => {
    if (!ok) return { ok: false, status: 502, text: async () => 'upstream said no' }
    const body = JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ fragments: [{ category: 'subject', text: 'a woman' }] }) } }],
      usage: { total_tokens: TOKENS_PER_CALL },
    })
    return { ok: true, status: 200, text: async () => body }
  }
}

async function buildRail(fetchImpl: FetchLike) {
  const signorum = new MemorySignorum()
  const acta = new MemoryActorum()
  const modorum = new MemoryModorum()
  const cursorum = new Cursorum()
  const completor = new ActumCompletor({ acta, signorum, nexus: new Nexus() })
  const datasets = new FakeDatasets(makeDataset())

  await modorum.register(MODUS_DATASET_DECOMPOSE)
  cursorum.register(MUSE_DECOMPOSE_MINISTERIUM, new MuseDecomposeCursor({
    datasets,
    providers: [{ provider: OPENROUTER_PROVIDER, apiKey: 'test-key' }],
    fetchImpl,
    actorum: acta,
    // The same lazy accessor the container wires: the completor is built after the cursor is
    // registered there, and is not called until a pass ends.
    completor: () => completor,
  }))

  const inceptor = new ActumInceptor({ modorum, cursorum, signorum, acta })
  await signorum.issue({ animaId: PAYER.animaId, forma: 'minted', valor: ENDOWMENT, auctor: 'test' })

  /** The real dispatch: initiate → resolve → run. Exactly the path `POST /v1/runs` takes. */
  const dispatch = async (): Promise<Actum> => {
    const { actum } = await dispatchInceptio({ inceptor, modorum, cursorum, completor }, {
      modusId: MODUS_DATASET_DECOMPOSE.id,
      aditus: { dataset: 'ds-1', captionset: 'cs-1' },
      by: PAYER,
    })
    return actum
  }

  return { signorum, acta, datasets, dispatch }
}

/** The run, once it has reached a terminal state under its own power. */
async function terminal(acta: MemoryActorum, id: string, attempts = 200): Promise<Actum> {
  for (let i = 0; i < attempts; i++) {
    const a = await acta.findById(id)
    if (a && (a.status === 'completus' || a.status === 'fractus')) return a
    await new Promise((r) => setTimeout(r, 5))
  }
  assert.fail('the run never reached a terminal state — nothing settled it')
}

test('a decompose that finishes charges exactly what the pass cost, and the rest comes back', async () => {
  const { signorum, acta, datasets, dispatch } = await buildRail(chat(true))

  const actum = await dispatch()

  // The reservation is a CEILING, and it is locked out of the balance for the length of the run.
  const reserved = actum.impetus
  assert.ok(reserved > 0n, 'a metered job must reserve something')
  assert.equal(actum.status, 'nascens')

  const settled = await terminal(acta, actum.id)

  assert.equal(settled.status, 'completus', 'nothing else settles this run — the pass does')
  assert.equal(datasets.writes, 2, 'and it did the work it charged for')

  // The summed REAL token cost of the calls the pass made, which is below the ceiling it locked.
  const actual = chatImpetus(2 * TOKENS_PER_CALL, PER_THOUSAND)
  assert.ok(actual < reserved, 'the estimate must be above the real cost for this to prove anything')
  assert.equal(settled.impetus, actual)

  // CONSERVATION. Endowment out, exactly the real cost gone, the overshoot refunded — nothing
  // stranded in a lock that no return path was left to release.
  assert.equal(await signorum.balance(PAYER), ENDOWMENT - actual)
})

test('the settlement happens once — a re-completed run is refused rather than charged twice', async () => {
  const { signorum, acta, dispatch } = await buildRail(chat(true))

  const actum = await dispatch()
  await terminal(acta, actum.id)

  const actual = chatImpetus(2 * TOKENS_PER_CALL, PER_THOUSAND)
  const after = await signorum.balance(PAYER)
  assert.equal(after, ENDOWMENT - actual)

  // Let anything else that might be holding a timer have its turn; the balance must not move.
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(await signorum.balance(PAYER), after, 'a pass settles exactly once')
})

test('a decompose that dies mid-pass refunds the whole reservation', async () => {
  // The failure rail. A sync cursor that threw was failed by `dispatchInceptio`, which caught it;
  // a detached loop has no caller to throw to. Without the loop failing its own run, the payer's
  // credits stay locked until the expiry reaper — which, with the pass's own terminus declared,
  // is now hours away rather than minutes.
  const { signorum, acta, datasets, dispatch } = await buildRail(chat(false))

  const actum = await dispatch()
  assert.ok(actum.impetus > 0n)

  const settled = await terminal(acta, actum.id)

  assert.equal(settled.status, 'fractus')
  assert.match(String(settled.error), /chat completion failed \(502\)/)
  assert.equal(datasets.writes, 0, 'a pass that never got an answer writes nothing')
  // Nothing was delivered, so nothing is charged and nothing stays locked.
  assert.equal(await signorum.balance(PAYER), ENDOWMENT)
})

test('the run\'s deadline is the pass\'s own length, not the fifteen-minute default', async () => {
  // The reaper is what turns a stale `expirat` into a refunded LIVE run. A pass that outlives its
  // dispatching request has to declare how long it can honestly take, or the reaper releases the
  // reservation out from under a decompose that is still writing fragments.
  const { acta, dispatch } = await buildRail(chat(true))

  const actum = await dispatch()

  const window = actum.expirat.getTime() - actum.inceptum.getTime()
  assert.ok(window > 2 * 60_000, 'the window must cover a call deadline per item and then some')
  await terminal(acta, actum.id)
})
