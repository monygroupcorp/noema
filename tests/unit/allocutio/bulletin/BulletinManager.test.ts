import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BulletinManager, type BulletinSink } from '../../../../src/allocutio/lexicon/bulletin/BulletinManager.js'
import type { BulletinKeyboard } from '../../../../src/allocutio/lexicon/bulletin/types.js'
import { fakeStageToProgressus } from '../../../../src/crystal/FakeRunPodClient.js'

/** Drive the manager via the OWNED status channel using the same stage→Progressus projection the
 *  runners use, so these tests exercise `onProgressus` exactly as production does (#6e — the
 *  stringly `onStage` they used to call was deleted). Unknown stages (no owned phase) are no-ops. */
function stage(m: BulletinManager, actumId: string, st: string, info?: Record<string, unknown>): void {
  const p = fakeStageToProgressus(st, info)
  if (p) m.onProgressus(actumId, { ...p, at: new Date(0) })
}

function makeSink() {
  const posts: Array<{ chatId: number; text: string; kb: BulletinKeyboard }> = []
  const edits: Array<{ chatId: number; messageId: number; text: string; kb: BulletinKeyboard }> = []
  const removed: number[] = []
  // Chronological timeline of what's actually on screen — a renew posts a FRESH message AFTER
  // edits, so the last-shown must follow real order, not posts-then-edits.
  const shown: Array<{ text: string; kb: BulletinKeyboard }> = []
  let nextId = 100
  const sink: BulletinSink = {
    async post(chatId, text, kb) { posts.push({ chatId, text, kb }); shown.push({ text, kb }); return ++nextId },
    async edit(chatId, messageId, text, kb) { edits.push({ chatId, messageId, text, kb }); shown.push({ text, kb }) },
    async remove(_chatId, messageId) { removed.push(messageId) },
  }
  const lastText = () => shown.at(-1)?.text ?? ''
  const lastKb = () => shown.at(-1)?.kb ?? []
  return { sink, posts, edits, removed, shown, lastText, lastKb }
}
const tick = (ms: number) => new Promise(r => setTimeout(r, ms))
const cb = (kb: BulletinKeyboard) => kb.flat().map(b => b.data)
/** The pick action (no `bul:` prefix) for the i-th item in the current keyboard — carries
 *  the live generation token, so tests drive picks the way the adapter would. */
const pickAction = (kb: BulletinKeyboard, i: number): string =>
  cb(kb).map(d => d.slice(4)).find(a => a.startsWith('mod.pick:') && a.endsWith(`:${i}`))!

test('register posts the setup bulletin; stages drive the journal; complete shows stats', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink })
  m.register(456, 'a1', '123')
  assert.match(s.lastText(), /Set how long to keep the pod warm/)

  stage(m, 'a1', 'provisioning', undefined)
  stage(m, 'a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  await tick(0)   // renders are serialized — let the chained stage edits drain
  assert.match(s.lastText(), /Found RTX 4090 for \$0\.69\/hr/)
  assert.match(s.lastText(), /Initializing/)

  m.onComplete('a1', { costUsd: 0.08, execMs: 12_000, podId: 'pod-1' })
  await tick(0)
  assert.match(s.lastText(), /1 gen · exec ~12s avg · \$0\.080 ea · \$0\.08 total/)
})

test('gen-path race: stages that arrive BEFORE register are buffered + replayed in order', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink })
  // The gen path (cursor.run) fires 'provisioning' the instant it detaches — before the Stream
  // primitive renders + registers. Without buffering these drop (no actumChat yet), the session
  // never enters 'hunting', and the later 'pod-locked' is misread as a WARM reuse ("generating").
  stage(m, 'a1', 'provisioning', undefined)
  stage(m, 'a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  m.register(456, 'a1', '123')   // Stream primitive renders → replays the buffered stages in order
  await tick(0)
  assert.match(s.lastText(), /Found RTX 4090 for \$0\.69\/hr/, 'cold Found line from the replayed provisioning→pod-locked')
  assert.match(s.lastText(), /Initializing/, 'prep stage — NOT a warm "generating"')
  assert.doesNotMatch(s.lastText(), /keep cooking/i, 'not mis-rendered as a warm idle pod')
})

test('warm reuse on a live session does NOT add a second Found line', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink })
  m.register(456, 'a1', '123')
  stage(m, 'a1', 'provisioning')
  stage(m, 'a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  m.onComplete('a1', { costUsd: 0.08, execMs: 12_000, podId: 'pod-1' })

  // Second gen reuses the warm pod: register again, then a bare pod-locked (no hunt).
  m.register(456, 'a2', '123')
  stage(m, 'a2', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 })
  m.onComplete('a2', { costUsd: 0.005, execMs: 11_000, podId: 'pod-1' })
  await tick(0)   // serialized renders — drain the chain before reading the screen

  const foundCount = (s.lastText().match(/Found /g) ?? []).length
  assert.equal(foundCount, 1, 'only the cold start commits a Found line')
  assert.match(s.lastText(), /2 gens/)
})

test('kill is host-only, terminates, cancels in-flight, freezes to receipt', async () => {
  const terminated: string[] = []
  const cancelled: string[] = []
  const s = makeSink()
  const m = new BulletinManager({
    sink: s.sink,
    terminatePod: async (p) => { terminated.push(p) },
    cancelActum: async (a) => { cancelled.push(a); return true },
  })
  m.register(456, 'a1', '123')
  stage(m, 'a1', 'provisioning')
  stage(m, 'a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })

  await m.handleControl(456, '999', 'kill')   // not the host
  assert.deepEqual(terminated, [])
  await m.handleControl(456, '123', 'kill')   // the host
  assert.deepEqual(terminated, ['pod-1'])
  assert.deepEqual(cancelled, ['a1'])
  assert.equal(cb(s.lastKb()).length, 0, 'receipt has no buttons')
})

test('pod.reaped freezes the matching bulletin', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink })
  m.register(456, 'a1', '123')
  stage(m, 'a1', 'provisioning')
  stage(m, 'a1', 'pod-locked', { podId: 'pod-9', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  m.onReaped('pod-9')
  await tick(0)   // serialized renders — let the receipt edit drain
  assert.equal(cb(s.lastKb()).length, 0, 'reaped → frozen, no buttons')
})

