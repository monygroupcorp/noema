import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TesseraCursor } from '../../../src/crystal/TesseraCursor.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import type { ModoStore, Modo } from '../../../src/types/modo.js'
import type { Cursor, CursorResult } from '../../../src/types/cursus.js'
import type { Modus } from '../../../src/types/modus.js'
import type { Actum } from '../../../src/types/actum.js'

// ── test doubles ──────────────────────────────────────────────────────────────

class MemoryModoStore implements ModoStore {
  private store = new Map<string, Modo>()
  async create(input: Omit<Modo, 'id' | 'inceptum'>): Promise<Modo> {
    const m: Modo = { ...input, id: `modo-${this.store.size + 1}`, inceptum: new Date() }
    this.store.set(m.id, m)
    return m
  }
  async findById(id: string): Promise<Modo | null> { return this.store.get(id) ?? null }
  async update(id: string, patch: Partial<Modo>): Promise<Modo> {
    const m = this.store.get(id)!
    const updated = { ...m, ...patch }
    this.store.set(id, updated)
    return updated
  }
  async findActive(): Promise<Modo[]> {
    return [...this.store.values()].filter(m => ['claiming','warming','active','idle'].includes(m.status))
  }
}

const fixedCursorResult: CursorResult = {
  kind: 'sync',
  exitus: { exitus: { url: 'http://cdn.x/img.png' }, impetus: 60n, duratio: 1000 },
}

const asyncCursorResult: CursorResult = {
  kind: 'async',
  externusJobId: 'job-ext-1',
}

class StubCursor implements Cursor {
  constructor(private readonly result: CursorResult = fixedCursorResult) {}
  async reserve(_modus: Modus): Promise<bigint> { return 120n }
  async run(_actum: Actum): Promise<CursorResult> { return this.result }
}

function makeModus(overrides: Partial<Modus> = {}): Modus {
  return {
    id: 'modus-flux',
    nomen: 'Flux Schnell',
    versio: '1.0.0',
    contentHash: 'abc',
    genus: 'atomicus',
    ministerium: 'runpod',
    aditus: [],
    exitus: [],
    natum: new Date(),
    mutatum: new Date(),
    ...overrides,
  } as unknown as Modus
}

function makeActum(overrides: Partial<Actum> = {}): Actum {
  const now = new Date()
  return {
    id: 'actum-1',
    modusId: 'modus-flux',
    modusVersiono: '1.0.0',
    impetus: 120n,
    signaConsumed: [],
    aditus: { prompt: 'a cat' },
    status: 'agens',
    inceptum: now,
    expirat: new Date(now.getTime() + 60_000),
    ...overrides,
  }
}

// ── openModo ──────────────────────────────────────────────────────────────────

test('openModo creates a Modo with status claiming', async () => {
  const cursor = new TesseraCursor(new StubCursor(), new MemoryModoStore(), new MemorySignorum())
  const { modo } = await cursor.openModo(1800n, { animaId: 'anima-abc' })
  assert.equal(modo.status, 'claiming')
})

test('openModo issues a tessera signum linked to modoId', async () => {
  const signorum = new MemorySignorum()
  const cursor = new TesseraCursor(new StubCursor(), new MemoryModoStore(), signorum)
  const { modo, tessera } = await cursor.openModo(1800n, { animaId: 'anima-abc' })
  assert.equal(tessera.forma, 'tessera')
  assert.equal(tessera.modoId, modo.id)
  assert.equal(tessera.valor, 1800n)
})

test('openModo tessera has no animaId — privacy partition', async () => {
  const cursor = new TesseraCursor(new StubCursor(), new MemoryModoStore(), new MemorySignorum())
  const { tessera } = await cursor.openModo(1800n, { animaId: 'anima-abc' })
  assert.equal(tessera.animaId, undefined)
})

test('openModo tessera is valid on issue', async () => {
  const signorum = new MemorySignorum()
  const cursor = new TesseraCursor(new StubCursor(), new MemoryModoStore(), signorum)
  const { tessera } = await cursor.openModo(500n, { animaId: 'anima-abc' })
  assert.equal(tessera.status, 'valid')
})

test('openModo sets idleWarmthSec from argument', async () => {
  const cursor = new TesseraCursor(new StubCursor(), new MemoryModoStore(), new MemorySignorum())
  const { modo } = await cursor.openModo(1800n, { animaId: 'anima-abc' }, 600)
  assert.equal(modo.idleWarmthSec, 600)
})

