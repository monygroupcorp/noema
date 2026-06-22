// Build #2 — the status sink + lenient parse + coalescing + legacy shim.
//  - pure transforms: coercePhase / normalizeProgressus / shouldPersist / progressusToStage
//  - CrystalApi.reportProgressus end-to-end over a real MemoryActorum: append, coalesce
//    (per-tick NOT persisted), roll up phaseDurations on terminal, return {continue}.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  coercePhase, normalizeProgressus, shouldPersist, progressusToStage,
} from '../../../src/execution/progressus.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import { bus } from '../../../src/lib/bus.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Progressus } from '../../../src/types/progressus.js'

const at = (ms: number): Date => new Date(1_700_000_000_000 + ms)

// ── coercePhase ────────────────────────────────────────────────────────────

test('coercePhase: exact known phase passes through', () => {
  assert.equal(coercePhase('downloading'), 'downloading')
  assert.equal(coercePhase('attesting'), 'attesting')
})

test('coercePhase: unknown strings map by keyword heuristic; default is executing', () => {
  assert.equal(coercePhase('downloading models'), 'downloading')
  assert.equal(coercePhase('OOM killed'), 'failed')
  assert.equal(coercePhase('all finished'), 'done')
  assert.equal(coercePhase('tunnel handshake'), 'attesting')
  assert.equal(coercePhase('sampling'), 'executing')   // no keyword → floor
  assert.equal(coercePhase(undefined), 'executing')
  assert.equal(coercePhase(42), 'executing')
})

test('coercePhase: download wins over load for "downloading"', () => {
  assert.equal(coercePhase('downloading'), 'downloading')
})

// ── normalizeProgressus (lenient, never throws) ─────────────────────────────

test('normalize: only phase+at survive a near-empty body; at defaults to now', () => {
  const now = at(5000)
  const p = normalizeProgressus({}, now)
  assert.equal(p.phase, 'executing')
  assert.equal(p.at.getTime(), now.getTime())
  assert.equal(p.message, undefined)
})

test('normalize: coerces at from ISO string, bad unit → items, keeps total', () => {
  const p = normalizeProgressus({ phase: 'downloading', target: 'model', at: '2026-01-01T00:00:00.000Z', progress: { done: 2, total: 5, unit: 'frobnsubs' } })
  assert.equal(p.target, 'model')
  assert.equal(p.at.getTime(), new Date('2026-01-01T00:00:00.000Z').getTime())
  assert.deepEqual(p.progress, { done: 2, total: 5, unit: 'items' })
})

test('normalize: legacy TEE { step } body becomes an executing report carrying step as message', () => {
  const p = normalizeProgressus({ sessionId: 's1', step: 'booting enclave' }, at(0))
  assert.equal(p.phase, 'executing')
  assert.equal(p.message, 'booting enclave')
})

test('normalize: recurses into parallel[] and drops junk fields', () => {
  const p = normalizeProgressus({ phase: 'downloading', junk: 'x', parallel: [{ phase: 'downloading', progress: { done: 1, total: 3, unit: 'bytes' } }] }, at(0))
  assert.equal((p as Record<string, unknown>).junk, undefined)
  assert.equal(p.parallel?.length, 1)
  assert.equal(p.parallel?.[0].progress?.unit, 'bytes')
})

test('normalize: malformed resources are dropped; valid numeric ones kept', () => {
  assert.equal(normalizeProgressus({ phase: 'loading', resources: { vramUsedMb: 'lots' } }, at(0)).resources, undefined)
  assert.deepEqual(normalizeProgressus({ phase: 'loading', resources: { vramUsedMb: 8000 } }, at(0)).resources, { vramUsedMb: 8000 })
})

// ── shouldPersist (coalescing) ──────────────────────────────────────────────