test('auto-settle flips the keyboard to the confirmed top-3 after the window', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, autoSettleMs: 30 })
  m.register(456, 'a1', '123')
  assert.ok(cb(s.lastKb()).includes('bul:confirm'), 'setup keyboard before settle')
  await tick(60)
  const after = cb(s.lastKb())
  assert.ok(after.includes('bul:mod') && after.includes('bul:share') && after.includes('bul:destroy'),
    'auto-settle landed on the spec\'d top-3 [Mod] [Share] [Destroy]')
  assert.ok(!after.includes('bul:confirm'), 'no longer in setup state')
})

test('destroy submenu: open → Now terminates + cancels in-flight; receipt frozen', async () => {
  const terminated: string[] = []
  const cancelled: string[] = []
  const s = makeSink()
  const m = new BulletinManager({
    sink: s.sink,
    terminatePod: async (p) => { terminated.push(p) },
    cancelActum: async (a) => { cancelled.push(a); return true },
    autoSettleMs: 30,
  })
  m.register(456, 'a1', '123')
  stage(m, 'a1', 'provisioning')
  stage(m, 'a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  await tick(60)   // confirm via auto-settle so the top-3 is rendered

  // Open the destroy submenu — must show submenu actions, not yet destroyed.
  await m.handleControl(456, '123', 'destroy')
  assert.ok(cb(s.lastKb()).includes('bul:destroy.now'), 'destroy submenu visible')
  assert.deepEqual(terminated, [], 'opening the submenu must not act')

  // Confirm the destroy.
  await m.handleControl(456, '123', 'destroy.now')
  assert.deepEqual(terminated, ['pod-1'])
  assert.deepEqual(cancelled, ['a1'])
  assert.equal(cb(s.lastKb()).length, 0, 'receipt has no buttons')
})

test('destroy submenu: Drain sets drain-only, does NOT terminate immediately', async () => {
  const terminated: string[] = []
  const drained: string[] = []
  const s = makeSink()
  const m = new BulletinManager({
    sink: s.sink,
    terminatePod: async (p) => { terminated.push(p) },
    drainStudio:  async (p) => { drained.push(p) },
    autoSettleMs: 30,
  })
  m.register(456, 'a1', '123')
  stage(m, 'a1', 'provisioning')
  stage(m, 'a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  await tick(60)
  await m.handleControl(456, '123', 'destroy')
  await m.handleControl(456, '123', 'destroy.drain')
  assert.deepEqual(drained, ['pod-1'], 'drain hook fired')
  assert.deepEqual(terminated, [], 'pod is NOT terminated immediately on drain')
  const after = cb(s.lastKb())
  assert.ok(after.includes('bul:destroy'), 'returns to top-3 (submenu closed)')
})

test('submenu.back closes any open submenu', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, autoSettleMs: 30 })
  m.register(456, 'a1', '123')
  await tick(60)
  await m.handleControl(456, '123', 'share')
  assert.ok(cb(s.lastKb()).includes('bul:share.copy'), 'submenu opened')
  await m.handleControl(456, '123', 'submenu.back')
  assert.ok(!cb(s.lastKb()).includes('bul:share.copy'), 'back closed submenu')
  assert.ok(cb(s.lastKb()).includes('bul:destroy'), 'top-3 restored')
})

test('non-host cannot open submenus or invoke destructive actions', async () => {
  const terminated: string[] = []
  const s = makeSink()
  const m = new BulletinManager({
    sink: s.sink,
    terminatePod: async (p) => { terminated.push(p) },
    autoSettleMs: 30,
  })
  m.register(456, 'a1', '123')
  stage(m, 'a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  await tick(60)
  await m.handleControl(456, '999', 'destroy')        // not the host
  assert.ok(!cb(s.lastKb()).includes('bul:destroy.now'), 'submenu not opened for non-host')
  await m.handleControl(456, '999', 'destroy.now')    // direct attempt
  assert.deepEqual(terminated, [], 'destroy is host-only')
})

test('a fresh actum after a receipt opens a new bulletin (new message)', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, terminatePod: async () => {} })
  m.register(456, 'a1', '123')
  stage(m, 'a1', 'provisioning')
  stage(m, 'a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  await m.handleControl(456, '123', 'kill')   // receipt
  const postsBefore = s.posts.length

  m.register(456, 'a2', '123')                // new session → new post
  assert.equal(s.posts.length, postsBefore + 1, 'fresh bulletin is a new message')
})

// ── Mod • → Add picker ───────────────────────────────────────────────────────

const CHECKPOINTS = [
  { intellaId: 'intella.flux', nomen: 'FLUX', genus: 'model' as const },
  { intellaId: 'intella.sdxl', nomen: 'SDXL', genus: 'model' as const },
]
const LORAS = Array.from({ length: 20 }, (_, i) => ({ intellaId: `intella.l${i}`, nomen: `LoRA ${i}`, genus: 'lora' as const }))
const catalogDeps = () => ({
  listCategories: async () => ['checkpoints', 'loras'],
  listMount: async (mount: string, opts: { baseFilter?: string }) =>
    mount === 'loras'
      ? { items: LORAS, baseFamilies: [{ id: '', label: 'All bases (20)' }, { id: 'intella.flux-base', label: 'FLUX (20)' }], baseFilter: opts.baseFilter ?? '' }
      : { items: CHECKPOINTS },
  searchModels: async (q: string) => LORAS.filter(l => l.nomen.toLowerCase().includes(q.toLowerCase())),
})

/** Register → confirm → open the Mod • submenu, host-side. Returns sink + manager. */
async function modOpen(extra: Record<string, unknown> = {}) {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, autoSettleMs: 999_999, ...extra })
  m.register(456, 'a1', '123')
  stage(m, 'a1', 'provisioning')
  stage(m, 'a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  m.onComplete('a1', { costUsd: 0.08, execMs: 12_000, podId: 'pod-1' })
  await m.handleControl(456, '123', 'confirm')
  await m.handleControl(456, '123', 'mod')
  return { s, m }
}

