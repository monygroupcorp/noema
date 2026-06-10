import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dispatchInceptio } from '../../../src/execution/dispatchInceptio.js'
import type { DispatchDeps } from '../../../src/execution/dispatchInceptio.js'
import type { Inceptio } from '../../../src/types/cursus.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Modus } from '../../../src/types/modus.js'
import type { CursorResult } from '../../../src/types/cursus.js'
import type { ActumIndex } from '../../../src/types/actumIndex.js'

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
      fail: async (actum, error) => ({ ...actum, status: 'fractus' as const, error }),
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
  return { initiateArgs: [], completeCalls: 0, indexRecords: [] }
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

test('throws when modus is not found after initiation', async () => {
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
})
