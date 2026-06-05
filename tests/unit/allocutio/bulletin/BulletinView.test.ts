import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BulletinView, type BulletinSnapshot } from '../../../../src/allocutio/lexicon/bulletin/BulletinView.js'
import { WARM_DEFAULT_MS, type BulletinKeyboard } from '../../../../src/allocutio/lexicon/bulletin/types.js'

const base: BulletinSnapshot = {
  journal: [], live: null,
  ledger: { genCount: 0, totalCostUsd: 0, avgCostUsd: 0, avgExecMs: 0, hasCost: false, hasExec: false },
  warmTtlMs: WARM_DEFAULT_MS, confirmed: false, ended: false, audience: 'host',
  activeSubmenu: null, pendingModels: [], installing: [],
  canStart: false, starting: false, everHadPod: false, cancelled: false,
}
const cb = (kb: BulletinKeyboard) => kb.flat().map(b => b.data)

test('setup state: empty journal shows the warm prompt + stepper/confirm keyboard', () => {
  const { text, keyboard } = BulletinView.render(base)
  assert.match(text, /Set how long to keep the pod warm/)
  assert.deepEqual(cb(keyboard).sort(), ['bul:confirm', 'bul:dec', 'bul:inc', 'bul:noop'].sort())
})

test('Found line carries short GPU + rate; no vendor noise', () => {
  const { text } = BulletinView.render({
    ...base, journal: [{ kind: 'found', gpu: 'NVIDIA GeForce RTX 4090', rate: 0.69, ms: 30_000 }],
    live: { kind: 'initializing' },
  })
  assert.match(text, /Found RTX 4090 for \$0\.69\/hr in 30s/)
  assert.match(text, /Initializing/)
  assert.ok(!/NVIDIA|GeForce/.test(text))
})

test('downloading live line shows n/m and the slow annotation', () => {
  const { text } = BulletinView.render({ ...base, live: { kind: 'downloading', n: 3, m: 4, slow: true } })
  assert.match(text, /Connected, downloading models \(3\/4\)… — taking longer than usual/)
})

test('prepared line renders the % vs the typical baseline', () => {
  // 4.5m of a 7m typical → ~36% under avg.
  const { text } = BulletinView.render({ ...base, journal: [{ kind: 'prepared', ms: 4.5 * 60_000 }], live: { kind: 'generating' } })
  assert.match(text, /Prepared Make Setup in 4\.5m \(36% < avg\)/)
})

test('confirmed idle: stat line + nudge with marginal cost; top-3 [Mod] [Share] [Destroy]', () => {
  const { text, keyboard } = BulletinView.render({
    ...base, confirmed: true, rateUsdPerHr: 0.69,
    journal: [{ kind: 'found', gpu: 'RTX 4090', rate: 0.69, ms: 30_000 }],
    ledger: { genCount: 1, totalCostUsd: 0.08, avgCostUsd: 0.08, avgExecMs: 12_000, hasCost: true, hasExec: true },
  })
  assert.match(text, /1 gen · exec ~12s avg · \$0\.080 ea · \$0\.08 total/)
  assert.match(text, /next gen ~\$0\.005 — keep cooking/)
  assert.deepEqual(cb(keyboard).sort(), ['bul:destroy', 'bul:mod', 'bul:share'].sort())
})

test('destroy submenu renders Now / Drain / ← Back', () => {
  const { keyboard } = BulletinView.render({ ...base, confirmed: true, activeSubmenu: 'destroy' })
  assert.deepEqual(cb(keyboard).sort(), ['bul:destroy.drain', 'bul:destroy.now', 'bul:submenu.back'].sort())
})

test('share submenu renders Copy link / Forward / ← Back', () => {
  const { keyboard } = BulletinView.render({ ...base, confirmed: true, activeSubmenu: 'share' })
  assert.deepEqual(cb(keyboard).sort(), ['bul:share.copy', 'bul:share.forward', 'bul:submenu.back'].sort())
})