test('mod.add opens the category stage; mod.cat descends into a paginated list', async () => {
  const { s, m } = await modOpen(catalogDeps())
  await m.handleControl(456, '123', 'mod.add')
  let data = cb(s.lastKb())
  assert.ok(data.includes('bul:mod.cat:checkpoints') && data.includes('bul:mod.cat:loras'), 'mount categories shown')
  assert.ok(!data.some(d => d.startsWith('bul:mod.pick:')), 'no items at the category stage')
  assert.match(s.lastText(), /Add a model — pick a type/)

  await m.handleControl(456, '123', 'mod.cat:loras')
  data = cb(s.lastKb())
  assert.equal(data.filter(d => d.startsWith('bul:mod.pick:')).length, 8, 'page size 8')
  assert.ok(data.includes('bul:mod.basefilter'), 'LoRA mount shows the base filter')
  assert.ok(data.includes('bul:mod.page:next') && !data.includes('bul:mod.page:prev'), 'first of 3 pages')
  assert.match(s.lastText(), /loras · page 1\/3/)

  await m.handleControl(456, '123', 'mod.page:next')
  assert.match(s.lastText(), /page 2\/3/)
  assert.ok(cb(s.lastKb()).includes('bul:mod.page:prev'), 'Prev appears on page 2')
})

test('mod.basefilter cycles through the base families (re-fetches per selection)', async () => {
  const calls: Array<string | undefined> = []
  const families = [{ id: '', label: 'All bases (20)' }, { id: 'intella.flux-base', label: 'FLUX (20)' }]
  const deps = { ...catalogDeps(), listMount: async (mount: string, opts: { baseFilter?: string }) => { calls.push(opts.baseFilter); return mount === 'loras' ? { items: LORAS, baseFamilies: families, baseFilter: opts.baseFilter ?? '' } : { items: CHECKPOINTS } } }
  const { s, m } = await modOpen(deps)
  await m.handleControl(456, '123', 'mod.add')
  await m.handleControl(456, '123', 'mod.cat:loras')   // default → All
  await m.handleControl(456, '123', 'mod.basefilter')  // All → FLUX
  await m.handleControl(456, '123', 'mod.basefilter')  // FLUX → All (wraps)
  assert.deepEqual(calls, [undefined, 'intella.flux-base', ''], 'fetches default, then flux, then back to all')
})

test('mod.pick (＋) queues the item and STAYS in the list for rapid-add', async () => {
  const { s, m } = await modOpen(catalogDeps())
  await m.handleControl(456, '123', 'mod.add')
  await m.handleControl(456, '123', 'mod.cat:checkpoints')
  await m.handleControl(456, '123', pickAction(s.lastKb(), 1))   // SDXL
  assert.deepEqual([...m.pendingModelsFor(456)].map(p => p.intellaId), ['intella.sdxl'])
  const data = cb(s.lastKb())
  assert.ok(data.some(d => d.startsWith('bul:mod.pick:')), 'still in the list (not closed)')
  assert.match(s.lastText(), /Standby: SDXL/, 'queued tail shows below the list')
})

test('add-by-trigger resolves trigger word(s) → standby, stays in the list, shows the result', async () => {
  const resolveTriggers = async (text: string) => {
    const toks = text.toLowerCase().split(/[\s,]+/).filter(Boolean)
    return {
      matched: toks.includes('milady') ? [{ intellaId: 'intella.milady', nomen: 'Milady', genus: 'lora' as const }] : [],
      unmatched: toks.filter(t => t !== 'milady'),
    }
  }
  const { s, m } = await modOpen({ ...catalogDeps(), resolveTriggers, promptTrigger: async () => {} })
  await m.handleControl(456, '123', 'mod.add')
  await m.handleControl(456, '123', 'mod.cat:loras')
  await m.applyPickerTriggers(456, 'milady mld retro')
  assert.deepEqual([...m.pendingModelsFor(456)].map(p => p.intellaId), ['intella.milady'], 'matched LoRA added to standby')
  assert.match(s.lastText(), /Added: Milady/, 'result line shows what was added')
  assert.match(s.lastText(), /no match: mld, retro/, 'unmatched tokens surfaced')
  assert.match(s.lastText(), /Standby: Milady/, 'also lands in the standby tail')
  assert.ok(cb(s.lastKb()).some(d => d.startsWith('bul:mod.pick:')), 'stays in the list for rapid add')
})

test('mod.trigger surfaces the trigger prompt, host-only', async () => {
  let prompted = 0
  const { m } = await modOpen({ ...catalogDeps(), promptTrigger: async () => { prompted++ } })
  await m.handleControl(456, '123', 'mod.add')
  await m.handleControl(456, '999', 'mod.trigger')   // not the host
  assert.equal(prompted, 0, 'a guest cannot open the trigger prompt')
  await m.handleControl(456, '123', 'mod.trigger')   // the host
  assert.equal(prompted, 1, 'the host opens the trigger prompt')
})

test('Mod • Add on a WARM studio installs live (no gen), not Standby', async () => {
  const installed: Array<{ podId: string; ids: string[] }> = []
  const deps = {
    ...catalogDeps(),
    installModels: async (podId: string, ids: string[]) => { installed.push({ podId, ids }); return { installedModels: ids } },
    fetchLoadout: async () => ({ categories: [], image: 'img', runtime: 'ComfyUI' }),
  }
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...deps })
  m.register(456, 'a1', '123')
  await m.handleControl(456, '123', 'confirm')                              // confirmed
  stage(m, 'a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 })
  m.onComplete('a1', { costUsd: 0.05, execMs: 10_000, podId: 'pod-1' })     // gen done → warm-idle
  await m.handleControl(456, '123', 'mod')
  await m.handleControl(456, '123', 'mod.add')
  await m.handleControl(456, '123', 'mod.cat:checkpoints')
  await m.handleControl(456, '123', pickAction(s.lastKb(), 1))              // + SDXL
  await tick(20)                                                            // let the background install settle
  assert.deepEqual(installed, [{ podId: 'pod-1', ids: ['intella.sdxl'] }], 'installed live onto the warm pod')
  assert.equal(m.pendingModelsFor(456).length, 0, 'not queued to Standby — it went straight to the pod')
})

