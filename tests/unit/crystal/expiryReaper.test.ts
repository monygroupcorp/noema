import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startExpiryReaper, recoverExpiredActa, EXPIRED_ERROR } from '../../../src/crystal/expiryReaper.js'
import { ActumCompletor } from '../../../src/execution/ActumCompletor.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Actorum } from '../../../src/types/cursus.js'
import type { CompositusCursor } from '../../../src/crystal/CompositusCursor.js'

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

// `expirat` is required on `Actum` and is the field every case here varies, so it is required
// on the override rather than defaulted — a default deadline would make the fixture decide the
// very thing each test is setting.
function makeActum(over: Partial<Actum> & Pick<Actum, 'expirat'>): Actum {
  return {
    id: 'a',
    modusId: 'm',
    modusVersiono: 'v1',
    impetus: 1800n,
    signaConsumed: [],
    aditus: {},
    status: 'agens',
    inceptum: new Date(Date.now() - 3600_000),
    ...over,
  }
}

/**
 * In-memory Actorum that implements the REAL findExpired predicate
 * (status ∈ {nascens,agens} AND expirat ≤ now), so the test exercises that a
 * still-live / not-yet-expired actum is left untouched — not just that the reaper
 * fails whatever it is handed.
 */
class FakeActorum implements Partial<Actorum> {
  store = new Map<string, Actum>()
  constructor(acta: Actum[]) { for (const a of acta) this.store.set(a.id, a) }
  async findExpired(): Promise<Actum[]> {
    const now = Date.now()
    return [...this.store.values()].filter(a =>
      (a.status === 'nascens' || a.status === 'agens') && a.expirat !== undefined && a.expirat.getTime() <= now)
  }
  async findById(id: string): Promise<Actum | null> { return this.store.get(id) ?? null }
  async update(id: string, patch: Partial<Actum>): Promise<Actum> {
    const cur = this.store.get(id)
    if (!cur) throw new Error(`Actum '${id}' not found`)
    const next = { ...cur, ...patch } as Actum
    this.store.set(id, next)
    return next
  }
}

function recordingCompositus(): { calls: Array<{ parentId: string; childId: string; success: boolean }> } & CompositusCursor {
  const calls: Array<{ parentId: string; childId: string; success: boolean }> = []
  const stub = {
    calls,
    async onStepComplete(parentId: string, child: Actum, success: boolean) {
      calls.push({ parentId, childId: child.id, success })
    },
  }
  return stub as unknown as (typeof stub & CompositusCursor)
}

test('recoverExpiredActa fails an expired actum and releases its locked signa (no charge)', async () => {
  const signorum = new MemorySignorum()
  const s1 = await signorum.issue({ animaId: 'u1', forma: 'eth', valor: 1000n, auctor: 'test' })
  const s2 = await signorum.issue({ animaId: 'u1', forma: 'eth', valor: 800n, auctor: 'test' })
  await signorum.lock([s1.id, s2.id], 'expired-1')

  const expired = makeActum({
    id: 'expired-1',
    status: 'agens',
    expirat: new Date(Date.now() - 60_000),
    signaConsumed: [s1.id, s2.id],
  })
  const actorum = new FakeActorum([expired])
  const completor = new ActumCompletor({ acta: actorum as unknown as Actorum, signorum })
  const compositus = recordingCompositus()

  const reaped = await recoverExpiredActa({ actorum: actorum as unknown as Actorum, completor, compositusCursor: compositus })

  assert.equal(reaped, 1)
  // Actum transitioned to fractus with the canonical error.
  const after = await actorum.findById('expired-1')
  assert.equal(after?.status, 'fractus')
  assert.equal(after?.error, EXPIRED_ERROR)
  // Signa released: status locked→valid, actumId cleared, nothing spent (no charge).
  for (const id of [s1.id, s2.id]) {
    const hist = await signorum.history({ animaId: 'u1' })
    const sig = hist.find(s => s.id === id)!
    assert.equal(sig.status, 'valid', `signum ${id} should be released to valid`)
    assert.equal(sig.actumId, undefined, `signum ${id} actumId should be cleared`)
    assert.notEqual(sig.status, 'spent')
  }
  // No compositus parent → no notify.
  assert.equal(compositus.calls.length, 0)
})

test('recoverExpiredActa notifies the compositus parent of the step failure', async () => {
  const signorum = new MemorySignorum()
  const expired = makeActum({
    id: 'child-1',
    status: 'nascens',
    expirat: new Date(Date.now() - 1000),
    compositum: { parentId: 'parent-9', ordine: 0 },
  })
  const actorum = new FakeActorum([expired])
  const completor = new ActumCompletor({ acta: actorum as unknown as Actorum, signorum })
  const compositus = recordingCompositus()

  await recoverExpiredActa({ actorum: actorum as unknown as Actorum, completor, compositusCursor: compositus })

  assert.deepEqual(compositus.calls, [{ parentId: 'parent-9', childId: 'child-1', success: false }])
})

