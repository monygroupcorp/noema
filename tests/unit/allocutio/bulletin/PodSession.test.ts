import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PodSession } from '../../../../src/allocutio/lexicon/bulletin/PodSession.js'
import type { Progressus } from '../../../../src/types/progressus.js'

/** Build a Progressus with the required `at` filled (value irrelevant — onProgressus reads `now`). */
const prog = (p: Omit<Progressus, 'at'>): Progressus => ({ ...p, at: new Date(0) })

/** Owned-vocabulary equivalents of the retired cold-start stage strings (#6e). */
const huntP = prog({ phase: 'provisioning', message: 'acquiring GPU' })
const lockP = (pod: { podId?: string; gpuType?: string; costPerHr?: number }): Progressus =>
  prog({ phase: 'provisioning', message: 'pod locked', pod })

// ── onProgressus drives the journal/live from the owned status vocabulary ──────
// (The stringly `onStage` path these mirror was deleted in #6e.)

test('onProgressus cold lifecycle: silent hunt → Found → prep → ready', () => {
  const s = new PodSession('host-1')
  s.onProgressus(prog({ phase: 'provisioning', message: 'acquiring GPU' }), 0)
  assert.equal(s.phase, 'hunting')
  assert.equal(s.snapshot().live, null, 'fast hunt is silent')
  assert.equal(s.snapshot().starting, true, 'provisioning (no pod) drives the starting display')

  // pod-locked = provisioning WITH a pod (the StageInfo now rides on `pod`).
  s.onProgressus(prog({ phase: 'provisioning', message: 'pod p (RTX 4090)', pod: { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 } }), 1000)
  let snap = s.snapshot()
  assert.equal(snap.starting, false, 'starting clears at pod-locked')
  assert.deepEqual(snap.journal[0], { kind: 'found', gpu: 'RTX 4090', rate: 0.69, ms: 1000 })
  assert.deepEqual(snap.live, { kind: 'initializing' })
  assert.equal(s.phase, 'prep')

  // downloading + progress replaces downloading:n/m.
  s.onProgressus(prog({ phase: 'downloading', target: 'model', progress: { done: 3, total: 4, unit: 'items' } }), 2000)
  assert.deepEqual(s.snapshot().live, { kind: 'downloading', n: 3, m: 4, slow: false })

  // pulling + 'runtime ready' = comfy-ready: commit Prepared, go ready.
  s.onProgressus(prog({ phase: 'pulling', target: 'fundamentum', message: 'runtime ready' }), 3000)
  snap = s.snapshot()
  assert.deepEqual(snap.journal[1], { kind: 'prepared', ms: 2000 })
  assert.deepEqual(snap.live, { kind: 'generating' })
  assert.equal(s.phase, 'ready')
})

test('onProgressus: pulling bootstrap → initializing; installing → plugins/reloading; executing/uploading', () => {
  const s = new PodSession('host-1')
  s.onProgressus(prog({ phase: 'provisioning', message: 'acquiring GPU' }), 0)
  s.onProgressus(prog({ phase: 'provisioning', pod: { podId: 'p', gpuType: 'RTX 4090', costPerHr: 0.69 } }), 100)
  // pulling without 'runtime ready' = bootstrapping.
  s.onProgressus(prog({ phase: 'pulling', target: 'fundamentum', message: 'bootstrapping runtime' }), 200)
  assert.deepEqual(s.snapshot().live, { kind: 'initializing' })
  s.onProgressus(prog({ phase: 'installing' }), 300)
  assert.deepEqual(s.snapshot().live, { kind: 'plugins' })
  s.onProgressus(prog({ phase: 'installing', message: 'restarting ComfyUI' }), 400)
  assert.deepEqual(s.snapshot().live, { kind: 'reloading' })
  s.onProgressus(prog({ phase: 'executing' }), 500)
  assert.deepEqual(s.snapshot().live, { kind: 'generating' })
  assert.equal(s.phase, 'ready')
  s.onProgressus(prog({ phase: 'uploading', target: 'output' }), 600)
  assert.deepEqual(s.snapshot().live, { kind: 'saving' })
})

test('onProgressus: a step-counted execution (training) renders a training live line; plain executing stays generating', () => {
  const s = new PodSession('host-1')
  s.onProgressus(prog({ phase: 'provisioning', pod: { podId: 'p', gpuType: 'RTX 4090', costPerHr: 0.69 } }), 0)
  // executing WITH steps (a training loop) → the step/ETA-bearing training kind.
  s.onProgressus(prog({ phase: 'executing', progress: { done: 420, total: 600, unit: 'steps' }, etaMs: 360_000 }), 100)
  assert.deepEqual(s.snapshot().live, { kind: 'training', step: 420, total: 600, etaMs: 360_000 })
  assert.equal(s.phase, 'ready')
  // executing WITHOUT steps (plain inference) → generating, unchanged.
  s.onProgressus(prog({ phase: 'executing' }), 200)
  assert.deepEqual(s.snapshot().live, { kind: 'generating' })
})