test('mod.pick with an out-of-range index is a no-op (correct token, bad index)', async () => {
  const { s, m } = await modOpen(catalogDeps())
  await m.handleControl(456, '123', 'mod.add'); await m.handleControl(456, '123', 'mod.cat:checkpoints')
  const token = pickAction(s.lastKb(), 0).split(':')[1]   // mod.pick:<token>:0
  await m.handleControl(456, '123', `mod.pick:${token}:99`)
  assert.deepEqual([...m.pendingModelsFor(456)], [], 'nothing queued')
  assert.ok(cb(s.lastKb()).some(d => d.startsWith('bul:mod.pick:')), 'picker still open')
})

test('mod.pick with a stale token is rejected (button from a superseded view)', async () => {
  const { s, m } = await modOpen(catalogDeps())
  await m.handleControl(456, '123', 'mod.add'); await m.handleControl(456, '123', 'mod.cat:loras')
  const stale = pickAction(s.lastKb(), 0)              // valid for the studio-base page
  await m.handleControl(456, '123', 'mod.basefilter')  // supersede it — new token, new items
  await m.handleControl(456, '123', stale)              // tap the OLD button
  assert.deepEqual([...m.pendingModelsFor(456)], [], 'stale-token pick queues nothing')
  assert.ok(cb(s.lastKb()).some(d => d.startsWith('bul:mod.pick:')), 'still showing the LoRA list')
})

test('picking a second base model replaces the first (FCFS) via the manager', async () => {
  const { s, m } = await modOpen(catalogDeps())
  await m.handleControl(456, '123', 'mod.add'); await m.handleControl(456, '123', 'mod.cat:checkpoints')
  await m.handleControl(456, '123', pickAction(s.lastKb(), 0))   // FLUX
  await m.handleControl(456, '123', 'mod.add'); await m.handleControl(456, '123', 'mod.cat:checkpoints')
  await m.handleControl(456, '123', pickAction(s.lastKb(), 1))   // SDXL replaces FLUX
  assert.deepEqual([...m.pendingModelsFor(456)].map(p => p.intellaId), ['intella.sdxl'])
})

test('submenu.back walks list → categories → loadout → top-3', async () => {
  const { s, m } = await modOpen(catalogDeps())
  await m.handleControl(456, '123', 'mod.add'); await m.handleControl(456, '123', 'mod.cat:loras')
  await m.handleControl(456, '123', 'submenu.back')   // list → categories
  let data = cb(s.lastKb())
  assert.ok(data.includes('bul:mod.cat:loras') && !data.some(d => d.startsWith('bul:mod.pick:')), 'back at the category stage')

  await m.handleControl(456, '123', 'submenu.back')   // categories → loadout (close picker)
  data = cb(s.lastKb())
  assert.ok(data.includes('bul:mod.add') && !data.some(d => d.startsWith('bul:mod.cat:')), 'back on mod rows')

  await m.handleControl(456, '123', 'submenu.back')   // submenu → top-3
  assert.deepEqual(cb(s.lastKb()).sort(), ['bul:destroy', 'bul:mod', 'bul:share'].sort())
})

test('picker actions are host-only', async () => {
  const { s, m } = await modOpen(catalogDeps())
  await m.handleControl(456, '999', 'mod.add')   // not the host
  assert.ok(!cb(s.lastKb()).some(d => d.startsWith('bul:mod.cat:')), 'no picker for a guest')
})

test('absent catalog deps → category stage opens with no types (just Search/Back)', async () => {
  const { s, m } = await modOpen()   // no listCategories/listMount/searchModels
  await m.handleControl(456, '123', 'mod.add')
  const data = cb(s.lastKb())
  assert.match(s.lastText(), /Add a model — pick a type/)
  assert.ok(!data.some(d => d.startsWith('bul:mod.cat:')) && data.includes('bul:mod.search'))
})

test('applyPickerSearch runs the query (flat) and shows results with the term in the header', async () => {
  const { s, m } = await modOpen(catalogDeps())
  await m.handleControl(456, '123', 'mod.add')
  await m.applyPickerSearch(456, 'LoRA 1')   // matches "LoRA 1" + "LoRA 10".."LoRA 19" = 11
  assert.match(s.lastText(), /Search “LoRA 1”/)
  const picks = cb(s.lastKb()).filter(d => d.startsWith('bul:mod.pick:'))
  assert.equal(picks.length, 8, 'first page of 11 matches')
  assert.ok(!cb(s.lastKb()).includes('bul:mod.basefilter'), 'no base filter on flat search results')
})

test('mod.detail opens the card; back returns to the list; mod.detailadd queues + closes', async () => {
  const deps = { ...catalogDeps(), fetchDetail: async (id: string) => ({ intellaId: id, nomen: id === 'intella.flux' ? 'FLUX' : 'SDXL', genus: 'model' as const, mount: 'checkpoints', sizeGb: 6.5, provenance: 'miladystation' }) }
  const { s, m } = await modOpen(deps)
  await m.handleControl(456, '123', 'mod.add')
  await m.handleControl(456, '123', 'mod.cat:checkpoints')
  const detailId = cb(s.lastKb()).map(d => d.slice(4)).find(a => a.startsWith('mod.detail:') && a.endsWith(':0'))!
  await m.handleControl(456, '123', detailId)   // tap FLUX's name
  assert.match(s.lastText(), /FLUX/)
  assert.match(s.lastText(), /Type: checkpoints/)
  assert.ok(cb(s.lastKb()).includes('bul:mod.detailadd') && !cb(s.lastKb()).some(d => d.startsWith('bul:mod.pick:')), 'card, not list')

  await m.handleControl(456, '123', 'submenu.back')   // card → list
  assert.ok(cb(s.lastKb()).some(d => d.startsWith('bul:mod.detail:')), 'back on the list')

  const detailId2 = cb(s.lastKb()).map(d => d.slice(4)).find(a => a.startsWith('mod.detail:') && a.endsWith(':0'))!
  await m.handleControl(456, '123', detailId2)
  await m.handleControl(456, '123', 'mod.detailadd')
  assert.deepEqual([...m.pendingModelsFor(456)].map(p => p.intellaId), ['intella.flux'], 'added from the card')
  assert.ok(!cb(s.lastKb()).some(d => d.startsWith('bul:mod.detail')), 'picker closed after add')
})