test('recoverExpiredActa leaves a not-yet-expired actum untouched', async () => {
  const signorum = new MemorySignorum()
  const s1 = await signorum.issue({ animaId: 'u2', forma: 'eth', valor: 500n, auctor: 'test' })
  await signorum.lock([s1.id], 'live-1')

  const live = makeActum({
    id: 'live-1',
    status: 'agens',
    expirat: new Date(Date.now() + 3600_000), // expires in the future
    signaConsumed: [s1.id],
  })
  const actorum = new FakeActorum([live])
  const completor = new ActumCompletor({ acta: actorum as unknown as Actorum, signorum })
  const compositus = recordingCompositus()

  const reaped = await recoverExpiredActa({ actorum: actorum as unknown as Actorum, completor, compositusCursor: compositus })

  assert.equal(reaped, 0)
  const after = await actorum.findById('live-1')
  assert.equal(after?.status, 'agens') // still live
  const sig = (await signorum.history({ animaId: 'u2' })).find(s => s.id === s1.id)!
  assert.equal(sig.status, 'locked') // reserve stays locked
})

test('recoverExpiredActa is idempotent — a re-swept fractus actum is a no-op (no double-release)', async () => {
  const signorum = new MemorySignorum()
  const s1 = await signorum.issue({ animaId: 'u3', forma: 'eth', valor: 400n, auctor: 'test' })
  await signorum.lock([s1.id], 'race-1')
  const expired = makeActum({
    id: 'race-1', status: 'agens', expirat: new Date(Date.now() - 1000), signaConsumed: [s1.id],
  })
  const actorum = new FakeActorum([expired])
  const completor = new ActumCompletor({ acta: actorum as unknown as Actorum, signorum })
  const compositus = recordingCompositus()
  const deps = { actorum: actorum as unknown as Actorum, completor, compositusCursor: compositus }

  await recoverExpiredActa(deps)
  // A second sweep must not throw and must not re-release (findExpired excludes fractus).
  const second = await recoverExpiredActa(deps)
  assert.equal(second, 0)
  const sig = (await signorum.history({ animaId: 'u3' })).find(s => s.id === s1.id)!
  assert.equal(sig.status, 'valid')
})

test('startExpiryReaper sweeps on an interval and stops cleanly', async () => {
  const signorum = new MemorySignorum()
  const expired = makeActum({ id: 'tick-1', status: 'agens', expirat: new Date(Date.now() - 1000) })
  const actorum = new FakeActorum([expired])
  const completor = new ActumCompletor({ acta: actorum as unknown as Actorum, signorum })
  const compositus = recordingCompositus()

  const stop = startExpiryReaper({ actorum: actorum as unknown as Actorum, completor, compositusCursor: compositus }, 30)
  await wait(80)
  stop()
  const after = await actorum.findById('tick-1')
  assert.equal(after?.status, 'fractus') // reaper tick failed it
})

// ---------------------------------------------------------------------------
// The release half of the deadline
//
// Raising `expirat` raises how long a payer's credits stay locked against a dead run. That trade
// is only acceptable while a reaped run costs the payer nothing — fail() must RELEASE the locked
// signa, never settle them. This pins that, so the release path cannot quietly become a charge.
// ---------------------------------------------------------------------------

test('a reaped actum charges the payer nothing and returns every locked signum', async () => {
  const signorum = new MemorySignorum()
  const s1 = await signorum.issue({ animaId: 'u9', forma: 'eth', valor: 1200n, auctor: 'test' })
  const s2 = await signorum.issue({ animaId: 'u9', forma: 'eth', valor: 600n, auctor: 'test' })
  const balanceBefore = await signorum.balance({ animaId: 'u9' })
  await signorum.lock([s1.id, s2.id], 'reaped-1')

  const expired = makeActum({
    id: 'reaped-1',
    status: 'agens',
    expirat: new Date(Date.now() - 1000),
    signaConsumed: [s1.id, s2.id],
    impetus: 1800n,
  })
  const actorum = new FakeActorum([expired])
  const completor = new ActumCompletor({ acta: actorum as unknown as Actorum, signorum })

  await recoverExpiredActa({
    actorum: actorum as unknown as Actorum, completor, compositusCursor: recordingCompositus(),
  })

  // Nothing charged: the spendable balance is exactly what it was before the run was initiated.
  assert.equal(await signorum.balance({ animaId: 'u9' }), balanceBefore, 'a reaped run must cost the payer nothing')
  // Every locked signum came back — released to `valid`, not spent, and unbound from the actum.
  const hist = await signorum.history({ animaId: 'u9' })
  for (const id of [s1.id, s2.id]) {
    const sig = hist.find(s => s.id === id)!
    assert.equal(sig.status, 'valid', `signum ${id} must be released, not settled`)
    assert.equal(sig.actumId, undefined)
  }
})