test('shouldPersist: first report always; transitions, messages, terminals persist', () => {
  const exec = (over: Partial<Progressus> = {}): Progressus => ({ phase: 'executing', at: at(0), ...over })
  assert.equal(shouldPersist(undefined, exec()), true)                                   // first
  assert.equal(shouldPersist(exec(), { phase: 'uploading', at: at(1) }), true)           // phase transition
  assert.equal(shouldPersist({ phase: 'downloading', target: 'model', at: at(0) }, { phase: 'downloading', target: 'dataset', at: at(1) }), true) // target transition
  assert.equal(shouldPersist(exec(), exec({ message: 'node: KSampler' })), true)         // log message
  assert.equal(shouldPersist(exec(), { phase: 'failed', at: at(1) }), true)              // terminal
})

test('shouldPersist: a same-(phase,target) pure progress tick is NOT persisted (live-only)', () => {
  const a: Progressus = { phase: 'executing', at: at(0), progress: { done: 7, total: 20, unit: 'steps' } }
  const b: Progressus = { phase: 'executing', at: at(1), progress: { done: 8, total: 20, unit: 'steps' } }
  assert.equal(shouldPersist(a, b), false)
})

// ── progressusToStage (legacy shim) ─────────────────────────────────────────

test('progressusToStage: phase:done/total when countable, else bare phase', () => {
  assert.equal(progressusToStage({ phase: 'executing', at: at(0), progress: { done: 7, total: 20, unit: 'steps' } }), 'executing:7/20')
  assert.equal(progressusToStage({ phase: 'uploading', at: at(0) }), 'uploading')
})

// ── reportProgressus end-to-end ─────────────────────────────────────────────

function makeActum(over: Partial<Actum> = {}): Omit<Actum, 'inceptum'> {
  return {
    id: 'act-1', modusId: 'm.flux', modusVersiono: '1', impetus: 0n, signaConsumed: [],
    aditus: {}, status: 'agens', expirat: at(1_000_000), ...over,
  }
}

async function makeApi() {
  const actorum = new MemoryActorum()
  const api = new CrystalApi({ actorum } as unknown as CrystalApiDeps)
  return { actorum, api }
}

test('reportProgressus: appends transitions, coalesces per-tick, rolls up durations on terminal', async () => {
  const { actorum, api } = await makeApi()
  await actorum.create(makeActum())

  const post = (body: Record<string, unknown>) => api.reportProgressus({ actumId: 'act-1', progressus: body })

  await post({ phase: 'provisioning', at: at(0) })
  await post({ phase: 'downloading', target: 'model', at: at(1000) })
  await post({ phase: 'executing', at: at(4000), progress: { done: 1, total: 20, unit: 'steps' } })
  await post({ phase: 'executing', at: at(4500), progress: { done: 9, total: 20, unit: 'steps' } }) // per-tick → coalesced away
  await post({ phase: 'executing', at: at(4800), progress: { done: 18, total: 20, unit: 'steps' } }) // per-tick → coalesced away
  const final = await post({ phase: 'done', at: at(9000) })

  const actum = await actorum.findById('act-1')
  // 4 persisted: provisioning, downloading/model, executing(first), done — NOT the two ticks.
  assert.deepEqual(actum?.progressus?.map(p => p.phase), ['provisioning', 'downloading', 'executing', 'done'])
  assert.deepEqual(actum?.phaseDurations, {
    provisioning: 1000,
    'downloading/model': 3000,
    executing: 5000, // 4000 → 9000, ticks didn't fragment it
  })
  assert.deepEqual(final, { continue: true })
})

test('reportProgressus: a fractus Actum signals the runner to bail (continue:false)', async () => {
  const { actorum, api } = await makeApi()
  await actorum.create(makeActum({ status: 'fractus' }))
  assert.deepEqual(await api.reportProgressus({ actumId: 'act-1', progressus: { phase: 'executing' } }), { continue: false })
})

test('reportProgressus: emits the typed actum.progressus bus event', async () => {
  const { actorum, api } = await makeApi()
  await actorum.create(makeActum())
  const seen: Progressus[] = []
  const listener = (d: { actumId: string; progressus: Progressus }) => { if (d.actumId === 'act-1') seen.push(d.progressus) }
  bus.on('actum.progressus', listener)
  try {
    await api.reportProgressus({ actumId: 'act-1', progressus: { phase: 'uploading' } })
  } finally {
    bus.off('actum.progressus', listener)
  }
  assert.equal(seen.length, 1)
  assert.equal(seen[0].phase, 'uploading')
})