test('opening Mod • fetches the loadout and shows it as the body', async () => {
  const loadout = { image: 'stationthis/flux-comfyui:v1', runtime: 'ComfyUI', categories: [{ architectura: 'unet', bases: [{ nomen: 'FLUX1-dev', loras: ['petravoice'] }] }] }
  // modOpen sends 'mod' last; with fetchLoadout wired, the loadout fills the body on open.
  const { s } = await modOpen({ fetchLoadout: async () => loadout })
  await tick(0)   // let the lazy fetch's .then resolve + re-render
  assert.match(s.lastText(), /Image: stationthis\/flux-comfyui:v1/)
  assert.match(s.lastText(), /unet\n {2}FLUX1-dev\n {4}LoRA\n {6}petravoice/)
})

test('clearPendingFor empties the queued loadout', async () => {
  const { s, m } = await modOpen(catalogDeps())
  await m.handleControl(456, '123', 'mod.add')
  await m.handleControl(456, '123', 'mod.cat:checkpoints')
  await m.handleControl(456, '123', pickAction(s.lastKb(), 0))
  assert.equal(m.pendingModelsFor(456).length, 1)
  m.clearPendingFor(456)
  assert.equal(m.pendingModelsFor(456).length, 0)
})

// ── /arm — preset-first wizard (preset → models, or Custom → image → config) ─

const armDeps = () => ({
  ...catalogDeps(),
  listPresets: async () => [
    { id: 'intella.flux-base', label: 'FLUX', blurb: 'FLUX flow.', models: ['FLUX.1 Schnell'], config: 'ComfyUI', image: 'PyTorch 2.4' },
    { id: 'custom', label: 'Custom' },
  ],
  listImages: async () => ['img-a'],
  listConfigs: async () => ['ComfyUI'],
})

test('/arm leads with presets; adding a flow stays on the chooser, then Proceed → Mod • menu', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, autoSettleMs: 30, ...armDeps() })
  await m.arm(456, '123')
  assert.ok(cb(s.lastKb()).includes('bul:arm.preset:0'), 'preset step shown first')
  assert.match(s.lastText(), /choose a flow/)
  assert.ok(!cb(s.lastKb()).includes('bul:arm.proceed'), 'no Proceed until a flow is added')
  await tick(60)   // past auto-settle — nothing churns/reaps
  await m.handleControl(456, '123', 'arm.preset:0')   // FLUX ＋ → stays on the chooser
  assert.ok(cb(s.lastKb()).includes('bul:arm.preset:0'), 'still on the chooser — can add more flows')
  assert.ok(cb(s.lastKb()).includes('bul:arm.proceed'), 'Proceed appears once a flow is added')
  await m.handleControl(456, '123', 'arm.proceed')    // forward → Mod • menu
  assert.ok(cb(s.lastKb()).includes('bul:mod.add'), 'Proceed → Mod • menu')
})

test('flows stack: add FLUX + Custom, both layered into one loadout, surfaced on the chooser', async () => {
  const s = makeSink()
  const deps = { ...armDeps(), listPresets: async () => [
    { id: 'intella.flux-base', label: 'FLUX', models: ['FLUX.1 Schnell'], config: 'ComfyUI' },
    { id: 'intella.sdxl-base', label: 'SDXL', models: ['SDXL base 1.0'], config: 'ComfyUI' },
  ] }
  const m = new BulletinManager({ sink: s.sink, ...deps })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:0')   // + FLUX
  await m.handleControl(456, '123', 'arm.preset:1')   // + SDXL — stays, layered
  assert.match(s.lastText(), /Added: FLUX, SDXL/, 'both flows surfaced on the chooser')
  await m.handleControl(456, '123', 'arm.proceed')
  const body = s.lastText()
  assert.match(body, /FLUX\.1 Schnell/, 'FLUX base in the loadout')
  assert.match(body, /SDXL base 1\.0/, 'SDXL base also in the loadout')
})

test('a studio is one runtime — a cross-runtime flow is rejected with a notice, not stacked', async () => {
  const deps = { ...armDeps(), listPresets: async () => [
    { id: 'flux', label: 'FLUX', models: ['FLUX.1 Schnell'], config: 'ComfyUI', image: 'PyTorch 2.4' },
    { id: 'smollm', label: 'SmolLM2', models: ['SmolLM2 135M'], config: 'llama.cpp', image: 'llama.cpp server' },
  ] }
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...deps })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:0')   // + FLUX (ComfyUI)
  await m.handleControl(456, '123', 'arm.preset:1')   // + SmolLM2 (llama.cpp) → conflict
  assert.match(s.lastText(), /This studio runs ComfyUI/, 'rejection notice shown')
  assert.match(s.lastText(), /llama\.cpp/, 'names the runtime the flow needs')
  await m.handleControl(456, '123', 'arm.proceed')
  assert.match(s.lastText(), /FLUX\.1 Schnell/, 'FLUX stayed in the loadout')
  assert.doesNotMatch(s.lastText(), /SmolLM2/, 'the conflicting flow was not added')
})

test('same-runtime flows still stack (two ComfyUI flows)', async () => {
  const deps = { ...armDeps(), listPresets: async () => [
    { id: 'flux', label: 'FLUX', models: ['FLUX.1 Schnell'], config: 'ComfyUI', image: 'PyTorch 2.4' },
    { id: 'sdxl', label: 'SDXL', models: ['SDXL base 1.0'], config: 'ComfyUI', image: 'PyTorch 2.4' },
  ] }
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...deps })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:0')
  await m.handleControl(456, '123', 'arm.preset:1')
  assert.match(s.lastText(), /Added: FLUX, SDXL/, 'both stack — same runtime, no conflict')
})

test('the flow chooser lays out like the model list — name → detail, ＋ → commit; Custom is single', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...armDeps() })
  await m.arm(456, '123')
  const kb = cb(s.lastKb())
  assert.ok(kb.includes('bul:arm.flow:0'), 'FLUX name opens its detail card')
  assert.ok(kb.includes('bul:arm.preset:0'), 'FLUX ＋ commits the flow directly')
  assert.ok(kb.includes('bul:arm.preset:1'), 'Custom is a single commit button')
  assert.ok(!kb.includes('bul:arm.flow:1'), 'Custom has no detail card')
  assert.ok(kb.includes('bul:arm.cancel') && !kb.includes('bul:arm.back'), 'first layer offers Cancel, not Back')
})

