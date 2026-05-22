import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BulletinManager, type BulletinSink } from '../../../../src/allocutio/bulletin/BulletinManager.js'
import type { BulletinKeyboard } from '../../../../src/allocutio/bulletin/types.js'

function makeSink() {
  const posts: Array<{ chatId: number; text: string; kb: BulletinKeyboard }> = []
  const edits: Array<{ chatId: number; messageId: number; text: string; kb: BulletinKeyboard }> = []
  const removed: number[] = []
  let nextId = 100
  const sink: BulletinSink = {
    async post(chatId, text, kb) { posts.push({ chatId, text, kb }); return ++nextId },
    async edit(chatId, messageId, text, kb) { edits.push({ chatId, messageId, text, kb }) },
    async remove(_chatId, messageId) { removed.push(messageId) },
  }
  const lastText = () => [...posts, ...edits].at(-1)?.text ?? ''
  const lastKb = () => [...posts, ...edits].at(-1)?.kb ?? []
  return { sink, posts, edits, removed, lastText, lastKb }
}
const tick = (ms: number) => new Promise(r => setTimeout(r, ms))
const cb = (kb: BulletinKeyboard) => kb.flat().map(b => b.data)

test('register posts the setup bulletin; stages drive the journal; complete shows stats', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink })
  m.register(456, 'a1', '123')
  assert.match(s.lastText(), /Set how long to keep the pod warm/)

  m.onStage('a1', 'provisioning', undefined)
  m.onStage('a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  assert.match(s.lastText(), /Found RTX 4090 for \$0\.69\/hr in 30s/)
  assert.match(s.lastText(), /Initializing/)

  m.onComplete('a1', { costUsd: 0.08, execMs: 12_000, podId: 'pod-1' })
  assert.match(s.lastText(), /1 gen · exec ~12s avg · \$0\.080 ea · \$0\.08 total/)
})

test('warm reuse on a live session does NOT add a second Found line', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink })
  m.register(456, 'a1', '123')
  m.onStage('a1', 'provisioning')
  m.onStage('a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  m.onComplete('a1', { costUsd: 0.08, execMs: 12_000, podId: 'pod-1' })

  // Second gen reuses the warm pod: register again, then a bare pod-locked (no hunt).
  m.register(456, 'a2', '123')
  m.onStage('a2', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69 })
  m.onComplete('a2', { costUsd: 0.005, execMs: 11_000, podId: 'pod-1' })

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
  m.onStage('a1', 'provisioning')
  m.onStage('a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })

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
  m.onStage('a1', 'provisioning')
  m.onStage('a1', 'pod-locked', { podId: 'pod-9', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  m.onReaped('pod-9')
  assert.equal(cb(s.lastKb()).length, 0, 'reaped → frozen, no buttons')
})

test('auto-settle flips the keyboard to confirmed after the window', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, autoSettleMs: 30 })
  m.register(456, 'a1', '123')
  assert.ok(cb(s.lastKb()).includes('bul:confirm'), 'setup keyboard before settle')
  await tick(60)
  assert.ok(cb(s.lastKb()).includes('bul:kill') && !cb(s.lastKb()).includes('bul:confirm'),
    'auto-settle flipped to the confirmed control row')
})

test('a fresh actum after a receipt opens a new bulletin (new message)', async () => {
  const s = makeSink()
  const m = new BulletinManager({ sink: s.sink, terminatePod: async () => {} })
  m.register(456, 'a1', '123')
  m.onStage('a1', 'provisioning')
  m.onStage('a1', 'pod-locked', { podId: 'pod-1', gpuType: 'RTX 4090', costPerHr: 0.69, phaseMs: 30_000 })
  await m.handleControl(456, '123', 'kill')   // receipt
  const postsBefore = s.posts.length

  m.register(456, 'a2', '123')                // new session → new post
  assert.equal(s.posts.length, postsBefore + 1, 'fresh bulletin is a new message')
})
