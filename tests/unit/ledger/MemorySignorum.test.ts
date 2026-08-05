import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'

function makeSignum(overrides: Record<string, unknown> = {}) {
  return {
    animaId: 'anima-1',
    forma: 'minted' as const,
    valor: 1000n,
    auctor: 'test',
    ...overrides,
  }
}

// ── issue + balance ──────────────────────────────────────────────────────────

test('issue returns signum with id, natum, and status valid', async () => {
  const s = new MemorySignorum()
  const signum = await s.issue(makeSignum())

  assert.ok(signum.id, 'id must be set')
  assert.ok(signum.natum instanceof Date)
  assert.equal(signum.status, 'valid')
  assert.equal(signum.valor, 1000n)
})

test('balance sums all valid signa for the given animaId', async () => {
  const s = new MemorySignorum()
  await s.issue(makeSignum({ valor: 300n }))
  await s.issue(makeSignum({ valor: 700n }))

  const bal = await s.balance({ animaId: 'anima-1' })
  assert.equal(bal, 1000n)
})

test('balance returns zero for unknown animaId', async () => {
  const s = new MemorySignorum()
  const bal = await s.balance({ animaId: 'nobody' })
  assert.equal(bal, 0n)
})

test('balance scopes to animaId — other accounts excluded', async () => {
  const s = new MemorySignorum()
  await s.issue(makeSignum({ animaId: 'anima-1', valor: 500n }))
  await s.issue(makeSignum({ animaId: 'anima-2', valor: 500n }))

  const bal = await s.balance({ animaId: 'anima-1' })
  assert.equal(bal, 500n)
})

test('balance by commitment sums only signa with that commitment', async () => {
  const s = new MemorySignorum()
  // arcanum signum has no animaId — identified by commitment on the signum itself
  await s.issue({ forma: 'arcanum', valor: 400n, auctor: 'test', testis: 'hash-abc' })
  await s.issue({ forma: 'arcanum', valor: 600n, auctor: 'test', testis: 'hash-abc' })
  await s.issue({ forma: 'arcanum', valor: 999n, auctor: 'test', testis: 'hash-other' })

  // commitment lookup matches on signum.testis for arcanum forma
  const bal = await s.balance({ commitment: 'hash-abc' })
  assert.equal(bal, 1000n)
})

// ── lock ─────────────────────────────────────────────────────────────────────

test('lock removes signa from spendable balance', async () => {
  const s = new MemorySignorum()
  const a = await s.issue(makeSignum({ valor: 500n }))
  const b = await s.issue(makeSignum({ valor: 500n }))

  await s.lock([a.id, b.id], 'actum-1')

  const bal = await s.balance({ animaId: 'anima-1' })
  assert.equal(bal, 0n)
})

test('lock sets status to locked', async () => {
  const s = new MemorySignorum()
  const a = await s.issue(makeSignum())

  await s.lock([a.id], 'actum-1')
  const hist = await s.history({ animaId: 'anima-1' })

  assert.equal(hist[0].status, 'locked')
})

test('lock throws if any signum id is not found', async () => {
  const s = new MemorySignorum()
  const a = await s.issue(makeSignum())

  await assert.rejects(
    () => s.lock([a.id, 'ghost-id'], 'actum-1'),
    /not found/i
  )
})

test('lock is atomic — no signa locked if any id is missing', async () => {
  const s = new MemorySignorum()
  const a = await s.issue(makeSignum({ valor: 500n }))

  await assert.rejects(() => s.lock([a.id, 'ghost-id'], 'actum-1'))

  // a must still be valid — lock was rolled back
  const hist = await s.history({ animaId: 'anima-1' })
  assert.equal(hist[0].status, 'valid')
})

// ── release ──────────────────────────────────────────────────────────────────

test('release restores locked signa to valid', async () => {
  const s = new MemorySignorum()
  const a = await s.issue(makeSignum({ valor: 600n }))

  await s.lock([a.id], 'actum-1')
  await s.release([a.id])

  const bal = await s.balance({ animaId: 'anima-1' })
  assert.equal(bal, 600n)
})

test('release is no-op on already-settled signa', async () => {
  const s = new MemorySignorum()
  const a = await s.issue(makeSignum())

  await s.lock([a.id], 'actum-1')
  await s.settle([a.id], 1000n, 'actum-1')  // full valor, no refund
  await s.release([a.id])  // should not throw or change status

  const hist = await s.history({ animaId: 'anima-1' })
  assert.equal(hist[0].status, 'spent')
})

// ── history ──────────────────────────────────────────────────────────────────

test('history returns all signa including locked and spent', async () => {
  const s = new MemorySignorum()
  const a = await s.issue(makeSignum({ valor: 100n }))
  const b = await s.issue(makeSignum({ valor: 200n }))

  await s.lock([b.id], 'actum-1')
  await s.settle([b.id], 200n, 'actum-1')  // exact valor, no refund signum

  const hist = await s.history({ animaId: 'anima-1' })
  assert.equal(hist.length, 2)
})

test('history excludes signa from other animaIds', async () => {
  const s = new MemorySignorum()
  await s.issue(makeSignum({ animaId: 'anima-1' }))
  await s.issue(makeSignum({ animaId: 'anima-2' }))

  const hist = await s.history({ animaId: 'anima-1' })
  assert.equal(hist.length, 1)
})

// ── ownsAny (the API's run owner-scope oracle) ───────────────────────────────

test('ownsAny: true iff one of the ids belongs to the identity', async () => {
  const s = new MemorySignorum()
  const mine = await s.issue(makeSignum({ animaId: 'anima-1' }))
  const theirs = await s.issue(makeSignum({ animaId: 'anima-2' }))

  assert.equal(await s.ownsAny({ animaId: 'anima-1' }, [mine.id]), true)
  assert.equal(await s.ownsAny({ animaId: 'anima-1' }, ['unknown', mine.id]), true, 'any match → true')
  assert.equal(await s.ownsAny({ animaId: 'anima-1' }, [theirs.id]), false, 'not my signum')
  assert.equal(await s.ownsAny({ animaId: 'anima-1' }, []), false, 'empty → false')
})

test('ownsAny: anonymous commitment matches its arcanum signum (by testis)', async () => {
  const s = new MemorySignorum()
  const anon = await s.issue(makeSignum({ animaId: undefined, forma: 'arcanum', testis: 'c-1' }))
  assert.equal(await s.ownsAny({ commitment: 'c-1' }, [anon.id]), true)
  assert.equal(await s.ownsAny({ commitment: 'c-2' }, [anon.id]), false, 'wrong commitment')
  assert.equal(await s.ownsAny({ animaId: 'anima-1' }, [anon.id]), false, 'identified cannot claim an anon signum')
})