test('a flow detail card shows what it bundles; Add returns to the chooser with it added', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...armDeps() })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.flow:0')    // open FLUX detail
  assert.match(s.lastText(), /FLUX\.1 Schnell/, 'detail lists the bundled model')
  assert.ok(cb(s.lastKb()).includes('bul:arm.flowadd'), 'detail offers Add this flow')
  assert.ok(cb(s.lastKb()).includes('bul:arm.back'), 'detail backs to the chooser')
  await m.handleControl(456, '123', 'arm.flowadd')   // add → back to chooser
  assert.ok(cb(s.lastKb()).includes('bul:arm.flow:0'), 'lands back on the chooser to layer more')
  assert.ok(cb(s.lastKb()).includes('bul:arm.proceed'), 'Proceed available once added')
  await m.handleControl(456, '123', 'arm.proceed')
  assert.ok(cb(s.lastKb()).includes('bul:mod.add'), 'Proceed lands in the Mod • menu')
})

test('committing a flow renders the resolved spec (image + runtime + models) like a Custom build', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...armDeps() })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:0')   // FLUX ＋
  await m.handleControl(456, '123', 'arm.proceed')    // → Mod • menu
  const body = s.lastText()
  assert.match(body, /Runtime: ComfyUI/, 'config shows as the runtime')
  assert.match(body, /FLUX\.1 Schnell/, 'the bundled base model is listed')
  assert.doesNotMatch(body, /No models installed/, 'a flow lands pre-filled, not empty')
})

test('Custom config lands on the same spec view (image + runtime, models added after)', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...armDeps() })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:1')   // Custom → image
  await m.handleControl(456, '123', 'arm.image:0')    // → config
  await m.handleControl(456, '123', 'arm.config:0')   // → Mod • menu
  const body = s.lastText()
  assert.match(body, /Image: img-a/, 'the chosen image shows')
  assert.match(body, /Runtime: ComfyUI/, 'the chosen config shows as runtime')
})

test('cancel from the first layer dismisses cleanly — "cancelled", never "Pod shut down"', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...armDeps() })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.cancel')
  assert.equal(cb(s.lastKb()).length, 0, 'the /arm wizard is dismissed')
  assert.match(s.lastText(), /cancel/i, 'reads as cancelled')
  assert.doesNotMatch(s.lastText(), /shut down/i, 'never a pod shut-down — no pod ever existed')
})

test('Custom after a flow skips the image chooser (image is fixed) → straight to config', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...armDeps() })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:0')   // + FLUX (fixes the image)
  await m.handleControl(456, '123', 'arm.preset:1')   // Custom → should SKIP image
  assert.ok(cb(s.lastKb()).includes('bul:arm.config:0'), 'lands on the config step, not the image step')
  assert.ok(!cb(s.lastKb()).includes('bul:arm.image:0'), 'image chooser is skipped — a studio is one image')
  await m.handleControl(456, '123', 'arm.back')       // back from config → chooser, not the skipped image step
  assert.ok(cb(s.lastKb()).includes('bul:arm.preset:0'), 'back skips the absent image step, returns to the chooser')
})

test('/arm Custom → image → config → models', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...armDeps() })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:1')   // Custom
  assert.ok(cb(s.lastKb()).includes('bul:arm.image:0'), 'Custom → image step')
  await m.handleControl(456, '123', 'arm.image:0')
  assert.ok(cb(s.lastKb()).includes('bul:arm.config:0'), 'config step')
  await m.handleControl(456, '123', 'arm.config:0')
  assert.ok(cb(s.lastKb()).includes('bul:mod.add'), 'lands in the Mod • menu')
})

test('/arm preset auto-scopes the LoRA list to the preset base family', async () => {
  // listMount echoes the requested baseFilter so we can assert the scope reached it.
  const seen: Array<string | undefined> = []
  const deps = { ...armDeps(), listMount: async (mount: string, opts: { baseFilter?: string }) => { if (mount === 'loras') seen.push(opts.baseFilter); return mount === 'loras' ? { items: LORAS, baseFamilies: [{ id: '', label: 'All' }, { id: 'intella.flux-base', label: 'FLUX' }], baseFilter: opts.baseFilter ?? '' } : { items: CHECKPOINTS } } }
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...deps })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:0')   // + FLUX → armBase = intella.flux-base
  await m.handleControl(456, '123', 'arm.proceed')    // → Mod • menu
  await m.handleControl(456, '123', 'mod.add')
  await m.handleControl(456, '123', 'mod.cat:loras')
  assert.deepEqual(seen, ['intella.flux-base'], 'loras opened scoped to the preset base, not All')
})

test('/arm back walks config → image → preset → dismiss', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...armDeps() })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:1')   // Custom → image
  await m.handleControl(456, '123', 'arm.image:0')    // → config
  await m.handleControl(456, '123', 'arm.back')       // config → image
  assert.ok(cb(s.lastKb()).includes('bul:arm.image:0'), 'back at the image step')
  await m.handleControl(456, '123', 'arm.back')       // image → preset
  assert.ok(cb(s.lastKb()).includes('bul:arm.preset:0'), 'back at the preset step')
  await m.handleControl(456, '123', 'arm.back')       // preset → dismiss
  assert.equal(cb(s.lastKb()).length, 0, '/arm menu dismissed')
})

test('back from the Mod • menu of an armed studio returns to the flow chooser (layer another flow)', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...armDeps() })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:0')   // + FLUX
  await m.handleControl(456, '123', 'arm.proceed')    // → Mod • menu
  // queue a model so we can prove the loadout survives the hop back to the chooser
  await m.handleControl(456, '123', 'mod.add')
  await m.handleControl(456, '123', 'mod.cat:checkpoints')
  await m.handleControl(456, '123', pickAction(s.lastKb(), 0))
  await m.handleControl(456, '123', 'submenu.back')   // list → categories
  await m.handleControl(456, '123', 'submenu.back')   // categories → Mod • menu
  await m.handleControl(456, '123', 'submenu.back')   // Mod • → flow chooser (not the top-3)
  assert.ok(cb(s.lastKb()).includes('bul:arm.preset:0'), 'back from Mod • re-opens the flow + Custom chooser')
  assert.equal(m.pendingModelsFor(456).length, 1, 'the queued loadout survives the hop back')
})