test('mod body IS the loadout: image / runtime / bases by architectura with LoRAs nested', () => {
  const { text, keyboard } = BulletinView.render({
    ...base, confirmed: true, activeSubmenu: 'mod',
    loadout: {
      image: 'stationthis/flux-comfyui:v1',
      runtime: 'ComfyUI',
      categories: [
        { architectura: 'unet', bases: [
          { nomen: 'FLUX1-dev', loras: ['petravoice', 'ps2'] },
          { nomen: 'FLUX1-schnell', loras: [] },
        ] },
        { architectura: 'gguf', bases: [{ nomen: 'qwen3.6-abliterated:27b_Q4', loras: [] }] },
      ],
    },
  })
  assert.deepEqual(cb(keyboard).sort(), ['bul:mod.add', 'bul:submenu.back'].sort())
  assert.match(text, /Image: stationthis\/flux-comfyui:v1/)
  assert.match(text, /Runtime: ComfyUI/)
  // unet(0) ▸ base(2sp) ▸ LoRA(4sp) ▸ lora name(6sp); a base with no loras has no subsection.
  assert.match(text, /unet\n {2}FLUX1-dev\n {4}LoRA\n {6}petravoice\n {6}ps2\n {2}FLUX1-schnell/)
  assert.match(text, /gguf\n {2}qwen3\.6-abliterated:27b_Q4/)
  assert.ok(!/keep cooking/i.test(text), 'normal HUD body is replaced')
})

test('loose LoRAs (base not installed) fall to a flat section at the end', () => {
  const { text } = BulletinView.render({
    ...base, confirmed: true, activeSubmenu: 'mod',
    loadout: { categories: [{ architectura: 'unet', bases: [{ nomen: 'FLUX1-dev', loras: [] }] }], looseLoras: ['orphan-lora'] },
  })
  assert.match(text, /LoRA\n {2}orphan-lora/)
})

test('mod loadout with nothing installed shows the empty note', () => {
  const { text } = BulletinView.render({
    ...base, confirmed: true, activeSubmenu: 'mod',
    loadout: { image: 'stationthis/flux-comfyui:v1', runtime: 'ComfyUI', categories: [] },
  })
  assert.match(text, /No models installed on this studio yet\./)
})

test('mod body shows the queued tail when models are pending', () => {
  const { text } = BulletinView.render({
    ...base, confirmed: true, activeSubmenu: 'mod',
    pendingModels: [
      { intellaId: 'intella.milady', nomen: 'Milady', genus: 'lora' },
      { intellaId: 'intella.retro', nomen: 'Retro', genus: 'lora' },
    ],
  })
  assert.match(text, /Standby: Milady, Retro/)
})

test('mod body shows the "Installing…" tail for models downloading onto a warm pod', () => {
  const { text } = BulletinView.render({
    ...base, confirmed: true, activeSubmenu: 'mod',
    installing: [{ intellaId: 'intella.sdxl', nomen: 'SDXL', genus: 'model' }],
  })
  assert.match(text, /Installing: SDXL…/)
})

test('category stage renders mount buttons + Search + Back, with the pick-a-type header', () => {
  const { text, keyboard } = BulletinView.render({
    ...base, confirmed: true, activeSubmenu: 'mod',
    picker: { stage: 'categories', categories: ['loras', 'unet'], items: [], page: 0, pageCount: 0, token: 0 },
  })
  const data = cb(keyboard)
  assert.ok(data.includes('bul:mod.cat:loras') && data.includes('bul:mod.cat:unet'))
  assert.ok(data.includes('bul:mod.search') && data.includes('bul:submenu.back'))
  assert.match(text, /Add a model — pick a type/)
})

test('list stage renders item buttons + nav/back + base filter, with the mount header', () => {
  const { text, keyboard } = BulletinView.render({
    ...base, confirmed: true, activeSubmenu: 'mod',
    picker: {
      stage: 'list', mount: 'loras', categories: [], baseFamilies: [{ id: '', label: 'All bases (2)' }, { id: 'intella.flux', label: 'FLUX (2)' }], baseFilter: '',
      items: [
        { intellaId: 'intella.a', nomen: 'petravoice', genus: 'lora' },
        { intellaId: 'intella.b', nomen: 'ps2', genus: 'lora' },
      ],
      page: 0, pageCount: 2, token: 3,
    },
  })
  const data = cb(keyboard)
  assert.ok(data.includes('bul:mod.pick:3:0') && data.includes('bul:mod.pick:3:1'))
  assert.ok(data.includes('bul:mod.basefilter'), 'base filter shown for the LoRA mount')
  assert.ok(data.includes('bul:mod.search') && data.includes('bul:mod.page:next') && data.includes('bul:submenu.back'))
  assert.match(text, /loras · page 1\/2/)
})

