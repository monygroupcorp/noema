import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Modus } from '../../../src/types/modus.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Signum, Signa } from '../../../src/types/significandi.js'
import type { Cursor, Actorum, Cursorum, Inceptio } from '../../../src/types/cursus.js'
import { ActumInceptor, InsufficientFundsError, DEFAULT_EXPIRAT_MS, MAX_TERMINUS_MS } from '../../../src/execution/ActumInceptor.js'

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function makeModus(overrides: Partial<Modus> = {}): Modus {
  return {
    id: 'mod-1', nomen: 'test', genus: 'atomicus',
    versio: '1.0.0', contentHash: 'abc',
    aditus: {}, exitus: {}, canonica: true,
    ministerium: 'openai', impetusFixum: 100n,
    natum: new Date(), mutatum: new Date(),
    ...overrides,
  }
}

function makeSignum(valor: bigint, id = 'sig-1'): Signum {
  return { id, animaId: 'anima-1', forma: 'eth', valor, auctor: 'test', status: 'valid', natum: new Date() }
}

/**
 * A member the fake does not model. It throws rather than returning a plausible default:
 * a stub that quietly answers `null`/`[]` is a new way for a test to pass while lying.
 */
function unmodelled(fake: string, name: string) {
  return async (): Promise<never> => {
    throw new Error(`${fake} fake: ${name}() is not modelled`)
  }
}

function makeModorum(modus: Modus) {
  return {
    find: async () => modus,
    register: async () => {},
    list: async () => [],
    update: unmodelled('Modorum', 'update'),
  }
}

function makeRunner(reserve: bigint = 100n): Cursor {
  return {
    reserve: async () => reserve,
    // Cursor.run returns a CursorResult — the {kind:'sync'|'async'} envelope wrapping the Exitus.
    run: async () => ({ kind: 'sync', exitus: { exitus: {}, impetus: reserve } }),
  }
}

function makeCursorum(runner: Cursor): Cursorum {
  return {
    register: () => {},
    resolve: () => runner,
  }
}

function makeSignorum(signa: Signa = [makeSignum(500n)]) {
  const locked: string[] = []
  return {
    balance: async () => signa.filter(s => s.status === 'valid').reduce((s, x) => s + x.valor, 0n),
    issue: async (s: Omit<Signum, 'id' | 'natum' | 'status'>) => ({ ...s, id: 'new', status: 'valid' as const, natum: new Date() }),
    spend: async () => {},
    lock: async (ids: string[]) => { locked.push(...ids) },
    release: async () => {},
    history: async (_by: { animaId: string } | { commitment: string }) => signa,
    earningTotals: async () => [],
    listEarnings: async () => ({ entries: [] }),
    sessionBudget: unmodelled('Signorum', 'sessionBudget'),
    reserve: unmodelled('Signorum', 'reserve'),
    findByTestis: unmodelled('Signorum', 'findByTestis'),
    ownsAny: unmodelled('Signorum', 'ownsAny'),
    settle: unmodelled('Signorum', 'settle'),
    transfer: unmodelled('Signorum', 'transfer'),
    createMany: unmodelled('Signorum', 'createMany'),
    _locked: locked,
  }
}

function makeActa(nullifierMap: Map<string, Actum> = new Map()): Actorum & { records: Actum[] } {
  const records: Actum[] = []
  return {
    records,
    create: async (a) => { const r = { ...a, inceptum: new Date() }; records.push(r); return r },
    update: async (id, patch) => {
      const r = records.find(x => x.id === id)!
      Object.assign(r, patch)
      return r
    },
    findById: async (id) => records.find(x => x.id === id) ?? null,
    findByExternusJobId: async () => null,
    findByNullifier: async (nullifier) => nullifierMap.get(nullifier) ?? null,
    findExpired: async () => [],
    findByCallbackNonce: unmodelled('Actorum', 'findByCallbackNonce'),
    findInFlight: unmodelled('Actorum', 'findInFlight'),
    findByCompositum: unmodelled('Actorum', 'findByCompositum'),
  }
}

function makeParams(overrides: Partial<Inceptio> = {}): Inceptio {
  return { modusId: 'mod-1', aditus: {}, by: { animaId: 'anima-1' }, ...overrides }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('returns a nascens actum', async () => {
  const modus = makeModus()
  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(makeRunner()),
    signorum: makeSignorum(),
    acta: makeActa(),
  })

  const actum = await inceptor.initiate(makeParams())

  assert.equal(actum.status, 'nascens')
})

test('actum records the modusId and versio', async () => {
  const modus = makeModus({ id: 'mod-42', versio: '2.1.0' })
  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(makeRunner()),
    signorum: makeSignorum(),
    acta: makeActa(),
  })

  const actum = await inceptor.initiate(makeParams({ modusId: 'mod-42' }))

  assert.equal(actum.modusId, 'mod-42')
  assert.equal(actum.modusVersiono, '2.1.0')
})

test('actum.impetus is set to the reserved amount', async () => {
  const modus = makeModus()
  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(makeRunner(250n)),
    signorum: makeSignorum([makeSignum(1000n)]),
    acta: makeActa(),
  })

  const actum = await inceptor.initiate(makeParams())

  assert.equal(actum.impetus, 250n)
})

