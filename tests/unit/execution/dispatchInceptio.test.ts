import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchInceptio, dispatchFailureActumId } from '../../../src/execution/dispatchInceptio.js'
import type { DispatchDeps } from '../../../src/execution/dispatchInceptio.js'
import type { Inceptio } from '../../../src/types/cursus.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modus } from '../../../src/types/modus.js'
import type { CursorResult } from '../../../src/types/cursus.js'
import type { ActumIndex } from '../../../src/types/actumIndex.js'
import type { Actorum } from '../../../src/types/cursus.js'
import type { WideEvent } from '../../../src/lib/wide.js'
import { ActumCompletor } from '../../../src/execution/ActumCompletor.js'
import { bus } from '../../../src/lib/bus.js'
import { withTrace, makeTraceContext } from '../../../src/lib/trace.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeModus(overrides: Partial<Modus> = {}): Modus {
  return {
    id: 'mod-1', nomen: 'Test Tool', genus: 'atomicus',
    versio: '1.0.0', contentHash: 'abc',
    aditus: { prompt: { type: 'text', required: true, description: 'The prompt' } },
    exitus: { url: { type: 'image' } },
    canonica: true, ministerium: 'runpod',
    natum: new Date(), mutatum: new Date(),
    ...overrides,
  }
}

function makeActum(overrides: Partial<Actum> = {}): Actum {
  return {
    id: 'actum-1', modusId: 'mod-1', modusVersiono: '1.0.0',
    impetus: 100n, signaConsumed: ['sig-1'], aditus: { prompt: 'test' },
    status: 'nascens', inceptum: new Date(), expirat: new Date(Date.now() + 60_000),
    ...overrides,
  }
}

interface Spies {
  initiateArgs: Inceptio[]
  completeCalls: number
  indexRecords: ActumIndex[]
  /** Every completor.fail() the dispatch made — the release of the locked signa. */
  failCalls: Array<{ actumId: string; signaConsumed: string[]; error: string }>
}

function makeDeps(
  cursorResult: CursorResult,
  spies: Spies,
  opts: { withIndex?: boolean } = {},
): DispatchDeps {
  const modus = makeModus()
  const deps: DispatchDeps = {
    inceptor: {
      initiate: async (input) => {
        spies.initiateArgs.push(input)
        return makeActum()
      },
    },
    modorum: {
      find: async () => modus,
      register: async () => {},
      list: async () => [],
    } as unknown as DispatchDeps['modorum'],
    cursorum: {
      register: () => {},
      resolve: () => ({
        reserve: async () => 100n,
        run: async () => cursorResult,
      }),
    },
    completor: {
      complete: async (actum, exitus) => {
        spies.completeCalls += 1
        return {
          ...actum,
          status: 'completus' as const,
          exitus: exitus.exitus,
          completum: new Date(),
          impetus: exitus.impetus,
        }
      },
      fail: async (actum, error) => {
        spies.failCalls.push({
          actumId: actum.id,
          signaConsumed: actum.signaConsumed,
          error,
        })
        return { ...actum, status: 'fractus' as const, error }
      },
    },
  }
  if (opts.withIndex) {
    deps.actumIndex = {
      record: async (entry) => { spies.indexRecords.push(entry) },
      findFor: async () => [],
      remove: async () => {},
    }
  }
  return deps
}

function makeSpies(): Spies {
  return { initiateArgs: [], completeCalls: 0, indexRecords: [], failCalls: [] }
}