test('openModo defaults idleWarmthSec to 300', async () => {
  const cursor = new TesseraCursor(new StubCursor(), new MemoryModoStore(), new MemorySignorum())
  const { modo } = await cursor.openModo(1800n, { animaId: 'anima-abc' })
  assert.equal(modo.idleWarmthSec, 300)
})

// ── reserve ───────────────────────────────────────────────────────────────────

test('reserve delegates to inner cursor', async () => {
  const cursor = new TesseraCursor(new StubCursor(), new MemoryModoStore(), new MemorySignorum())
  const cost = await cursor.reserve(makeModus(), {})
  assert.equal(cost, 120n)
})

// ── run ───────────────────────────────────────────────────────────────────────

test('run delegates to inner cursor and returns CursorResult', async () => {
  const cursor = new TesseraCursor(new StubCursor(), new MemoryModoStore(), new MemorySignorum())
  const result = await cursor.run(makeActum())
  assert.equal(result.kind, 'sync')
  assert.equal((result as Extract<typeof result, { kind: 'sync' }>).exitus.impetus, 60n)
})

test('run with modo does NOT accrue spend — the cursor figure is not the settled one', async () => {
  // `Modo.impetusAccrued` holds what the ledger SETTLED (post-surcharge, post-cap).
  // That number does not exist until ActumCompletor settles the run, so the cursor
  // must leave the counter alone rather than write its own pre-settlement figure.
  // Parity across both rails: tests/unit/execution/sessionSpendParity.test.ts.
  const modos = new MemoryModoStore()
  const cursor = new TesseraCursor(new StubCursor(), modos, new MemorySignorum())
  const { modo } = await cursor.openModo(1800n, { animaId: 'anima-abc' })
  const actum = makeActum({ id: 'actum-x', impetus: 60n })
  await cursor.run(actum, modo)
  const updated = await modos.findById(modo.id)
  assert.equal(updated!.impetusAccrued, 0n)
})

test('run with modo appends actumId to modo.acta', async () => {
  const modos = new MemoryModoStore()
  const cursor = new TesseraCursor(new StubCursor(), modos, new MemorySignorum())
  const { modo } = await cursor.openModo(1800n, { animaId: 'anima-abc' })
  const actum = makeActum({ id: 'actum-run' })
  await cursor.run(actum, modo)
  const updated = await modos.findById(modo.id)
  assert.ok(updated!.acta.includes('actum-run'))
})

test('run without modo does not throw', async () => {
  const cursor = new TesseraCursor(new StubCursor(), new MemoryModoStore(), new MemorySignorum())
  await assert.doesNotReject(() => cursor.run(makeActum()))
})

test('run accumulates acta across multiple runs, and still no spend', async () => {
  const modos = new MemoryModoStore()
  const cursor = new TesseraCursor(new StubCursor(), modos, new MemorySignorum())
  const { modo } = await cursor.openModo(1800n, { animaId: 'anima-abc' })
  await cursor.run(makeActum({ id: 'a1' }), modo)
  const m1 = await modos.findById(modo.id)
  await cursor.run(makeActum({ id: 'a2' }), m1!)
  const m2 = await modos.findById(modo.id)
  assert.deepEqual(m2!.acta, ['a1', 'a2'])
  assert.equal(m2!.impetusAccrued, 0n, 'spend accrues at settlement, not at dispatch')
})

test('run with async result still appends actumId to modo.acta', async () => {
  const modos = new MemoryModoStore()
  const cursor = new TesseraCursor(new StubCursor(asyncCursorResult), modos, new MemorySignorum())
  const { modo } = await cursor.openModo(1800n, { animaId: 'anima-abc' })
  await cursor.run(makeActum({ id: 'actum-async' }), modo)
  const updated = await modos.findById(modo.id)
  assert.ok(updated!.acta.includes('actum-async'))
})

test('run with async result does not update impetusAccrued — actual cost unknown until webhook', async () => {
  const modos = new MemoryModoStore()
  const cursor = new TesseraCursor(new StubCursor(asyncCursorResult), modos, new MemorySignorum())
  const { modo } = await cursor.openModo(1800n, { animaId: 'anima-abc' })
  await cursor.run(makeActum({ id: 'actum-async' }), modo)
  const updated = await modos.findById(modo.id)
  assert.equal(updated!.impetusAccrued, 0n)
})