test('reportProgressus: no actumId and no known session → returns continue, persists nothing', async () => {
  const { api } = await makeApi()
  assert.deepEqual(await api.reportProgressus({ sessionId: 's1', step: 'warming up' }), { continue: true })
})

// ── reportProgressus: TEE warm session (build #4, §6b) ───────────────────────
// A sessionId-bound report (no Actum yet, §9) reflects the latest phase onto the live
// TEE session, surfaced on TeeSessionView.phase — the browser's cold-start progress.

async function makeTeeApi() {
  const actorum = new MemoryActorum()
  const signorum = { balance: async () => 1_000_000n }   // funded — provision passes the budget gate
  const api = new CrystalApi({ actorum, signorum } as unknown as CrystalApiDeps)
  return { api }
}

test('reportProgressus: a sessionId-bound report reflects the latest phase on the TEE session', async () => {
  const { api } = await makeTeeApi()
  const auctor = { animaId: 'anima-1' }
  const provisioned = await api.provisionTeeSession(auctor, { wgClientPublicKey: 'wg-pub' })
  assert.equal(provisioned.status, 'provisioning')
  assert.equal(provisioned.phase, 'provisioning')   // platform-side initial phase

  // The enclave runner posts loading → the browser's next poll sees it.
  const cont = await api.reportProgressus({ sessionId: provisioned.sessionId, progressus: { phase: 'loading', target: 'vram' } })
  assert.deepEqual(cont, { continue: true })
  const view = await api.getTeeSession(auctor, provisioned.sessionId)
  assert.equal(view.phase, 'loading')
})

test('reportProgressus: an ended TEE session tells the runner to bail (continue:false)', async () => {
  const { api } = await makeTeeApi()
  const auctor = { animaId: 'anima-2' }
  const provisioned = await api.provisionTeeSession(auctor, { wgClientPublicKey: 'wg-pub' })
  await api.endTeeSession(auctor, provisioned.sessionId)   // status → 'ended' (no pod in local dev)
  assert.deepEqual(
    await api.reportProgressus({ sessionId: provisioned.sessionId, progressus: { phase: 'executing' } }),
    { continue: false },
  )
})

test('reportProgressus: an unknown actumId returns continue but fans out nothing', async () => {
  const { api } = await makeApi()
  let emitted = 0
  const listener = (d: { actumId: string }) => { if (d.actumId === 'ghost') emitted++ }
  bus.on('actum.progressus', listener)
  try {
    assert.deepEqual(await api.reportProgressus({ actumId: 'ghost', progressus: { phase: 'executing' } }), { continue: true })
  } finally {
    bus.off('actum.progressus', listener)
  }
  assert.equal(emitted, 0)
})

test('reportProgressus: the legacy actum.stage shim carries real elapsed from inceptum', async () => {
  const { actorum, api } = await makeApi()
  const created = await actorum.create(makeActum())   // inceptum stamped = now
  const stages: Array<{ stage: string; elapsedMs: number }> = []
  const listener = (d: { actumId: string; stage: string; elapsedMs: number }) => { if (d.actumId === 'act-1') stages.push(d) }
  bus.on('actum.stage', listener)
  try {
    // at is 2s after inceptum → elapsed ~2000ms (allow a little slack for wall-clock create()).
    await api.reportProgressus({ actumId: 'act-1', progressus: { phase: 'executing', at: new Date(created.inceptum.getTime() + 2000), progress: { done: 5, total: 20, unit: 'steps' } } })
  } finally {
    bus.off('actum.stage', listener)
  }
  assert.equal(stages.length, 1)
  assert.equal(stages[0].stage, 'executing:5/20')
  assert.equal(stages[0].elapsedMs, 2000)
})
