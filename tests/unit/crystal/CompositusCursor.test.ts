import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemoryModorum } from '../../../src/execution/MemoryModorum.js'
import { MemoryActorum } from '../../../src/execution/MemoryActorum.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { SimpleCursorum } from '../../../src/crystal/SimpleCursorum.js'
import { ActumInceptor } from '../../../src/execution/ActumInceptor.js'
import { CompositusCursor } from '../../../src/crystal/CompositusCursor.js'
import { dispatchInceptio, type DispatchDeps } from '../../../src/execution/dispatchInceptio.js'
import type { Cursor, CursorResult, ActumCompletor, Inceptio, Exitus } from '../../../src/types/cursus.js'
import type { Modus, Forma } from '../../../src/types/modus.js'
import type { Actum } from '../../../src/types/actum.js'

// =============================================================================
// ADR-0008 — compositus execution. Proves the engine with a 2-step chain shaped
// like the canonical sd1-5 → upscale flow, run through sync FakeCursors so the
// whole chain settles inline (no webhook needed).
// =============================================================================

function atomic(id: string, ministerium: string, aditus: Forma, exitus: Forma): Modus {
  return {
    id, nomen: id, genus: 'atomicus', versio: '1.0.0', contentHash: '',
    ministerium, aditus, exitus, canonica: true,
    natum: new Date('2026-06-17'), mutatum: new Date('2026-06-17'),
  }
}

/** A sync cursor that returns a fixed exitus and records the aditus it ran with. */
class FakeCursor implements Cursor {
  lastAditus?: Record<string, unknown>
  constructor(private readonly out: Record<string, unknown>, private readonly cost: bigint) {}
  async reserve(): Promise<bigint> { return this.cost }
  async run(actum: Actum): Promise<CursorResult> {
    this.lastAditus = actum.aditus
    return { kind: 'sync', exitus: { exitus: this.out, impetus: this.cost } }
  }
}

test('compositus run threads step exitus → next step aditus, completes parent, sums cost', async () => {
  const modorum = new MemoryModorum()
  const actorum = new MemoryActorum()
  const signorum = new MemorySignorum()
  const cursorum = new SimpleCursorum()

  // Step A (the "make"): outputs an image. Step B (the "upscale"): consumes one.
  const cursorA = new FakeCursor({ image: 'IMG_A' }, 10n)
  const cursorB = new FakeCursor({ image: 'IMG_B_UP' }, 20n)
  cursorum.register('fake-a', cursorA)
  cursorum.register('fake-b', cursorB)

  await modorum.register(atomic('mod-a', 'fake-a',
    { prompt: { type: 'text', required: true } },
    { image: { type: 'image' } }))
  await modorum.register(atomic('mod-b', 'fake-b',
    { image: { type: 'image', required: true } },          // note: NO prompt port
    { image: { type: 'image' } }))

  // The compositus: prompt → A → (A.image wired into B.image) → B → image.
  await modorum.register({
    id: 'spell-make-upscale', nomen: 'make → upscale', genus: 'compositus',
    versio: '1.0.0', contentHash: '',
    aditus: { prompt: { type: 'text', required: true } },
    exitus: { image: { type: 'image' } },
    gradus: [
      { ordine: 0, modusId: 'mod-a' },
      { ordine: 1, modusId: 'mod-b', ligamina: { image: { gradus: 0, exitus: 'image' } } },
    ],
    canonica: true, natum: new Date('2026-06-17'), mutatum: new Date('2026-06-17'),
  })

  // Fund the payer generously — each step locks/settles its own signa.
  await signorum.issue({ animaId: 'anima-1', forma: 'minted', valor: 1000n, auctor: 'test' })

  const inceptor = new ActumInceptor({ modorum, cursorum, signorum, acta: actorum })

  // Structural completor: persists the completed actum + settles signa (no wide-event rig).
  const completor: ActumCompletor = {
    complete: async (actum: Actum, result: Exitus) => {
      await signorum.settle(actum.signaConsumed, result.impetus, actum.id)
      return actorum.update(actum.id, {
        status: 'completus', exitus: result.exitus, impetus: result.impetus, completum: new Date(),
      })
    },
    fail: async (actum: Actum, error: string) => actorum.update(actum.id, { status: 'fractus', error }),
  }

  let compositusCursor!: CompositusCursor
  const deps: DispatchDeps = { inceptor, modorum, cursorum, completor, get compositusCursor() { return compositusCursor } }
  compositusCursor = new CompositusCursor((inc: Inceptio) => dispatchInceptio(deps, inc), modorum, actorum)

  const { actum: parent } = await dispatchInceptio(deps, {
    modusId: 'spell-make-upscale',
    aditus: { prompt: 'a cat' },
    by: { animaId: 'anima-1' },
  })

  // ── The wiring proof ──────────────────────────────────────────────────────
  // Step B's `image` input was fed by step A's `image` output, via ligamina.
  assert.equal(cursorA.lastAditus?.prompt, 'a cat', 'step A received the cast prompt')
  assert.equal(cursorB.lastAditus?.image, 'IMG_A', 'step B received step A\'s output image')
  // B does not declare a prompt port, so by-name binding must not leak it in.
  assert.equal('prompt' in (cursorB.lastAditus ?? {}), false, 'step B got no prompt (not declared)')

  // ── Parent umbrella ─────────────────────────────────────────────────────────
  const finalParent = await actorum.findById(parent.id)
  assert.equal(finalParent?.status, 'completus', 'parent completes')
  assert.deepEqual(finalParent?.exitus, { image: 'IMG_B_UP' }, 'parent exitus = last step exitus')
  assert.equal(finalParent?.impetus, 30n, 'parent impetus = sum of child costs (10 + 20)')
  assert.equal(compositusCursor.isTracking(parent.id), false, 'run state cleaned up on completion')

  // ── Child step provenance ────────────────────────────────────────────────────
  // Both children exist as real acta, each linked to the parent by ordine.
  // (Parent itself carries no compositum.)
  assert.equal(finalParent?.compositum, undefined, 'parent carries no compositum linkage')
})

