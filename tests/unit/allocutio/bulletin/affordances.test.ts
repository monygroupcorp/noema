import { test } from 'node:test'
import assert from 'node:assert/strict'
import { affordancesFor, pickerAffordances, armAffordances, armPageCount, ARM_PAGE_SIZE } from '../../../../src/allocutio/lexicon/bulletin/affordances.js'
import type { BulletinSnapshot } from '../../../../src/allocutio/lexicon/bulletin/BulletinView.js'
import { WARM_DEFAULT_MS, type PickerState, type PendingModel, type ArmState, type StudioBase } from '../../../../src/allocutio/lexicon/bulletin/types.js'

const base: BulletinSnapshot = {
  journal: [], live: null,
  ledger: { genCount: 0, totalCostUsd: 0, avgCostUsd: 0, avgExecMs: 0, hasCost: false, hasExec: false },
  warmTtlMs: WARM_DEFAULT_MS, confirmed: true, ended: false, audience: 'host',
  activeSubmenu: null, pendingModels: [],
}
const ids = (rows: ReturnType<typeof pickerAffordances>) => rows.flat().map(a => a.id)
const items = (n: number): PendingModel[] =>
  Array.from({ length: n }, (_, i) => ({ intellaId: `intella.x${i}`, nomen: `Model ${i}`, genus: 'lora' as const }))
/** A list-stage PickerState with a fixed token (7) → deterministic `mod.pick:7:<i>` ids. */
const list = (o: Partial<PickerState> = {}): PickerState =>
  ({ stage: 'list', categories: [], items: [], page: 0, pageCount: 0, token: 7, ...o })

test('mod submenu offers Add model + Back (no View loadout — the body IS the loadout)', () => {
  const rows = affordancesFor({ ...base, activeSubmenu: 'mod' })
  assert.deepEqual(ids(rows).sort(), ['mod.add', 'submenu.back'].sort())
})

test('an open picker takes over the mod submenu rows', () => {
  const rows = affordancesFor({ ...base, activeSubmenu: 'mod', picker: list({ mount: 'loras', items: items(2), pageCount: 1 }) })
  assert.ok(!ids(rows).includes('mod.add'), 'picker replaces the mod rows')
  assert.ok(ids(rows).includes('mod.pick:7:0'))
})

// ── category stage ───────────────────────────────────────────────────────────

test('category stage: icon-only control row on top, then one mount per row', () => {
  const rows = pickerAffordances(list({ stage: 'categories', categories: ['loras', 'checkpoints', 'unet'] }))
  // Top row = Back + Search, icon-only (no text labels).
  assert.deepEqual(rows[0].map(a => a.id), ['submenu.back', 'mod.search', 'mod.trigger'])
  assert.ok(rows[0].every(a => a.label.length <= 2), 'control row is unicode icons, not words')
  // Each category on its own row.
  assert.deepEqual(rows.slice(1).map(r => r.map(a => a.id)), [['mod.cat:loras'], ['mod.cat:checkpoints'], ['mod.cat:unet']])
})

// ── list stage ───────────────────────────────────────────────────────────────

test('list stage: icon control row on top, then one model per row (name → detail, ＋ → add)', () => {
  const rows = pickerAffordances(list({ mount: 'loras', items: items(3), page: 0, pageCount: 1 }))
  assert.deepEqual(rows[0].map(a => a.id), ['submenu.back', 'mod.search', 'mod.trigger'], 'top control row')
  const itemRows = rows.filter(r => r.some(a => a.id.startsWith('mod.detail:')))
  assert.equal(itemRows.length, 3, 'one row per model')
  assert.ok(itemRows.every(r => r.length === 2 && r[0].id.startsWith('mod.detail:') && r[1].id.startsWith('mod.pick:')),
    'each row: [ name → detail ] [ ＋ → add ]')
  assert.ok(itemRows.every(r => r[1].label === '+'), 'the add affordance is a + icon')
})

test('detail stage renders the control row + a single ＋ Add', () => {
  const rows = pickerAffordances(list({ stage: 'detail', detail: { intellaId: 'x', nomen: 'Milady', genus: 'lora' } }))
  assert.deepEqual(rows[0].map(a => a.id), ['submenu.back', 'mod.search', 'mod.trigger'])
  assert.ok(rows.flat().some(a => a.id === 'mod.detailadd'))
})

test('long model names are truncated with an ellipsis', () => {
  const longName = 'a-really-long-model-name-that-would-wrap-the-button-badly'
  const rows = pickerAffordances(list({ mount: 'loras', items: [{ intellaId: 'x', nomen: longName, genus: 'lora' }], pageCount: 1 }))
  const label = rows.flat().find(a => a.id.startsWith('mod.detail:'))!.label
  assert.ok(label.length < longName.length && label.endsWith('…'), 'clipped with an ellipsis')
})

test('base-filter button shows the current family; absent when the mount has no families', () => {
  const withBase = pickerAffordances(list({
    mount: 'loras', items: items(1), pageCount: 1,
    baseFamilies: [{ id: '', label: 'All bases (76)' }, { id: 'intella.sdxl-base', label: 'SDXL (66)' }], baseFilter: 'intella.sdxl-base',
  }))
  assert.ok(withBase.flat().some(a => a.id === 'mod.basefilter' && a.label === 'Base: SDXL (66)'), 'shows the selected family')
  const noBase = pickerAffordances(list({ mount: 'unet', items: items(1), pageCount: 1 }))
  assert.ok(!noBase.flat().some(a => a.id === 'mod.basefilter'))
})