test('▸ Start immediately shows "provisioning…" (not the armed copy) while the cold start runs', async () => {
  const s = makeSink()
  let release!: () => void
  const gate = new Promise<{ podId: string }>(r => { release = () => r({ podId: 'studio-x' }) })
  const m = new BulletinManager({ sink: s.sink, ...armDeps(), startStudio: () => gate })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:0')
  await m.handleControl(456, '123', 'arm.proceed')
  const pending = m.handleControl(456, '123', 'mod.start')   // do NOT await the full provision
  await tick(5)
  assert.match(s.lastText(), /Provisioning/, 'shows provisioning the instant Start is pressed')
  assert.doesNotMatch(s.lastText(), /add models, then/, 'not the armed "press Start" copy anymore')
  release()
  await pending
  assert.doesNotMatch(s.lastText(), /Provisioning/, 'flips off provisioning once the pod parks warm')
})

test('Destroy during provisioning kills the provisioned pod (no orphan billing)', async () => {
  const s = makeSink()
  const terminated: string[] = []
  let release!: () => void
  const gate = new Promise<{ podId: string }>(r => { release = () => r({ podId: 'studio-orphan' }) })
  const m = new BulletinManager({ sink: s.sink, ...armDeps(), startStudio: () => gate, terminatePod: async (p: string) => { terminated.push(p) } })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:0')
  await m.handleControl(456, '123', 'arm.proceed')
  const pending = m.handleControl(456, '123', 'mod.start')   // provisioning in flight
  await tick(5)
  await m.handleControl(456, '123', 'destroy.now')           // cancel mid-provision → session ends
  release()                                                  // provision finishes into a dead session
  await pending
  assert.deepEqual(terminated, ['studio-orphan'], 'the orphaned pod is terminated promptly, not left to the reaper')
})

test('a failed Start leaves the studio reading "armed", never the warm "keep cooking" nudge', async () => {
  const s = makeSink()
  const m = new BulletinManager({
    sink: s.sink, ...armDeps(),
    startStudio: async () => null,   // provision failed → no pod bound
  })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:0')   // + FLUX
  await m.handleControl(456, '123', 'arm.proceed')    // → Mod • menu
  await m.handleControl(456, '123', 'mod.start')      // attempt → fails → activeSubmenu null, still armed
  assert.match(s.lastText(), /armed/i, 'a pod-less armed studio says it is armed')
  assert.doesNotMatch(s.lastText(), /keep cooking/i, 'does not imply a warm pod is resting')
})

test('/arm Start provisions a warm studio without a gen, then hides Start', async () => {
  const s = makeSink()
  const provisioned: Array<{ models: unknown[] }> = []
  const m = new BulletinManager({
    sink: s.sink, ...armDeps(),
    startStudio: async (_c: number, opts: { models: unknown[] }) => {
      provisioned.push(opts)
      return { podId: 'studio-1', gpuType: 'RTX 4090', costPerHr: 0.69, provisionMs: 20_000 }
    },
  })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:0')   // + FLUX
  await m.handleControl(456, '123', 'arm.proceed')    // → Mod • menu
  assert.ok(cb(s.lastKb()).includes('bul:mod.start'), 'an armed, pod-less studio offers Start')
  // build a one-model loadout, then walk back to the Mod • menu and launch
  await m.handleControl(456, '123', 'mod.add')
  await m.handleControl(456, '123', 'mod.cat:checkpoints')
  await m.handleControl(456, '123', pickAction(s.lastKb(), 0))
  await m.handleControl(456, '123', 'submenu.back')   // list → categories
  await m.handleControl(456, '123', 'submenu.back')   // categories → Mod • menu
  await m.handleControl(456, '123', 'mod.start')
  assert.equal(provisioned.length, 1, 'provisioner invoked exactly once')
  assert.equal(provisioned[0].models.length, 1, 'the queued loadout is handed to the provisioner')
  assert.equal(m.pendingModelsFor(456).length, 0, 'pending loadout consumed on launch')
  await m.handleControl(456, '123', 'mod')            // reopen Mod •
  assert.ok(!cb(s.lastKb()).includes('bul:mod.start'), 'Start gone once a pod is bound')
})

test('armed Mod • menu offers a warm-window stepper; the chosen window flows to Start', async () => {
  const s = makeSink()
  let startedWarmMs: number | undefined
  const m = new BulletinManager({ sink: s.sink, ...armDeps(), startStudio: async (_c, opts) => { startedWarmMs = opts.warmMs; return { podId: 'p1' } } })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:0')
  await m.handleControl(456, '123', 'arm.proceed')
  const kb = cb(s.lastKb())
  assert.ok(kb.includes('bul:mod.start'), 'Start offered')
  assert.ok(kb.includes('bul:dec') && kb.includes('bul:inc'), 'warm-window stepper present in the armed menu')
  assert.ok(s.lastKb().flat().some(b => /warm:/.test(b.label)), 'shows the warm window label')
  await m.handleControl(456, '123', 'inc')           // bump the window up
  await m.handleControl(456, '123', 'mod.start')
  assert.equal(typeof startedWarmMs, 'number', 'the host-chosen warm window is passed to provisioning')
})

test('a /make session never offers Start (only armed studios do)', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...armDeps() })
  m.register(456, 'a1', '123')
  await m.handleControl(456, '123', 'confirm')
  await m.handleControl(456, '123', 'mod')
  assert.ok(!cb(s.lastKb()).includes('bul:mod.start'), 'a /make session is gen-provisioned, never armed-Start')
})

test('a loadout built via /arm carries into the next /make (the live session is reused)', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, ...armDeps() })
  await m.arm(456, '123')
  await m.handleControl(456, '123', 'arm.preset:0')   // + FLUX
  await m.handleControl(456, '123', 'arm.proceed')    // → model menu
  await m.handleControl(456, '123', 'mod.add')
  await m.handleControl(456, '123', 'mod.cat:checkpoints')
  await m.handleControl(456, '123', pickAction(s.lastKb(), 0))
  assert.equal(m.pendingModelsFor(456).length, 1, 'queued via the armed session')
  m.register(456, 'a1', '123')   // /make on the same chat reuses the live armed session
  assert.equal(m.pendingModelsFor(456).length, 1, 'pending loadout survives into the gen')
})

