import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Vocator } from '../../../src/crystal/Vocator.js'
import { EconomyUnavailableError } from '../../../src/crystal/RunPodCursor.js'
import { MemoryLocorum } from '../../../src/execution/MemoryLocorum.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { MemoryModorum } from '../../../src/execution/MemoryModorum.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { ActumInceptor } from '../../../src/execution/ActumInceptor.js'
import { ActumCompletor } from '../../../src/execution/ActumCompletor.js'
import { dispatchInceptio } from '../../../src/execution/dispatchInceptio.js'
import { registerProgressusRecorder } from '../../../src/execution/progressusSink.js'
import type { Cursor, Cursorum, Inceptio } from '../../../src/types/cursus.js'
import type { Modus } from '../../../src/types/modus.js'
import type { Progressus } from '../../../src/types/progressus.js'

// The two runs in these tests both want the same substrate, which is what puts them
// in the same line. A run wanting a different image is in a different line entirely.
const IMAGE = 'stationthis/flux-comfyui:v1'
const TERMINUS_MS = 42 * 60 * 1000

// ---------------------------------------------------------------------------
// A rig: the real inceptor, ledger, completor and dispatch, around one fake pod
// ---------------------------------------------------------------------------
//
// Only the CURSOR is a double, and only in the one respect that matters here —
// whether a warm pod is available at the moment it looks. Everything the exit
// clauses talk about (the reservation, the refund, the actum's lifecycle) is the
// production code doing the real thing, so a test that says "refunded" is reading
// the ledger rather than a spy.

interface Rig {
  locorum: MemoryLocorum
  actorum: MemoryActorum
  signorum: MemorySignorum
  vocator: Vocator
  completor: ActumCompletor
  /** Flip to true to mean "a warm pod running IMAGE is idle right now". */
  podFree: { value: boolean }
  /** Every actum the cursor actually dispatched, in order. */
  dispatched: string[]
  /** Every `queued` report the progress rail carried, newest last. */
  reports: Array<{ actumId: string; progressus: Progressus }>
  /** Cast one run on the economy strategy, through the ordinary dispatch. */
  cast(animaId: string): Promise<string>
}

function makeModus(): Modus {
  return {
    id: 'flux-schnell', nomen: 'Flux Schnell', genus: 'atomicus',
    versio: '1.0.0', contentHash: 'abc123',
    aditus: { prompt: { type: 'text', required: true } },
    exitus: { image: { type: 'image' } },
    ministerium: 'runpod', canonica: true,
    natum: new Date(), mutatum: new Date(),
  }
}

async function makeRig(): Promise<Rig> {
  const podFree = { value: false }
  const dispatched: string[] = []
  const reports: Array<{ actumId: string; progressus: Progressus }> = []

  const modorum = new MemoryModorum()
  await modorum.register(makeModus())
  const actorum = new MemoryActorum()
  const signorum = new MemorySignorum()
  const locorum = new MemoryLocorum()

  const cursor: Cursor = {
    reserve: async () => 100n,
    terminus: async () => TERMINUS_MS,
    run: async (actum) => {
      // The one behaviour under test: an economy run refuses when the pool is empty.
      if (!podFree.value) throw new EconomyUnavailableError(IMAGE)
      // A pod serves one job — taking it empties the pool again.
      podFree.value = false
      dispatched.push(actum.id)
      return { kind: 'async', externusJobId: `job-${actum.id}` }
    },
  }
  const cursorum: Cursorum = { register: () => {}, resolve: () => cursor }

  const completor = new ActumCompletor({ acta: actorum, signorum })
  const inceptor = new ActumInceptor({ modorum, cursorum, signorum, acta: actorum })
  const vocator = new Vocator({ locorum, actorum, modorum, cursorum, completor })

  registerProgressusRecorder(async (actumId, progressus) => {
    reports.push({ actumId, progressus })
  })

  const cast = async (animaId: string): Promise<string> => {
    await signorum.issue({ animaId, forma: 'integer', valor: 1000n, auctor: 'test' })
    const inceptio: Inceptio = {
      modusId: 'flux-schnell',
      aditus: { prompt: 'a cat' },
      by: { animaId },
      computeStrategy: 'economy',
    }
    const { actum } = await dispatchInceptio(
      { inceptor, modorum, cursorum, completor, queue: vocator },
      inceptio,
    )
    return actum.id
  }

  return { locorum, actorum, signorum, vocator, completor, podFree, dispatched, reports, cast }
}