// ── Helpers for the guard / failure cases ────────────────────────────────────

function makeRail() {
  const modorum = new MemoryModorum()
  const actorum = new MemoryActorum()
  const signorum = new MemorySignorum()
  const cursorum = new SimpleCursorum()
  const inceptor = new ActumInceptor({ modorum, cursorum, signorum, acta: actorum })
  const completor: ActumCompletor = {
    complete: async (actum: Actum, result: Exitus) => {
      await signorum.settle(actum.signaConsumed, result.impetus, actum.id)
      return actorum.update(actum.id, {
        status: 'completus', exitus: result.exitus, impetus: result.impetus, completum: new Date(),
      })
    },
    fail: async (actum: Actum, error: string) => actorum.update(actum.id, { status: 'fractus', error }),
  }
  let compositusCursor!: CompositusCursor
  const deps: DispatchDeps = { inceptor, modorum, cursorum, completor, get compositusCursor() { return compositusCursor } }
  compositusCursor = new CompositusCursor((inc: Inceptio) => dispatchInceptio(deps, inc), modorum, actorum)
  return { modorum, actorum, signorum, cursorum, deps, compositusCursor }
}

test('compositus guard: a nested compositus step is rejected up front', async () => {
  const { modorum, cursorum, deps } = makeRail()
  cursorum.register('fake', new FakeCursor({ image: 'X' }, 1n))
  await modorum.register(atomic('leaf', 'fake', { prompt: { type: 'text' } }, { image: { type: 'image' } }))
  // An inner compositus, then an outer that tries to use it as a step.
  await modorum.register({
    id: 'inner', nomen: 'inner', genus: 'compositus', versio: '1.0.0', contentHash: '',
    aditus: {}, exitus: { image: { type: 'image' } },
    gradus: [{ ordine: 0, modusId: 'leaf' }],
    canonica: true, natum: new Date(), mutatum: new Date(),
  })
  await modorum.register({
    id: 'outer', nomen: 'outer', genus: 'compositus', versio: '1.0.0', contentHash: '',
    aditus: {}, exitus: { image: { type: 'image' } },
    gradus: [{ ordine: 0, modusId: 'inner' }],
    canonica: true, natum: new Date(), mutatum: new Date(),
  })

  await assert.rejects(
    () => dispatchInceptio(deps, { modusId: 'outer', aditus: {}, by: { animaId: 'a' } }),
    /nested compositus modi are not supported/,
  )
})

test('compositus guard: a condicio step is rejected up front (not yet honored)', async () => {
  const { modorum, cursorum, deps } = makeRail()
  cursorum.register('fake', new FakeCursor({ image: 'X' }, 1n))
  await modorum.register(atomic('leaf', 'fake', { prompt: { type: 'text' } }, { image: { type: 'image' } }))
  await modorum.register({
    id: 'gated', nomen: 'gated', genus: 'compositus', versio: '1.0.0', contentHash: '',
    aditus: {}, exitus: { image: { type: 'image' } },
    gradus: [{ ordine: 0, modusId: 'leaf', condicio: 'input.width > 512' }],
    canonica: true, natum: new Date(), mutatum: new Date(),
  })

  await assert.rejects(
    () => dispatchInceptio(deps, { modusId: 'gated', aditus: {}, by: { animaId: 'a' } }),
    /condicio is not supported/,
  )
})

test('compositus: a failing step fails the parent and frees run state', async () => {
  const { modorum, actorum, signorum, cursorum, deps, compositusCursor } = makeRail()
  await signorum.issue({ animaId: 'a', forma: 'minted', valor: 1000n, auctor: 'test' })

  // Step A succeeds; step B throws inside run() → dispatch rejects → parent fails.
  cursorum.register('ok', new FakeCursor({ image: 'IMG_A' }, 10n))
  const boom: Cursor = { reserve: async () => 5n, run: async () => { throw new Error('pod exploded') } }
  cursorum.register('boom', boom)
  await modorum.register(atomic('a', 'ok', { prompt: { type: 'text', required: true } }, { image: { type: 'image' } }))
  await modorum.register(atomic('b', 'boom', { image: { type: 'image', required: true } }, { image: { type: 'image' } }))
  await modorum.register({
    id: 'spell-x', nomen: 'x', genus: 'compositus', versio: '1.0.0', contentHash: '',
    aditus: { prompt: { type: 'text', required: true } }, exitus: { image: { type: 'image' } },
    gradus: [
      { ordine: 0, modusId: 'a' },
      { ordine: 1, modusId: 'b', ligamina: { image: { gradus: 0, exitus: 'image' } } },
    ],
    canonica: true, natum: new Date(), mutatum: new Date(),
  })

  const { actum: parent } = await dispatchInceptio(deps, { modusId: 'spell-x', aditus: { prompt: 'hi' }, by: { animaId: 'a' } })

  const finalParent = await actorum.findById(parent.id)
  assert.equal(finalParent?.status, 'fractus', 'parent fails when a step fails')
  assert.match(finalParent?.error ?? '', /pod exploded/, 'parent error surfaces the step failure')
  assert.equal(compositusCursor.isTracking(parent.id), false, 'run state freed on failure')
})