// ── Render serialization (TASK-011) ──────────────────────────────────────────
// A deferred sink: every edit/post records its text + call order and returns a promise
// the test resolves by hand, so we can observe how many renders are in flight at once.
function makeDeferredSink() {
  const calls: Array<{ kind: 'post' | 'edit'; text: string; resolve: () => void }> = []
  let inFlight = 0
  let maxInFlight = 0
  let nextId = 100
  const enqueue = (kind: 'post' | 'edit', text: string): Promise<void> => {
    inFlight += 1
    maxInFlight = Math.max(maxInFlight, inFlight)
    return new Promise<void>(res => {
      calls.push({ kind, text, resolve: () => { inFlight -= 1; res() } })
    })
  }
  const sink: BulletinSink = {
    async post(_chatId, text) { await enqueue('post', text); return ++nextId },
    async edit(_chatId, _messageId, text) { await enqueue('edit', text) },
    async remove() {},
  }
  return {
    sink, calls,
    pending: () => inFlight,
    maxInFlight: () => maxInFlight,
  }
}

test('renders are serialized per chat — at most one sink edit in flight, stages land in order', async () => {
  const d = makeDeferredSink()
  const m = new BulletinManager({ sink: d.sink })

  // register posts the setup bulletin (deferred). Resolve it so a messageId is set.
  m.register(456, 'a1', '123')
  assert.equal(d.pending(), 1, 'register issued exactly one post')
  assert.equal(d.calls[0].kind, 'post')
  d.calls[0].resolve()
  await tick(0)

  // The three provisioning stages. In production they arrive across real awaits; the bug was that
  // their concurrent, un-awaited renders could land out of order under sink latency. We drive them
  // through the deferred sink and prove (a) at most one edit is ever in flight, and (b) the sink
  // receives the stage texts in stage order — the scramble cannot happen.
  // The provisioning play-by-play, with DISTINCT rendered frames (so none dedupes away):
  // pod-locked (commits the Found line + Initializing) → downloading 1/3 → downloading 2/3.
  // (`provisioning` is silent in the /make path — hunting renders no journal line — so it would
  // dedupe against the setup frame; we drive the visible, ordered stages.)
  stage(m, 'a1', 'provisioning')   // silent hunt — no frame change
  const stages: Array<() => void> = [
    () => stage(m, 'a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 }),
    () => stage(m, 'a1', 'downloading:1/3'),
    () => stage(m, 'a1', 'downloading:2/3'),
  ]

  const order: string[] = []
  let i = 1   // calls[0] was the register post (already resolved)
  stages[0]()
  for (let step = 0; step < stages.length; step++) {
    // This stage's render begins and calls the sink (then blocks on the deferred edit).
    while (d.calls.length <= i) await tick(0)
    assert.equal(d.pending(), 1, `exactly one render in flight at step ${step} (serialized)`)

    // While this edit is unresolved, fire the NEXT stage — its render must NOT issue a sink call
    // (it is chained behind the in-flight one), proving serialization.
    if (step + 1 < stages.length) {
      stages[step + 1]()
      await tick(0); await tick(0)
      assert.equal(d.calls.length, i + 1, `the next stage's edit is NOT requested until the prior resolves (step ${step})`)
      assert.equal(d.pending(), 1, `still exactly one in flight after the next stage is queued (step ${step})`)
    }

    order.push(d.calls[i].text)
    d.calls[i].resolve()   // → the chained next-stage render now starts
    i += 1
  }
  await tick(0); await tick(0)
  assert.equal(order.length, stages.length, 'every stage rendered exactly once, in order')
  assert.equal(d.maxInFlight(), 1, 'never more than one sink call in flight at any time')

  // Delivered in stage order: pod-locked (Found + Initializing) → downloading 1/3 → downloading 2/3.
  // No earlier frame overtakes a later one.
  assert.match(order[0], /Found RTX 4090 for \$0\.69\/hr/, 'first frame is the Found (pod-locked) state')
  assert.match(order[0], /Initializing/, 'pod-locked frame is initializing')
  assert.match(order[1], /downloading models \(1\/3\)/, 'second frame is downloading 1/3')
  assert.match(order[2], /downloading models \(2\/3\)/, 'third frame is downloading 2/3')
  assert.match(order[2], /Found RTX 4090/, 'the committed Found line persists into the final frame')

  // Tear down the chat so the hop-to-bottom renew timer (armed by the register post) doesn't
  // outlive the test, and resolve any final receipt edit it queues.
  void m.handleControl(456, '123', 'destroy.now')   // cancelAll() kills the renew timer
  await tick(0)
  for (const c of d.calls) c.resolve()
})

test('an awaited register path still lands a final render through the serialized wrapper', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink })
  m.register(456, 'a1', '123')
  await tick(0)
  assert.equal(s.posts.length, 1, 'register posted the bulletin')
  assert.match(s.lastText(), /Set how long to keep the pod warm/)
})

// ── #6b: the bulletin is driven by the owned actum.progressus (single source) ────────────────

const prog = (p: Omit<import('../../../../src/types/progressus.js').Progressus, 'at'>) => ({ ...p, at: new Date(0) })

test('onProgressus drives the journal exactly as onStage does (owned vocabulary)', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink })
  m.register(456, 'a1', '123')
  m.onProgressus('a1', prog({ phase: 'provisioning', message: 'acquiring GPU' }))
  m.onProgressus('a1', prog({ phase: 'provisioning', message: 'pod p', pod: { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 } }))
  await tick(0)
  assert.match(s.lastText(), /Found RTX 4090 for \$0\.69\/hr/, 'cold Found line from the provisioning→pod-locked progressus')
  assert.match(s.lastText(), /Initializing/)
})

test('gen-path race: progressus that arrives BEFORE register is buffered + replayed in order', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink })
  m.onProgressus('a1', prog({ phase: 'provisioning', message: 'acquiring GPU' }))
  m.onProgressus('a1', prog({ phase: 'provisioning', message: 'pod p', pod: { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 } }))
  m.register(456, 'a1', '123')   // replays the buffered progressus in order
  await tick(0)
  assert.match(s.lastText(), /Found RTX 4090 for \$0\.69\/hr/, 'cold Found line from the replayed progressus')
  assert.match(s.lastText(), /Initializing/, 'prep — NOT a warm "generating"')
  assert.doesNotMatch(s.lastText(), /keep cooking/i)
})