test('actum.aditus records the inputs', async () => {
  const modus = makeModus()
  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(makeRunner()),
    signorum: makeSignorum(),
    acta: makeActa(),
  })
  const aditus = { prompt: 'a red fox', width: 512 }

  const actum = await inceptor.initiate(makeParams({ aditus }))

  assert.deepEqual(actum.aditus, aditus)
})

test('actum.modoId is forwarded when provided', async () => {
  const modus = makeModus()
  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(makeRunner()),
    signorum: makeSignorum(),
    acta: makeActa(),
  })

  const actum = await inceptor.initiate(makeParams({ modoId: 'modo-99' }))

  assert.equal(actum.modoId, 'modo-99')
})

test('signa covering the reservation are locked', async () => {
  const modus = makeModus()
  const sig1 = makeSignum(60n, 'sig-a')
  const sig2 = makeSignum(60n, 'sig-b')
  const signorum = makeSignorum([sig1, sig2])
  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(makeRunner(100n)),
    signorum,
    acta: makeActa(),
  })

  await inceptor.initiate(makeParams())

  assert.ok(signorum._locked.length > 0, 'expected some signa to be locked')
  const lockedValor = [sig1, sig2]
    .filter(s => signorum._locked.includes(s.id))
    .reduce((sum, s) => sum + s.valor, 0n)
  assert.ok(lockedValor >= 100n, `locked valor ${lockedValor} should cover reservation 100n`)
})

test('actum.signaConsumed lists the locked signa ids', async () => {
  const modus = makeModus()
  const signorum = makeSignorum([makeSignum(500n, 'sig-x')])
  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(makeRunner(100n)),
    signorum,
    acta: makeActa(),
  })

  const actum = await inceptor.initiate(makeParams())

  assert.deepEqual(actum.signaConsumed, signorum._locked)
})

test('an underfunded run throws a typed InsufficientFundsError', async () => {
  const modus = makeModus()
  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(makeRunner(1000n)),
    signorum: makeSignorum([makeSignum(50n)]),  // only 50, need 1000
    acta: makeActa(),
  })

  // The TYPE is the contract the API layer maps on, and `balance`/`required` must be
  // readable as fields — a plain Error carrying the same words satisfies neither.
  const err = await inceptor.initiate(makeParams()).then(
    () => { throw new Error('expected initiate to reject') },
    (e: unknown) => e,
  )
  assert.ok(err instanceof InsufficientFundsError, `expected InsufficientFundsError, got ${String(err)}`)
  assert.equal(err.balance, 50n)
  assert.equal(err.required, 1000n)
})

test('a funded run does not throw', async () => {
  const modus = makeModus()
  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(makeRunner(100n)),
    signorum: makeSignorum([makeSignum(500n)]),
    acta: makeActa(),
  })

  const actum = await inceptor.initiate(makeParams())

  assert.equal(actum.status, 'nascens')
})

test('throws when modus is not found', async () => {
  const modorum = {
    find: async () => null,
    register: async () => {},
    list: async () => [],
    update: unmodelled('Modorum', 'update'),
  }
  const inceptor = new ActumInceptor({
    modorum,
    cursorum: makeCursorum(makeRunner()),
    signorum: makeSignorum(),
    acta: makeActa(),
  })

  await assert.rejects(
    () => inceptor.initiate(makeParams()),
    /modus/i,
  )
})

// ── Arcanum path ──────────────────────────────────────────────────────────────

function makeArcanumSignum(valor: bigint, id = 'arc-1', commitment = 'hash-abc'): Signum {
  return { id, forma: 'arcanum', valor, auctor: 'test', testis: commitment, status: 'valid', natum: new Date() }
}

test('actum has no nullifier when payer is identified (animaId)', async () => {
  const modus = makeModus()
  const acta = makeActa()
  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(makeRunner(50n)),
    signorum: makeSignorum([makeSignum(500n)]),
    acta,
  })

  const actum = await inceptor.initiate(makeParams({ by: { animaId: 'anima-1' } }))

  assert.equal(actum.nullifier, undefined)
})

test('actum.nullifier is set to arcanum signum id when payer is arcanum', async () => {
  const modus = makeModus()
  const commitment = 'deadbeef'
  const arcSignum = makeArcanumSignum(500n, 'arc-sig-1', commitment)
  const acta = makeActa()
  const signorum = makeSignorum([arcSignum])
  // Override history to return by commitment
  const originalHistory = signorum.history.bind(signorum)
  signorum.history = async (by) => {
    if ('commitment' in by && by.commitment === commitment) return [arcSignum]
    return originalHistory(by)
  }

  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(makeRunner(100n)),
    signorum,
    acta,
  })

  const actum = await inceptor.initiate(makeParams({ by: { commitment } }))

  assert.equal(actum.nullifier, 'arc-sig-1')
})