/** The credits still locked against a run — what a refund has to give back. */
async function lockedFor(rig: Rig, animaId: string): Promise<bigint> {
  const history = await rig.signorum.history({ animaId })
  return history.filter(s => s.status === 'locked').reduce((sum, s) => sum + s.valor, 0n)
}

// ---------------------------------------------------------------------------
// Exit clause 1 — queued, not refused, and the user sees its place
// ---------------------------------------------------------------------------

test('a run submitted with no warm pod is queued rather than refused', async () => {
  const rig = await makeRig()
  const actumId = await rig.cast('anima-1')

  const actum = await rig.actorum.findById(actumId)
  assert.equal(actum?.status, 'nascens', 'the run is admitted and waiting, not failed')
  assert.equal(rig.dispatched.length, 0, 'nothing reached a pod')

  const at = await rig.vocator.place(actumId)
  assert.deepEqual(at, { place: 1, depth: 1 })
})

test('a queued run keeps its reservation — waiting is not a refund', async () => {
  const rig = await makeRig()
  await rig.cast('anima-1')
  assert.equal(await lockedFor(rig, 'anima-1'), 1000n, 'the signum stays locked while it waits')
  assert.equal(await rig.signorum.balance({ animaId: 'anima-1' }), 0n)
})

test('the place is reported on the ordinary progress rail, in order of arrival', async () => {
  const rig = await makeRig()
  const first = await rig.cast('anima-1')
  const second = await rig.cast('anima-2')

  assert.deepEqual(await rig.vocator.place(first), { place: 1, depth: 2 })
  assert.deepEqual(await rig.vocator.place(second), { place: 2, depth: 2 })

  const queued = rig.reports.filter(r => r.progressus.phase === 'queued')
  assert.equal(queued.length, 2, 'each run reported the place it took')
  assert.equal(queued[0].actumId, first)
  assert.match(queued[0].progressus.message ?? '', /1st in line/)
  assert.deepEqual(queued[0].progressus.progress, { done: 1, total: 1, unit: 'items' })
  assert.equal(queued[1].actumId, second)
  assert.match(queued[1].progressus.message ?? '', /2nd in line/)
  assert.deepEqual(queued[1].progressus.progress, { done: 2, total: 2, unit: 'items' })
})

test('the place is said the way a person would say it', async () => {
  const rig = await makeRig()
  for (let i = 0; i < 4; i++) await rig.cast(`anima-${i}`)
  const said = rig.reports.filter(r => r.progressus.phase === 'queued').map(r => r.progressus.message)
  assert.deepEqual(said, [
    '1st in line for a warm pod',
    '2nd in line for a warm pod',
    '3rd in line for a warm pod',
    '4th in line for a warm pod',
  ])
})

// ---------------------------------------------------------------------------
// Exit clause 2 — it dispatches on the next warm pod
// ---------------------------------------------------------------------------

test('a queued run dispatches when a pod falls idle', async () => {
  const rig = await makeRig()
  const actumId = await rig.cast('anima-1')

  rig.podFree.value = true
  await rig.vocator.callNext(IMAGE)

  assert.deepEqual(rig.dispatched, [actumId], 'the waiting run went to the freed pod')
  assert.equal(await rig.vocator.place(actumId), null, 'and left the line')
  // Async, like every pod run: it is left in flight for the completion webhook to
  // finish, not settled here.
  const actum = await rig.actorum.findById(actumId)
  assert.equal(actum?.status, 'nascens')
  assert.equal(actum?.completum, undefined)
})

