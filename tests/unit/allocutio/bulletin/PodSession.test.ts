import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PodSession } from '../../../../src/allocutio/lexicon/bulletin/PodSession.js'

test('cold lifecycle: silent hunt → Found → prep → ready, journal commits persist', () => {
  const s = new PodSession('host-1')
  s.onStage('provisioning', undefined, 0)
  assert.equal(s.phase, 'hunting')
  assert.equal(s.snapshot().live, null, 'fast hunt is silent')
  // The silent hunt must still surface "Provisioning…" (not fall through to the warm "keep
  // cooking" line) — the `/make` cold path relies on the stage, not the /arm Start button.
  assert.equal(s.snapshot().starting, true, 'provisioning stage drives the starting/provisioning display')

  s.onStage('pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 }, 1000)
  let snap = s.snapshot()
  assert.equal(snap.starting, false, 'starting clears at pod-locked so it cannot leak into warm-idle')
  assert.deepEqual(snap.journal[0], { kind: 'found', gpu: 'RTX 4090', rate: 0.69, ms: 30_000 })
  assert.deepEqual(snap.live, { kind: 'initializing' })
  assert.equal(s.phase, 'prep')

  s.onStage('downloading:3/4', undefined, 2000)
  assert.deepEqual(s.snapshot().live, { kind: 'downloading', n: 3, m: 4, slow: false })

  s.onStage('comfy-ready', { phaseMs: 4.5 * 60_000 }, 3000)
  snap = s.snapshot()
  assert.deepEqual(snap.journal[1], { kind: 'prepared', ms: 4.5 * 60_000 })
  assert.deepEqual(snap.live, { kind: 'generating' })
  assert.equal(s.phase, 'ready')
})

test('bail erases the Found entry and records a Quit entry (by kind, not prose)', () => {
  const s = new PodSession('host-1')
  s.onStage('provisioning', undefined, 0)
  s.onStage('pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 }, 1000)
  s.onStage('downloading:2/4', undefined, 2000)
  s.onStage('pod-bailed', { bailReason: 'download throttle' }, 3000)

  const j = s.snapshot().journal
  assert.ok(!j.some(e => e.kind === 'found'), 'the bailed pod\'s Found entry is gone')
  assert.deepEqual(j.at(-1), { kind: 'quit', podNum: 1, reason: 'download throttle' })
  assert.equal(s.phase, 'hunting', 're-hunting after the bail')
})

test('markHuntSlow only escalates while hunting', () => {
  const s = new PodSession('host-1')
  s.onStage('provisioning', undefined, 0)
  s.markHuntSlow()
  assert.deepEqual(s.snapshot().live, { kind: 'hunting-slow' })
  // Once locked, a stray markHuntSlow must not overwrite the live line.
  s.onStage('pod-locked', { podId: 'p', gpuType: 'RTX 4090', costPerHr: 0.69 }, 100)
  s.markHuntSlow()
  assert.deepEqual(s.snapshot().live, { kind: 'initializing' })
})

test('recordGen tallies the ledger and rests; warm stepping + confirm', () => {
  const s = new PodSession('host-1')
  s.onStage('pod-locked', { podId: 'p', gpuType: 'RTX 4090', costPerHr: 0.69 }, 0)
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
  s.onStage('pod-locked', { podId: 'p', gpuType: 'RTX 4090', costPerHr: 0.69 }, 0)
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
