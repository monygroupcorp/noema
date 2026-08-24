import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  startExpiryReaper, recoverExpiredActa, recoverSilentPods, isPodLockedReport,
  EXPIRED_ERROR, SILENT_POD_ERROR, FIRST_HEARTBEAT_DEADLINE_MS,
} from '../../../src/crystal/expiryReaper.js'
import { coldStartProgressus } from '../../../src/execution/progressus.js'
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
  /** The REAL findInFlight predicate — status ∈ {nascens,agens} AND a pod handle is held. The
   *  first-heartbeat sweep narrows this set, so the fake must not hand it a wider one. */
  async findInFlight(): Promise<Actum[]> {
    return [...this.store.values()].filter(a =>
      (a.status === 'nascens' || a.status === 'agens') && a.externusJobId != null)
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

// ---------------------------------------------------------------------------
// The first-heartbeat deadline
//
// After the host launches a detached pod it stops watching, so a pod that dies before its first
// status post leaves nothing to observe: the run stays `agens` until `expirat`, holding the
// payer's reservation locked and a GPU billed for the whole of it. These pin the shorter window
// that bounds it — including, deliberately, every case it must NOT fire in.
// ---------------------------------------------------------------------------

/** A run that opted into the deadline, was locked to a machine `lockedMsAgo` ago, and has an
 *  `expirat` far enough out that the expiry sweep is not what would catch it. */
function silentRun(over: Partial<Actum> & { lockedMsAgo: number }): Actum {
  const { lockedMsAgo, ...rest } = over
  return makeActum({
    id: 'silent-1',
    status: 'agens',
    externusJobId: 'pod-abc',
    expirat: new Date(Date.now() + 75 * 60_000),
    firstHeartbeatDeadlineMs: FIRST_HEARTBEAT_DEADLINE_MS,
    podLockedAt: new Date(Date.now() - lockedMsAgo),
    ...rest,
  })
}

function reaperFor(acta: Actum[]): { actorum: FakeActorum; deps: Parameters<typeof recoverSilentPods>[0]; signorum: MemorySignorum } {
  const signorum = new MemorySignorum()
  const actorum = new FakeActorum(acta)
  const completor = new ActumCompletor({ acta: actorum as unknown as Actorum, signorum })
  return {
    actorum, signorum,
    deps: { actorum: actorum as unknown as Actorum, completor, compositusCursor: recordingCompositus() },
  }
}

test('isPodLockedReport recognises the pod lock and nothing on either side of it', () => {
  // The clock starts at the POD LOCK. The acquisition attempt before it holds no pod identity,
  // and the handover report after it is a different phase — neither may start the clock.
  const locked = coldStartProgressus('pod-locked', { podId: 'pod-abc', gpuType: 'RTX 4090', costPerHr: 0.44 })!
  assert.equal(isPodLockedReport(locked), true)
  assert.equal(isPodLockedReport(coldStartProgressus('provisioning')!), false)
  assert.equal(isPodLockedReport({ phase: 'provisioning', target: 'pod' }), false)
  assert.equal(isPodLockedReport({ phase: 'loading' }), false)          // the host's handover
  assert.equal(isPodLockedReport({ phase: 'loading', pod: { podId: 'pod-abc' } }), false)
})

test('recoverSilentPods fails a pod that was locked and never reported in — full release, no charge', async () => {
  const { actorum, deps, signorum } = reaperFor([])
  const s1 = await signorum.issue({ animaId: 'u1', forma: 'eth', valor: 1800n, auctor: 'test' })
  const balanceBefore = await signorum.balance({ animaId: 'u1' })
  await signorum.lock([s1.id], 'silent-1')
  actorum.store.set('silent-1', silentRun({
    lockedMsAgo: FIRST_HEARTBEAT_DEADLINE_MS + 1000,
    signaConsumed: [s1.id],
    progressus: [{ phase: 'installing', message: 'preparing the pod', at: new Date(Date.now() - 9 * 60_000) }],
  }))

  assert.equal(await recoverSilentPods(deps), 1)

  const after = await actorum.findById('silent-1')
  assert.equal(after?.status, 'fractus')
  assert.match(after!.error!, /^Pod never reported in/)
  // The run's own last report is carried into the error — pod-side logs die with the pod, so
  // this is the only surviving account of where it got to.
  assert.match(after!.error!, /last report: installing — preparing the pod/)
  // Release-only: the payer is charged nothing and every locked signum comes back.
  assert.equal(await signorum.balance({ animaId: 'u1' }), balanceBefore)
  const sig = (await signorum.history({ animaId: 'u1' })).find(s => s.id === s1.id)!
  assert.equal(sig.status, 'valid')
  assert.equal(sig.actumId, undefined)
})

test('recoverSilentPods leaves a run whose pod HAS reported alone', async () => {
  const { actorum, deps } = reaperFor([silentRun({
    lockedMsAgo: 60 * 60_000,
    firstPodReportAt: new Date(Date.now() - 59 * 60_000),
  })])
  assert.equal(await recoverSilentPods(deps), 0)
  assert.equal((await actorum.findById('silent-1'))?.status, 'agens')
})

test('recoverSilentPods leaves a run still inside its window alone', async () => {
  const { actorum, deps } = reaperFor([silentRun({ lockedMsAgo: FIRST_HEARTBEAT_DEADLINE_MS - 60_000 })])
  assert.equal(await recoverSilentPods(deps), 0)
  assert.equal((await actorum.findById('silent-1'))?.status, 'agens')
})

test('recoverSilentPods never touches a run that did not opt in', async () => {
  // Opt-in is what keeps the deadline off runs whose runner is parsed in-process (the host, not
  // the pod, is the reporter there) and off rails whose host-side bootstrap is legitimately
  // longer than this window.
  const unarmed = silentRun({ lockedMsAgo: 10 * 60 * 60_000 })
  delete unarmed.firstHeartbeatDeadlineMs
  const { actorum, deps } = reaperFor([unarmed])
  assert.equal(await recoverSilentPods(deps), 0)
  assert.equal((await actorum.findById('silent-1'))?.status, 'agens')
})

test('the clock starts at the pod lock, not at dispatch — an unlocked run is never swept', async () => {
  // A run can sit in the provisioning queue for a long time before a machine is ours. That wait
  // is not the pod's to answer for, so with no pod lock recorded the deadline has not started —
  // however old the run itself is.
  const queued = silentRun({ lockedMsAgo: 0, inceptum: new Date(Date.now() - 10 * 60 * 60_000) })
  delete queued.podLockedAt
  const { actorum, deps } = reaperFor([queued])
  assert.equal(await recoverSilentPods(deps), 0)
  assert.equal((await actorum.findById('silent-1'))?.status, 'agens')
})

test('the window is per-run overridable — a shorter one fires where the default would not', async () => {
  const { actorum, deps } = reaperFor([silentRun({ lockedMsAgo: 90_000, firstHeartbeatDeadlineMs: 60_000 })])
  assert.equal(await recoverSilentPods(deps), 1)
  assert.equal((await actorum.findById('silent-1'))?.status, 'fractus')
})

test('the default window is 10 minutes — far inside the run terminus it backstops', () => {
  assert.equal(FIRST_HEARTBEAT_DEADLINE_MS, 10 * 60 * 1000)
})

test('recoverSilentPods notifies the compositus parent of the step failure', async () => {
  const compositus = recordingCompositus()
  const signorum = new MemorySignorum()
  const actorum = new FakeActorum([silentRun({
    id: 'child-2', lockedMsAgo: FIRST_HEARTBEAT_DEADLINE_MS + 1, compositum: { parentId: 'parent-7', ordine: 1 },
  })])
  const completor = new ActumCompletor({ acta: actorum as unknown as Actorum, signorum })
  await recoverSilentPods({ actorum: actorum as unknown as Actorum, completor, compositusCursor: compositus })
  assert.deepEqual(compositus.calls, [{ parentId: 'parent-7', childId: 'child-2', success: false }])
})

test('startExpiryReaper sweeps silent pods on the same tick as expired acta', async () => {
  const { actorum, deps } = reaperFor([
    silentRun({ lockedMsAgo: FIRST_HEARTBEAT_DEADLINE_MS + 1 }),
    makeActum({ id: 'expired-2', status: 'agens', expirat: new Date(Date.now() - 1000) }),
  ])
  const stop = startExpiryReaper(deps, 30)
  await wait(120)
  stop()
  assert.equal((await actorum.findById('silent-1'))?.status, 'fractus')
  assert.equal((await actorum.findById('expired-2'))?.status, 'fractus')
})

test('a reaped run carries its last report into acta.error; a run with no timeline keeps the bare reason', async () => {
  const at = new Date(Date.now() - 5 * 60_000)
  const { actorum, deps } = reaperFor([
    makeActum({
      id: 'with-timeline', status: 'agens', expirat: new Date(Date.now() - 1000),
      progressus: [{ phase: 'downloading', target: 'model', message: 'pulling weights', at }],
    }),
    makeActum({ id: 'no-timeline', status: 'agens', expirat: new Date(Date.now() - 1000) }),
  ])

  await recoverExpiredActa(deps)

  const detailed = await actorum.findById('with-timeline')
  assert.equal(
    detailed?.error,
    `${EXPIRED_ERROR} (last report: downloading/model — pulling weights at ${at.toISOString()})`,
  )
  // Nothing to add → the canonical reason is stamped verbatim, as it always was.
  assert.equal((await actorum.findById('no-timeline'))?.error, EXPIRED_ERROR)
})

test('SILENT_POD_ERROR and EXPIRED_ERROR are distinct causes', () => {
  assert.notEqual(SILENT_POD_ERROR, EXPIRED_ERROR)
})