test('onProgressus: warm reuse (warm-pod-found) is 🔥-only — never journaled', () => {
  const s = new PodSession('host-1')
  // A warm reuse: provisioning WITH a pod + the warm message. No hunt preceded it.
  s.onProgressus(prog({ phase: 'provisioning', message: 'warm pod reused', pod: { podId: 'warm-1' } }), 0)
  assert.equal(s.snapshot().journal.length, 0, 'no Found/Prepared line for a warm reuse')
  assert.equal(s.podId, 'warm-1', 'pod identity still captured (destroy button)')
  // The actual work then drives the live line.
  s.onProgressus(prog({ phase: 'executing' }), 100)
  assert.deepEqual(s.snapshot().live, { kind: 'generating' })
})

test('onProgressus: terminals + non-bulletin phases keep the current live (WideEvent owns completion)', () => {
  const s = new PodSession('host-1')
  s.onProgressus(prog({ phase: 'provisioning', pod: { podId: 'p', gpuType: 'RTX 4090', costPerHr: 0.69 } }), 0)
  s.onProgressus(prog({ phase: 'executing' }), 100)
  const before = s.snapshot().live
  for (const phase of ['queued', 'loading', 'warming', 'finalizing', 'done', 'failed'] as const) {
    s.onProgressus(prog({ phase }), 200)
    assert.deepEqual(s.snapshot().live, before, `${phase} leaves the live line untouched`)
  }
})

test('markHuntSlow only escalates while hunting', () => {
  const s = new PodSession('host-1')
  s.onProgressus(huntP, 0)
  s.markHuntSlow()
  assert.deepEqual(s.snapshot().live, { kind: 'hunting-slow' })
  // Once locked, a stray markHuntSlow must not overwrite the live line.
  s.onProgressus(lockP({ podId: 'p', gpuType: 'RTX 4090', costPerHr: 0.69 }), 100)
  s.markHuntSlow()
  assert.deepEqual(s.snapshot().live, { kind: 'initializing' })
})

test('recordGen tallies the ledger and rests; warm stepping + confirm', () => {
  const s = new PodSession('host-1')
  s.onProgressus(lockP({ podId: 'p', gpuType: 'RTX 4090', costPerHr: 0.69 }), 0)
  s.recordGen({ costUsd: 0.08, execMs: 12_000 })
  const snap = s.snapshot()
  assert.equal(snap.ledger.genCount, 1)
  assert.equal(snap.ledger.avgCostUsd, 0.08)
  assert.equal(snap.live, null, 'rests after a gen')
  assert.equal(s.phase, 'idle')

  s.stepWarm('dec')   // 1m → 30s
  assert.equal(s.warmTtlMs, 30_000)
  s.setConfirmed(true)
  assert.equal(s.confirmed, true)
})

test('end() freezes and clears the live line', () => {
  const s = new PodSession('host-1')
  s.onProgressus(lockP({ podId: 'p', gpuType: 'RTX 4090', costPerHr: 0.69 }), 0)
  s.end()
  assert.equal(s.ended, true)
  assert.equal(s.snapshot().live, null)
})

test('queueModel: LoRAs accumulate, deduped on intellaId', () => {
  const s = new PodSession('host-1')
  s.queueModel({ intellaId: 'intella.milady', nomen: 'Milady', genus: 'lora' })
  s.queueModel({ intellaId: 'intella.retro', nomen: 'Retro', genus: 'lora' })
  s.queueModel({ intellaId: 'intella.milady', nomen: 'Milady', genus: 'lora' })   // dup
  assert.deepEqual(
    s.pendingModels.map(p => p.intellaId),
    ['intella.milady', 'intella.retro'],
    'LoRAs accumulate; duplicate intellaId ignored',
  )
  assert.deepEqual(s.snapshot().pendingModels, [...s.pendingModels], 'snapshot exposes pending')
})

test('queueModel: a base (genus model) replaces any prior pending base, FCFS', () => {
  const s = new PodSession('host-1')
  s.queueModel({ intellaId: 'intella.flux', nomen: 'FLUX', genus: 'model' })
  s.queueModel({ intellaId: 'intella.lora1', nomen: 'L1', genus: 'lora' })
  s.queueModel({ intellaId: 'intella.sdxl', nomen: 'SDXL', genus: 'model' })   // replaces FLUX
  assert.deepEqual(
    s.pendingModels.map(p => p.intellaId),
    ['intella.lora1', 'intella.sdxl'],
    'one base per loadout; the LoRA survives the base swap',
  )
})