test('the line is served first-in first-out, one run per freed pod', async () => {
  const rig = await makeRig()
  const first = await rig.cast('anima-1')
  const second = await rig.cast('anima-2')

  rig.podFree.value = true
  await rig.vocator.callNext(IMAGE)
  assert.deepEqual(rig.dispatched, [first], 'one pod takes exactly one run')
  assert.deepEqual(await rig.vocator.place(second), { place: 1, depth: 1 }, 'and the line moved up')

  rig.podFree.value = true
  await rig.vocator.callNext(IMAGE)
  assert.deepEqual(rig.dispatched, [first, second])
})

test('a run called forward is told the line moved', async () => {
  const rig = await makeRig()
  await rig.cast('anima-1')
  const second = await rig.cast('anima-2')

  rig.podFree.value = true
  await rig.vocator.callNext(IMAGE)

  const forSecond = rig.reports.filter(r => r.actumId === second && r.progressus.phase === 'queued')
  assert.equal(forSecond.length, 2, 'reported when it joined, and again when it advanced')
  assert.match(forSecond.at(-1)!.progressus.message ?? '', /1st in line/)
})

test('the wait does not eat the run\'s execution deadline', async () => {
  const rig = await makeRig()
  const actumId = await rig.cast('anima-1')
  const queued = await rig.actorum.findById(actumId)

  rig.podFree.value = true
  await rig.vocator.callNext(IMAGE)
  const dispatched = await rig.actorum.findById(actumId)

  // Re-armed to the cursor's own terminus at the moment it was called forward, so a run
  // that waited ten minutes does not arrive on a pod with ten minutes less to finish in.
  assert.ok(
    dispatched!.expirat > queued!.expirat,
    'the deadline was re-armed at dispatch, not carried over from the wait',
  )
  assert.ok(
    dispatched!.expirat.getTime() - Date.now() > TERMINUS_MS - 5_000,
    'and re-armed to the full execution budget',
  )
})

test('a pod that was taken between the signal and the dispatch costs the run nothing', async () => {
  const rig = await makeRig()
  const first = await rig.cast('anima-1')
  await rig.cast('anima-2')

  // The event said a pod freed, but by the time the run looked it was gone.
  rig.podFree.value = false
  await rig.vocator.callNext(IMAGE)

  assert.deepEqual(rig.dispatched, [], 'nothing dispatched')
  assert.deepEqual(await rig.vocator.place(first), { place: 1, depth: 2 }, 'and it kept the place it held')
})

// ---------------------------------------------------------------------------
// Exit clause 3 — cancelled before dispatch, and refunded
// ---------------------------------------------------------------------------

test('a queued run cancelled before dispatch refunds its reservation', async () => {
  const rig = await makeRig()
  const actumId = await rig.cast('anima-1')
  const actum = await rig.actorum.findById(actumId)

  // The cancel every surface goes through — `POST /v1/runs/:id/cancel` and the
  // per-row cancel on /status both land on exactly this call.
  await rig.completor.fail(actum!, 'Cancelled by owner')

  assert.equal((await rig.actorum.findById(actumId))?.status, 'fractus')
  assert.equal(await lockedFor(rig, 'anima-1'), 0n, 'nothing is left locked')
  assert.equal(await rig.signorum.balance({ animaId: 'anima-1' }), 1000n, 'the credits are spendable again')
})

test('a cancelled run is never dispatched when its pod frees', async () => {
  const rig = await makeRig()
  const cancelled = await rig.cast('anima-1')
  const waiting = await rig.cast('anima-2')
  await rig.completor.fail((await rig.actorum.findById(cancelled))!, 'Cancelled by owner')

  rig.podFree.value = true
  await rig.vocator.callNext(IMAGE)

  // The claim re-reads the run and finds it settled, so the pod goes to the next
  // in line instead — which is what makes cancel safe without the cancel path
  // having to know the line exists.
  assert.deepEqual(rig.dispatched, [waiting])
  assert.equal(await rig.vocator.place(cancelled), null, 'the stale place is gone')
})