test('nav row is arrow-only and gates Prev/Next on page bounds; Search + Back stay on top', () => {
  const first = pickerAffordances(list({ mount: 'loras', items: items(1), page: 0, pageCount: 3 }))
  const firstIds = ids(first)
  assert.ok(!firstIds.includes('mod.page:prev'), 'no Prev on the first page')
  assert.ok(firstIds.includes('mod.page:next'))
  assert.ok(firstIds.includes('mod.search') && firstIds.includes('submenu.back'), 'search + back ever-present')
  // The nav button is an arrow, not the word "Next".
  const nextBtn = first.flat().find(a => a.id === 'mod.page:next')!
  assert.ok(!/next/i.test(nextBtn.label) && nextBtn.label.length <= 2, 'arrow only')

  const mid = ids(pickerAffordances(list({ mount: 'loras', items: items(1), page: 1, pageCount: 3 })))
  assert.ok(mid.includes('mod.page:prev') && mid.includes('mod.page:next'), 'both on a middle page')

  const last = ids(pickerAffordances(list({ mount: 'loras', items: items(1), page: 2, pageCount: 3 })))
  assert.ok(last.includes('mod.page:prev') && !last.includes('mod.page:next'), 'no Next on the last page')
})

test('single-page list shows no nav row at all', () => {
  const rows = pickerAffordances(list({ mount: 'unet', items: items(2), page: 0, pageCount: 1 }))
  assert.ok(!ids(rows).some(id => id.startsWith('mod.page:')), 'no Prev/Next when one page')
})

// ── /arm flow chooser: pagination with ABSOLUTE indices ─────────────────────

const flows = (n: number): StudioBase[] =>
  Array.from({ length: n }, (_, i) => ({ id: `fund-${i}`, label: `Studio ${i}` }))
/** The chooser as the manager builds it: the flow cards, then Custom last. */
const arm = (n: number, page?: number): ArmState =>
  ({ step: 'preset', presets: [...flows(n), { id: 'custom', label: 'Custom' }], images: [], configs: [], ...(page === undefined ? {} : { page }) })

test('the flow chooser renders 8 flows to a page, with Custom pinned below', () => {
  const rows = armAffordances(arm(19))
  const flowRows = rows.filter(r => r.some(a => a.id.startsWith('arm.flow:')))
  assert.equal(flowRows.length, ARM_PAGE_SIZE, 'one page of flows, not the whole list')
  assert.ok(ids(rows).includes('arm.preset:19'), 'Custom is on the page (absolute index, last preset)')
})

test('a chooser that fits on one page has no nav row', () => {
  const rows = armAffordances(arm(ARM_PAGE_SIZE))
  assert.ok(!ids(rows).some(id => id.startsWith('arm.page:')), 'no Prev/Next when one page')
  assert.equal(rows.filter(r => r.some(a => a.id.startsWith('arm.flow:'))).length, ARM_PAGE_SIZE)
})

test('page 1 rows carry ABSOLUTE indices into presets — the first row is 8, not 0', () => {
  const rows = armAffordances(arm(19, 1))
  const flowIds = ids(rows).filter(id => id.startsWith('arm.flow:'))
  assert.deepEqual(flowIds, Array.from({ length: 8 }, (_, k) => `arm.flow:${8 + k}`),
    'a page-relative index would resolve a tap to a different substrate than the row names')
  assert.ok(ids(rows).includes('arm.preset:8') && !ids(rows).includes('arm.preset:0'), 'the ＋ index matches the name')
})

test('nav arrows are arrow-only and gate on page bounds; Custom stays reachable on every page', () => {
  const first = ids(armAffordances(arm(19, 0)))
  assert.ok(!first.includes('arm.page:prev') && first.includes('arm.page:next'), 'no Prev on the first page')
  const mid = ids(armAffordances(arm(19, 1)))
  assert.ok(mid.includes('arm.page:prev') && mid.includes('arm.page:next'), 'both on a middle page')
  const last = armAffordances(arm(19, 2))
  const lastIds = ids(last)
  assert.ok(lastIds.includes('arm.page:prev') && !lastIds.includes('arm.page:next'), 'no Next on the last page')
  assert.equal(lastIds.filter(id => id.startsWith('arm.flow:')).length, 3, 'the remainder page')
  assert.ok(lastIds.includes('arm.preset:19'), 'Custom is pinned to every page')
  const nav = last.flat().find(a => a.id === 'arm.page:prev')!
  assert.ok(!/prev/i.test(nav.label) && nav.label.length <= 2, 'arrow only')
})

test('an out-of-range page renders the last page rather than an empty keyboard', () => {
  const rows = armAffordances(arm(19, 99))
  assert.ok(rows.some(r => r.some(a => a.id.startsWith('arm.flow:'))), 'still renders flows')
})

test('armPageCount counts only the paged flows — Custom is pinned, never a page of its own', () => {
  assert.equal(armPageCount(arm(0)), 1, 'never below one page')
  assert.equal(armPageCount(arm(8)), 1, 'Custom does not spill onto a second page')
  assert.equal(armPageCount(arm(19)), 3)
})