test('unqueueModel drops by id; clearPending empties the loadout', () => {
  const s = new PodSession('host-1')
  s.queueModel({ intellaId: 'intella.a', nomen: 'A', genus: 'lora' })
  s.queueModel({ intellaId: 'intella.b', nomen: 'B', genus: 'lora' })
  s.unqueueModel('intella.a')
  assert.deepEqual(s.pendingModels.map(p => p.intellaId), ['intella.b'])
  s.clearPending()
  assert.deepEqual(s.pendingModels, [])
})

test('picker: categories → mount → results, page/search/base-filter flow + snapshot', () => {
  const s = new PodSession('host-1')
  assert.equal(s.picker, null, 'no picker by default')

  s.openSubmenu('mod')
  s.openPicker()
  assert.deepEqual(s.snapshot().picker, { stage: 'categories', categories: [], items: [], page: 0, pageCount: 0, token: 0 })

  s.setPickerCategories(['loras', 'unet'])
  assert.deepEqual(s.picker?.categories, ['loras', 'unet'])
  assert.equal(s.picker?.stage, 'categories')

  s.enterMount('loras')
  assert.equal(s.picker?.stage, 'list')
  assert.equal(s.picker?.mount, 'loras')

  const fams = [{ id: '', label: 'All bases (1)' }, { id: 'intella.sdxl-base', label: 'SDXL (1)' }]
  s.setPickerResults([{ intellaId: 'intella.l', nomen: 'L', genus: 'lora' }], 3, { families: fams, filter: '' })
  assert.equal(s.picker?.pageCount, 3)
  assert.deepEqual(s.picker?.baseFamilies, fams)
  assert.equal(s.picker?.baseFilter, '')
  assert.equal(s.picker?.token, 1, 'token bumps on each result fill')

  s.setPickerPage(1)
  assert.equal(s.picker?.page, 1)

  s.setBaseFilter('intella.sdxl-base')
  assert.deepEqual(
    { baseFilter: s.picker?.baseFilter, page: s.picker?.page, items: s.picker?.items },
    { baseFilter: 'intella.sdxl-base', page: 0, items: [] },
    'selecting a base family resets page + clears stale items',
  )

  s.backToCategories()
  assert.equal(s.picker?.stage, 'categories')
  assert.equal(s.picker?.mount, undefined)
  assert.deepEqual(s.picker?.categories, ['loras', 'unet'], 'categories preserved on back')

  s.setPickerQuery('milady')
  assert.equal(s.picker?.stage, 'list', 'search jumps to a flat list')
  assert.equal(s.picker?.query, 'milady')
  assert.equal(s.picker?.page, 0, 'a search resets to page 0')
})

test('picker only exists under the mod submenu: leaving mod (or ending) closes it', () => {
  const s = new PodSession('host-1')
  s.openSubmenu('mod'); s.openPicker()
  assert.ok(s.picker)

  s.openSubmenu('share')          // leaving mod
  assert.equal(s.picker, null, 'picker cleared when the submenu changes away from mod')

  s.openSubmenu('mod'); s.openPicker()
  s.openSubmenu(null)             // back to top-3
  assert.equal(s.picker, null)

  s.openSubmenu('mod'); s.openPicker()
  s.end()
  assert.equal(s.snapshot().picker, undefined, 'ended session carries no picker')
})

test('closePicker leaves the mod submenu open (back-from-categories returns to the loadout)', () => {
  const s = new PodSession('host-1')
  s.openSubmenu('mod'); s.openPicker()
  s.closePicker()
  assert.equal(s.picker, null)
  assert.equal(s.activeSubmenu, 'mod', 'still in the mod submenu after closing the picker')
})

test('setPickerPage clamps to [0, pageCount-1]', () => {
  const s = new PodSession('host-1')
  s.openSubmenu('mod'); s.openPicker(); s.enterMount('unet')
  s.setPickerResults([{ intellaId: 'i', nomen: 'M', genus: 'model' }], 3)   // 3 pages
  s.setPickerPage(9)
  assert.equal(s.picker?.page, 2, 'clamped to the last page')
  s.setPickerPage(-4)
  assert.equal(s.picker?.page, 0, 'clamped to the first page')
})

test('unqueueModel on an unknown id is a harmless no-op', () => {
  const s = new PodSession('host-1')
  s.queueModel({ intellaId: 'intella.a', nomen: 'A', genus: 'lora' })
  s.unqueueModel('intella.nope')
  assert.deepEqual(s.pendingModels.map(p => p.intellaId), ['intella.a'])
})