test('a cancelled run is swept out of the line even before a pod frees', async () => {
  const rig = await makeRig()
  const cancelled = await rig.cast('anima-1')
  const waiting = await rig.cast('anima-2')
  await rig.completor.fail((await rig.actorum.findById(cancelled))!, 'Cancelled by owner')

  await rig.vocator.sweep()

  assert.equal(await rig.vocator.place(cancelled), null)
  assert.deepEqual(
    await rig.vocator.place(waiting), { place: 1, depth: 1 },
    'so nobody behind it is told they are further back than they are',
  )
})

// ---------------------------------------------------------------------------
// The line itself
// ---------------------------------------------------------------------------

test('two pods freeing at once never hand the same run to both', async () => {
  const rig = await makeRig()
  const first = await rig.cast('anima-1')
  const second = await rig.cast('anima-2')

  // Both claims are taken before either dispatch resolves — the race the atomic
  // claim exists for.
  const a = await rig.locorum.claim(IMAGE)
  const b = await rig.locorum.claim(IMAGE)

  assert.equal(a?.actumId, first)
  assert.equal(b?.actumId, second, 'the second claimant got the next run, not the same one')
  assert.equal(await rig.locorum.claim(IMAGE), null, 'and the line is empty')
})

test('a run keeps the one place it holds, however often it is enqueued', async () => {
  const rig = await makeRig()
  const first = await rig.cast('anima-1')
  const second = await rig.cast('anima-2')

  const held = await rig.locorum.enqueue({ actumId: first, imageRef: IMAGE })
  await rig.locorum.enqueue({ actumId: first, imageRef: IMAGE })

  assert.deepEqual(await rig.vocator.place(first), { place: 1, depth: 2 }, 'still first, not last')
  assert.deepEqual(await rig.vocator.place(second), { place: 2, depth: 2 })
  assert.equal((await rig.locorum.waiting(IMAGE)).filter(l => l.actumId === first).length, 1)
  assert.equal(held.actumId, first)
})

test('a run waiting on another image is in another line', async () => {
  const rig = await makeRig()
  const flux = await rig.cast('anima-1')
  await rig.locorum.enqueue({ actumId: 'actum-other', imageRef: 'stationthis/wan-comfyui:v1' })

  assert.deepEqual(
    await rig.vocator.place(flux), { place: 1, depth: 1 },
    'a run waiting for a different substrate is not ahead of this one',
  )
  assert.deepEqual((await rig.locorum.images()).sort(), [IMAGE, 'stationthis/wan-comfyui:v1'].sort())
})

test('only an empty-pool refusal waits — every other error is a failure', async () => {
  const rig = await makeRig()
  assert.equal(rig.vocator.imageAwaited(new EconomyUnavailableError(IMAGE)), IMAGE)
  assert.equal(rig.vocator.imageAwaited(new Error('pod exploded')), null)
  assert.equal(rig.vocator.imageAwaited('not an error at all'), null)
})

test('a dispatch that fails for a real reason settles the run and frees the pod for the next', async () => {
  const rig = await makeRig()
  const doomed = await rig.cast('anima-1')
  const waiting = await rig.cast('anima-2')

  // The next run to reach the cursor throws something that is NOT "no pod yet".
  const actorum = rig.actorum
  const original = actorum.findById.bind(actorum)
  let thrown = false
  ;(rig.vocator as unknown as { deps: { cursorum: Cursorum } }).deps.cursorum = {
    register: () => {},
    resolve: () => ({
      reserve: async () => 100n,
      terminus: async () => TERMINUS_MS,
      run: async (actum) => {
        if (!thrown) { thrown = true; throw new Error('compile failed') }
        rig.dispatched.push(actum.id)
        return { kind: 'async', externusJobId: `job-${actum.id}` }
      },
    }),
  }

  await rig.vocator.callNext(IMAGE)

  assert.equal((await original(doomed))?.status, 'fractus', 'the run it could not place was settled')
  assert.equal(await rig.signorum.balance({ animaId: 'anima-1' }), 1000n, 'and refunded')
  assert.deepEqual(rig.dispatched, [waiting], 'the pod went on to the next in line')
})
