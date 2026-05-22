import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BulletinView, type BulletinSnapshot } from '../../../../src/allocutio/lexicon/bulletin/BulletinView.js'
import { WARM_DEFAULT_MS, type BulletinKeyboard } from '../../../../src/allocutio/lexicon/bulletin/types.js'

const base: BulletinSnapshot = {
  journal: [], live: null,
  ledger: { genCount: 0, totalCostUsd: 0, avgCostUsd: 0, avgExecMs: 0, hasCost: false, hasExec: false },
  warmTtlMs: WARM_DEFAULT_MS, confirmed: false, ended: false, audience: 'host',
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

test('confirmed idle: stat line + nudge with marginal cost; confirmed keyboard', () => {
  const { text, keyboard } = BulletinView.render({
    ...base, confirmed: true, rateUsdPerHr: 0.69,
    journal: [{ kind: 'found', gpu: 'RTX 4090', rate: 0.69, ms: 30_000 }],
    ledger: { genCount: 1, totalCostUsd: 0.08, avgCostUsd: 0.08, avgExecMs: 12_000, hasCost: true, hasExec: true },
  })
  assert.match(text, /1 gen · exec ~12s avg · \$0\.080 ea · \$0\.08 total/)
  assert.match(text, /next gen ~\$0\.005 — keep cooking/)
  assert.deepEqual(cb(keyboard).sort(), ['bul:kill', 'bul:refresh', 'bul:time'].sort())
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