function makeInceptio(overrides: Partial<Inceptio> = {}): Inceptio {
  return {
    modusId: 'mod-1',
    aditus: { prompt: 'a cat' },
    by: { animaId: 'anima-1' },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('sync path: returns { actum, exitus }, calls complete, passes inceptio to initiate', async () => {
  const spies = makeSpies()
  const deps = makeDeps(
    { kind: 'sync', exitus: { exitus: { url: 'https://example.com/img.png' }, impetus: 100n } },
    spies,
  )
  const inceptio = makeInceptio()

  const result = await dispatchInceptio(deps, inceptio)

  // initiate received the exact inceptio
  assert.equal(spies.initiateArgs.length, 1)
  assert.deepEqual(spies.initiateArgs[0], inceptio)

  // sync → exitus present + completor.complete called
  assert.ok(result.exitus, 'exitus should be present on sync')
  assert.deepEqual(result.exitus, { url: 'https://example.com/img.png' })
  assert.equal(result.actum.status, 'completus')
  assert.equal(spies.completeCalls, 1, 'complete called exactly once')
})

test('sync path: exitus defaults to {} when completed actum has no exitus', async () => {
  const spies = makeSpies()
  // completor returns an actum whose exitus is the run exitus; here run exitus is {}
  const deps = makeDeps(
    { kind: 'sync', exitus: { exitus: {}, impetus: 100n } },
    spies,
  )

  const result = await dispatchInceptio(deps, makeInceptio())
  assert.deepEqual(result.exitus, {})
})

test('async path: returns { actum } only, does NOT call complete', async () => {
  const spies = makeSpies()
  const deps = makeDeps(
    { kind: 'async', externusJobId: 'job-123' },
    spies,
  )

  const result = await dispatchInceptio(deps, makeInceptio())

  assert.equal(result.exitus, undefined, 'async should not return exitus')
  assert.equal(result.actum.id, 'actum-1')
  assert.equal(result.actum.status, 'nascens', 'actum left pending')
  assert.equal(spies.completeCalls, 0, 'complete NOT called on async')
})

test('actumIndex: records the animaId branch for an {animaId} identity', async () => {
  const spies = makeSpies()
  const deps = makeDeps(
    { kind: 'sync', exitus: { exitus: { url: 'x' }, impetus: 100n } },
    spies,
    { withIndex: true },
  )

  await dispatchInceptio(deps, makeInceptio({ by: { animaId: 'anima-42' } }))
  // fire-and-forget — let the microtask settle
  await new Promise((r) => setImmediate(r))

  assert.equal(spies.indexRecords.length, 1)
  const rec = spies.indexRecords[0]
  assert.equal(rec.animaId, 'anima-42')
  assert.equal(rec.commitment, undefined)
  assert.equal(rec.actumId, 'actum-1')
  assert.equal(rec.modusId, 'mod-1')
})

test('actumIndex: records the commitment branch for a {commitment} identity (async path too)', async () => {
  const spies = makeSpies()
  const deps = makeDeps(
    { kind: 'async', externusJobId: 'job-9' },
    spies,
    { withIndex: true },
  )

  await dispatchInceptio(deps, makeInceptio({ by: { commitment: 'commit-xyz' } }))
  await new Promise((r) => setImmediate(r))

  assert.equal(spies.indexRecords.length, 1)
  const rec = spies.indexRecords[0]
  assert.equal(rec.commitment, 'commit-xyz')
  assert.equal(rec.animaId, undefined)
  assert.equal(rec.actumId, 'actum-1')
  assert.equal(rec.modusId, 'mod-1')
})

// ---------------------------------------------------------------------------
// noema-078: idempotent trace establishment so sync-cursor dispatches invoked
// via POST /v1/runs or MCP (no outer withTrace) still emit a wide_events row.
// These use the REAL ActumCompletor so its getTrace()-gated emitWideEvent path
// actually runs; emission is observed via the bus (emitWideEvent → bus.emit).
// ---------------------------------------------------------------------------

/** A member this fake does not model — throwing keeps an unreached path from returning a plausible lie. */
function unreachedActorum(name: string) {
  return async (): Promise<never> => {
    throw new Error(`dispatchInceptio test Actorum fake: ${name}() is not modelled`)
  }
}

function makeActa(actum: Actum): Actorum {
  let latest = { ...actum }
  return {
    create: async (a) => { latest = { ...a, inceptum: new Date() }; return latest },
    update: async (_id, patch) => { latest = { ...latest, ...patch }; return latest },
    findById: async () => latest,
    findByExternusJobId: unreachedActorum('findByExternusJobId'),
    findByCallbackNonce: unreachedActorum('findByCallbackNonce'),
    findByNullifier: unreachedActorum('findByNullifier'),
    findExpired: unreachedActorum('findExpired'),
    findInFlight: unreachedActorum('findInFlight'),
    findByCompositum: unreachedActorum('findByCompositum'),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSignorum(): any {
  return {
    balance: async () => 500n,
    issue: async () => ({}),
    spend: async () => {},
    lock: async () => {},
    release: async () => {},
    history: async () => [],
    settle: async () => {},
  }
}

// Deps whose completor is a REAL ActumCompletor (so complete() exercises the
// getTrace()-gated wide-event emission), everything else a minimal fake.
function makeRealCompletorDeps(cursorResult: CursorResult): DispatchDeps {
  const modus = makeModus()
  return {
    inceptor: { initiate: async () => makeActum() },
    modorum: {
      find: async () => modus,
      register: async () => {},
      list: async () => [],
    } as unknown as DispatchDeps['modorum'],
    cursorum: {
      register: () => {},
      resolve: () => ({
        reserve: async () => 100n,
        run: async () => cursorResult,
      }),
    },
    completor: new ActumCompletor({
      acta: makeActa(makeActum()),
      signorum: makeSignorum(),
    }),
  }
}

test('noema-078: sync dispatch with NO outer trace still emits a wide_event (idempotent trace establishment)', async () => {
  const events: WideEvent[] = []
  const onComplete = (w: WideEvent) => events.push(w)
  bus.on('actum.complete', onComplete)
  try {
    const deps = makeRealCompletorDeps(
      { kind: 'sync', exitus: { exitus: { url: 'https://example.com/x.png' }, impetus: 80n } },
    )
    // Invoked bare — simulating POST /v1/runs or MCP, which open no outer withTrace.
    await dispatchInceptio(deps, makeInceptio())

    assert.equal(events.length, 1, 'exactly one wide_events row emitted by the time complete() resolved')
    assert.equal(events[0].status, 'completed')
    // The idempotently-established outer trace tagged this as the api channel.
    assert.equal(events[0].platform, 'api')
  } finally {
    bus.off('actum.complete', onComplete)
  }
})

test('noema-078: an already-established outer trace is reused, not shadowed by a new one', async () => {
  const events: WideEvent[] = []
  const onComplete = (w: WideEvent) => events.push(w)
  bus.on('actum.complete', onComplete)
  try {
    // Mirror how Telegram/webhook already wrap the whole lifecycle in one outer
    // trace before reaching dispatchInceptio. The idempotent check must detect it
    // and no-op — the emitted row must carry THIS caller's context (platform
    // 'telegram'), proving no second, shadowing 'api' context was established.
    await withTrace(makeTraceContext({ platform: 'telegram' }), async () => {
      const deps = makeRealCompletorDeps(
        { kind: 'sync', exitus: { exitus: { url: 'x' }, impetus: 80n } },
      )
      await dispatchInceptio(deps, makeInceptio())
    })

    assert.equal(events.length, 1)
    assert.equal(events[0].platform, 'telegram', 'caller trace reused, not shadowed by a new api context')
  } finally {
    bus.off('actum.complete', onComplete)
  }
})

// ---------------------------------------------------------------------------
// noema-359: every post-initiate throw releases the signa the initiation locked
// and hands the persisted actum id back to the caller.
//
// Once `inceptor.initiate` returns, an Actum exists and its signa are LOCKED. Any
// throw after that point is a terminal run, so these tests assert the RELEASE (the
// completor.fail call carrying the actum's locked signa), not merely that a throw
// happened — deleting the release leaves the throw intact and would keep a
// throw-only assertion green.
// ---------------------------------------------------------------------------

test('modus not found after initiation: throws, and releases the locked signa', async () => {
  const spies = makeSpies()
  const deps = makeDeps(
    { kind: 'sync', exitus: { exitus: {}, impetus: 100n } },
    spies,
  )
  deps.modorum = {
    find: async () => null,
    register: async () => {},
    list: async () => [],
  } as unknown as DispatchDeps['modorum']

  await assert.rejects(
    () => dispatchInceptio(deps, makeInceptio()),
    /not found after initiation/,
  )

  assert.equal(spies.failCalls.length, 1, 'the persisted actum was settled, not left nascens')
  assert.equal(spies.failCalls[0].actumId, 'actum-1')
  assert.deepEqual(
    spies.failCalls[0].signaConsumed,
    ['sig-1'],
    'the signa locked at initiation were the ones released',
  )
})

test('cursor resolution failure: throws, and releases the locked signa', async () => {
  const spies = makeSpies()
  const deps = makeDeps(
    { kind: 'sync', exitus: { exitus: {}, impetus: 100n } },
    spies,
  )
  deps.cursorum = {
    register: () => {},
    resolve: () => { throw new Error('No cursor registered for ministerium') },
  }

  await assert.rejects(
    () => dispatchInceptio(deps, makeInceptio()),
    /No cursor registered/,
  )

  assert.equal(spies.failCalls.length, 1, 'the persisted actum was settled, not left nascens')
  assert.equal(spies.failCalls[0].actumId, 'actum-1')
  assert.deepEqual(spies.failCalls[0].signaConsumed, ['sig-1'])
})

test('cursor run failure: throws, and releases the locked signa', async () => {
  const spies = makeSpies()
  const deps = makeDeps(
    { kind: 'sync', exitus: { exitus: {}, impetus: 100n } },
    spies,
  )
  deps.cursorum = {
    register: () => {},
    resolve: () => ({
      reserve: async () => 100n,
      run: async () => { throw new Error('pod refused the job') },
    }),
  }

  await assert.rejects(
    () => dispatchInceptio(deps, makeInceptio()),
    /pod refused the job/,
  )

  assert.equal(spies.failCalls.length, 1)
  assert.deepEqual(spies.failCalls[0].signaConsumed, ['sig-1'])
})

test('a post-initiate failure carries the persisted actum id back to the caller', async () => {
  const spies = makeSpies()
  const deps = makeDeps(
    { kind: 'sync', exitus: { exitus: {}, impetus: 100n } },
    spies,
  )
  deps.cursorum = {
    register: () => {},
    resolve: () => { throw new Error('No cursor registered for ministerium') },
  }

  const err = await dispatchInceptio(deps, makeInceptio()).then(
    () => { throw new Error('expected the dispatch to throw') },
    (e: unknown) => e,
  )

  assert.equal(dispatchFailureActumId(err), 'actum-1')
  // The error itself is unchanged: same type, same message, and the id is not
  // enumerable so it does not surface in serialisation or key iteration.
  assert.ok(err instanceof Error)
  assert.match((err as Error).message, /No cursor registered/)
  assert.deepEqual(Object.keys(err as object), [])
})

test('a failure BEFORE any actum exists carries no actum id', async () => {
  const spies = makeSpies()
  const deps = makeDeps(
    { kind: 'sync', exitus: { exitus: {}, impetus: 100n } },
    spies,
  )
  deps.inceptor = {
    initiate: (async () => { throw new Error('insufficient balance') }) as DispatchDeps['inceptor']['initiate'],
  }

  const err = await dispatchInceptio(deps, makeInceptio()).then(
    () => { throw new Error('expected the dispatch to throw') },
    (e: unknown) => e,
  )

  assert.match((err as Error).message, /insufficient balance/)
  assert.equal(
    dispatchFailureActumId(err),
    undefined,
    'nothing was persisted, so there is nothing for the caller to account for',
  )
  assert.equal(spies.failCalls.length, 0, 'no actum to settle')
})

test('a settle failure does not replace the original error', async () => {
  const spies = makeSpies()
  const deps = makeDeps(
    { kind: 'sync', exitus: { exitus: {}, impetus: 100n } },
    spies,
  )
  deps.cursorum = {
    register: () => {},
    resolve: () => { throw new Error('No cursor registered for ministerium') },
  }
  deps.completor = {
    ...deps.completor,
    fail: async () => { throw new Error('ledger unavailable') },
  }

  await assert.rejects(
    () => dispatchInceptio(deps, makeInceptio()),
    /No cursor registered/,
  )
})

// ---------------------------------------------------------------------------
// noema-270: a cursor that THROWS is a terminal run, and is settled here.
//
// A sync cursor whose run() rejects leaves an actum the dispatch will never come back to.
// Left `nascens`, its reservation stays locked until the expiry reaper reaches it — the same
// terminal outcome the failure already implies, minus the credits the payer cannot use in the
// meantime. The reaper is the backstop for a run nobody is left to fail, not the mechanism for
// one that just failed in front of us.
//
// Non-vacuity: dropping the settle makes "a decompose that times out settles rather than being
// left for the expiry reaper" fail — the actum stays nascens and its signa stay locked.
// ---------------------------------------------------------------------------

test('noema-270: a sync cursor that throws fails the actum and releases its signa, then rethrows', async () => {
  const acta = makeActa(makeActum())
  const released: string[][] = []
  const signorum = makeSignorum()
  signorum.release = async (ids: string[]) => { released.push(ids) }

  const modus = makeModus()
  const deps: DispatchDeps = {
    inceptor: { initiate: async () => makeActum() },
    modorum: {
      find: async () => modus,
      register: async () => {},
      list: async () => [],
    } as unknown as DispatchDeps['modorum'],
    cursorum: {
      register: () => {},
      resolve: () => ({
        reserve: async () => 100n,
        run: async () => { throw new Error('the chat call did not answer within 60s') },
      }),
    },
    completor: new ActumCompletor({ acta, signorum }),
  }

  // The error reaches the caller unchanged — settling must not swallow or replace it.
  await assert.rejects(
    () => dispatchInceptio(deps, makeInceptio()),
    /did not answer within 60s/,
  )

  const after = await acta.findById('actum-1')
  assert.equal(after?.status, 'fractus', 'the run is terminal, so the actum is terminal')
  assert.equal(after?.error, 'the chat call did not answer within 60s')
  assert.deepEqual(released, [['sig-1']], 'nothing ran, so the reservation is released, not settled')
})