test('arm wizard renders the image step then the config step, taking over the body', () => {
  const image = BulletinView.render({
    ...base, confirmed: true,
    arm: { step: 'image', images: ['runpod/pytorch:2.4.0-cuda12.4'], configs: [] },
  })
  assert.match(image.text, /pick an image/)
  assert.ok(cb(image.keyboard).includes('bul:arm.image:0') && cb(image.keyboard).includes('bul:arm.back'))

  const config = BulletinView.render({
    ...base, confirmed: true,
    arm: { step: 'config', images: ['x'], image: 'runpod/pytorch:2.4.0-cuda12.4', configs: ['ComfyUI'] },
  })
  assert.match(config.text, /Image: runpod\/pytorch:2\.4\.0-cuda12\.4/)
  assert.match(config.text, /Pick a runtime/)
  assert.ok(cb(config.keyboard).includes('bul:arm.config:0'))
})

test('detail stage renders the model card (name + structural fields + description)', () => {
  const { text, keyboard } = BulletinView.render({
    ...base, confirmed: true, activeSubmenu: 'mod',
    picker: {
      stage: 'detail', categories: [], items: [], page: 0, pageCount: 0, token: 0,
      detail: { intellaId: 'intella.milady', nomen: 'Milady', genus: 'lora', mount: 'loras', base: 'FLUX.1 Schnell', trigger: 'milady', sizeGb: 0.2, provenance: 'civitai', description: 'A nice lora.' },
    },
  })
  assert.ok(cb(keyboard).includes('bul:mod.detailadd'))
  assert.match(text, /Milady/)
  assert.match(text, /Type: loras/)
  assert.match(text, /Base: FLUX\.1 Schnell/)
  assert.match(text, /Trigger: milady/)
  assert.match(text, /A nice lora\./)
})

test('empty list shows the empty note; a search list shows the query in the header', () => {
  const empty = BulletinView.render({
    ...base, confirmed: true, activeSubmenu: 'mod',
    picker: { stage: 'list', mount: 'loras', categories: [], items: [], page: 0, pageCount: 0, token: 0 },
  })
  assert.match(empty.text, /No models available\./)

  const searched = BulletinView.render({
    ...base, confirmed: true, activeSubmenu: 'mod',
    picker: { stage: 'list', categories: [], items: [], page: 0, pageCount: 0, query: 'milady', token: 0 },
  })
  assert.match(searched.text, /No models match “milady”\./)
})

test('receipt with gens: "Session receipt ·" prefix and no keyboard', () => {
  const { text, keyboard } = BulletinView.render({
    ...base, ended: true,
    journal: [{ kind: 'found', gpu: 'RTX 4090', rate: 0.69, ms: 30_000 }],
    ledger: { genCount: 3, totalCostUsd: 0.09, avgCostUsd: 0.03, avgExecMs: 13_000, hasCost: true, hasExec: true },
  })
  assert.match(text, /Session receipt · 3 gens/)
  assert.equal(keyboard.length, 0)
})

test('receipt before any gen says "Pod shut down."', () => {
  const { text } = BulletinView.render({ ...base, ended: true, journal: [{ kind: 'found', gpu: 'RTX 4090', rate: 0.69, ms: 30_000 }] })
  assert.match(text, /Pod shut down\./)
})

test('bail journal: Quit line renders with pod number + reason', () => {
  const { text } = BulletinView.render({
    ...base, journal: [{ kind: 'quit', podNum: 1, reason: 'download throttle' }, { kind: 'found', gpu: 'RTX 4090', rate: 0.69, ms: 28_000 }],
    live: { kind: 'downloading', n: 2, m: 4, slow: false },
  })
  assert.match(text, /Quit pod 1 for download throttle/)
  assert.match(text, /Found RTX 4090 for \$0\.69\/hr in 28s/)
})