test('initiate() rejects when nullifier is already recorded on an existing actum', async () => {
  const modus = makeModus()
  const commitment = 'deadbeef'
  const arcSignum = makeArcanumSignum(500n, 'arc-sig-2', commitment)

  // Pre-populate nullifier map with a previous actum
  const existingActum: Actum = {
    id: 'actum-previous', modusId: 'mod-1', modusVersiono: '1.0.0',
    impetus: 100n, signaConsumed: ['arc-sig-2'], aditus: {},
    status: 'completus', nullifier: 'arc-sig-2',
    inceptum: new Date(), expirat: new Date(),
  }
  const nullifierMap = new Map([['arc-sig-2', existingActum]])
  const acta = makeActa(nullifierMap)

  const signorum = makeSignorum([arcSignum])
  signorum.history = async () => [arcSignum]

  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(makeRunner(100n)),
    signorum,
    acta,
  })

  await assert.rejects(
    () => inceptor.initiate(makeParams({ by: { commitment } })),
    /already spent/i,
  )
})

// ---------------------------------------------------------------------------
// terminus → expirat
//
// `expirat` is the only thing that releases a locked reserve: the reaper fails any actum still
// in {nascens,agens} past it, and failing releases every locked signum. So the deadline a cursor
// declares is a statement about how long a payer's credits can stay locked against a run that is
// already dead — which is why it is clamped here rather than trusted.
// ---------------------------------------------------------------------------

function runnerWithTerminus(ms: number, reserve: bigint = 100n): Cursor {
  return { ...makeRunner(reserve), terminus: async () => ms }
}

test('a cursor declaring an absurd terminus is clamped to MAX_TERMINUS_MS, not honoured', async () => {
  const modus = makeModus()
  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(runnerWithTerminus(999 * 60 * 60 * 1000)),   // 999h
    signorum: makeSignorum(),
    acta: makeActa(),
  })

  const before = Date.now()
  const actum = await inceptor.initiate(makeParams())
  const after = Date.now()
  const upperMs = actum.expirat!.getTime() - after
  const lowerMs = actum.expirat!.getTime() - before

  assert.ok(upperMs <= MAX_TERMINUS_MS, `expected clamp to ${MAX_TERMINUS_MS}ms, got ${upperMs}ms`)
  assert.ok(lowerMs > MAX_TERMINUS_MS - 60_000, 'expected the clamped ceiling, not the default')
})

test('a cursor that declares no terminus keeps the default expiry', async () => {
  const modus = makeModus()
  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(makeRunner()),   // no terminus — the API-shaped cursors
    signorum: makeSignorum(),
    acta: makeActa(),
  })

  const before = Date.now()
  const actum = await inceptor.initiate(makeParams())
  const after = Date.now()
  const upperMs = actum.expirat!.getTime() - after
  const lowerMs = actum.expirat!.getTime() - before

  assert.ok(upperMs <= DEFAULT_EXPIRAT_MS && lowerMs > DEFAULT_EXPIRAT_MS - 60_000,
    `expected ~${DEFAULT_EXPIRAT_MS}ms, got ${upperMs}ms`)
})

test('a cursor-declared terminus is honoured below the ceiling', async () => {
  const modus = makeModus()
  const declared = 75 * 60 * 1000
  const inceptor = new ActumInceptor({
    modorum: makeModorum(modus),
    cursorum: makeCursorum(runnerWithTerminus(declared)),
    signorum: makeSignorum(),
    acta: makeActa(),
  })

  const before = Date.now()
  const actum = await inceptor.initiate(makeParams())
  const after = Date.now()
  const upperMs = actum.expirat!.getTime() - after
  const lowerMs = actum.expirat!.getTime() - before

  assert.ok(upperMs <= declared && lowerMs > declared - 60_000, `expected ~${declared}ms, got ${upperMs}ms`)
  assert.ok(lowerMs > DEFAULT_EXPIRAT_MS, 'a declared terminus must not collapse to the default')
})

test('the bursa payment path stamps the same resolved deadline as the identified path', async () => {
  const modus = makeModus()
  const declared = 75 * 60 * 1000
  const bursarium = {
    debit: async () => {}, credit: async () => {},
  } as unknown as NonNullable<ConstructorParameters<typeof ActumInceptor>[0]['bursarium']>
  const deps = {
    modorum: makeModorum(modus),
    cursorum: makeCursorum(runnerWithTerminus(declared)),
    signorum: makeSignorum(),
    acta: makeActa(),
    bursarium,
  }

  const before = Date.now()
  const identified = await new ActumInceptor(deps).initiate(makeParams())
  const afterIdentified = Date.now()
  const viaBursa = await new ActumInceptor(deps).initiate(makeParams({ by: { bursaToken: 'tok' } }))
  const afterBursa = Date.now()

  for (const [label, a, after] of [
    ['identified', identified, afterIdentified],
    ['bursa', viaBursa, afterBursa],
  ] as const) {
    const upperMs = a.expirat!.getTime() - after
    const lowerMs = a.expirat!.getTime() - before
    assert.ok(upperMs <= declared && lowerMs > declared - 60_000, `${label} path: expected ~${declared}ms, got ${upperMs}ms`)
  }
})
