import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'

// The store half of GET /v1/me/earnings: earningTotals() and listEarnings(). Both answer
// "what has this identity been PAID", which is not the same question as balance() — spending
// a royalty does not unearn it — and is scoped to the earning auctors, so a deposit, a
// purchase and the platform's own skim are all excluded.

async function earner(): Promise<MemorySignorum> {
  const s = new MemorySignorum()
  await s.issue({ animaId: 'author', forma: 'reward', valor: 100n, auctor: 'nexus:spellRoyalty' })
  await s.issue({ animaId: 'author', forma: 'reward', valor: 50n, auctor: 'nexus:spellRoyalty' })
  await s.issue({ animaId: 'author', forma: 'reward', valor: 25n, auctor: 'nexus:modelRoyalty' })
  return s
}

test('earningTotals groups by auctor and sums valor', async () => {
  const s = await earner()
  const totals = await s.earningTotals({ animaId: 'author' })

  const spell = totals.find(t => t.auctor === 'nexus:spellRoyalty')
  const model = totals.find(t => t.auctor === 'nexus:modelRoyalty')
  assert.deepEqual(spell, { auctor: 'nexus:spellRoyalty', impetus: 150n, count: 2 })
  assert.deepEqual(model, { auctor: 'nexus:modelRoyalty', impetus: 25n, count: 1 })
  assert.equal(totals.length, 2, 'a stream that never paid is absent, not zero')
})

test('a deposit, a purchase and the platform skim are not earnings', async () => {
  const s = new MemorySignorum()
  await s.issue({ animaId: 'author', forma: 'eth', valor: 10_000n, auctor: 'alchemy-webhook' })
  await s.issue({ animaId: 'author', forma: 'integer', valor: 5_000n, auctor: 'stripe:purchase' })
  await s.issue({ animaId: 'author', forma: 'reward', valor: 900n, auctor: 'nexus:platformSkim' })
  await s.issue({ animaId: 'author', forma: 'reward', valor: 10n, auctor: 'nexus:hostCut' })

  const totals = await s.earningTotals({ animaId: 'author' })
  assert.deepEqual(totals, [{ auctor: 'nexus:hostCut', impetus: 10n, count: 1 }])
})

test('a royalty already spent is still earned', async () => {
  const s = await earner()
  const [first] = await s.listEarnings({ animaId: 'author' }, { limit: 100 }).then(p => p.entries)
  assert.ok(first)
  await s.lock([first.id], 'act-1')
  await s.settle([first.id], first.valor, 'act-1')

  const totals = await s.earningTotals({ animaId: 'author' })
  const lifetime = totals.reduce((sum, t) => sum + t.impetus, 0n)
  assert.equal(lifetime, 175n, 'earnings sum every status — this is a statement, not a balance')
})

test('earnings are scoped to the identity that earned them', async () => {
  const s = await earner()
  await s.issue({ animaId: 'stranger', forma: 'reward', valor: 999n, auctor: 'nexus:spellRoyalty' })

  const totals = await s.earningTotals({ animaId: 'author' })
  assert.equal(totals.reduce((sum, t) => sum + t.impetus, 0n), 175n)

  const page = await s.listEarnings({ animaId: 'author' }, { limit: 100 })
  assert.equal(page.entries.length, 3)
  assert.ok(page.entries.every(e => e.animaId === 'author'))
})

test('an anonymous host reads their own arcanum earnings by commitment', async () => {
  const s = new MemorySignorum()
  await s.issue({ forma: 'arcanum', valor: 40n, auctor: 'nexus:hostCut', testis: '0xdeadbeef' })
  await s.issue({ forma: 'arcanum', valor: 60n, auctor: 'nexus:hostCut', testis: '0xotherhost' })

  const totals = await s.earningTotals({ commitment: '0xdeadbeef' })
  assert.deepEqual(totals, [{ auctor: 'nexus:hostCut', impetus: 40n, count: 1 }])
})

test('listEarnings pages newest first and resumes on the cursor with no dupes or skips', async () => {
  const s = new MemorySignorum()
  for (let i = 0; i < 5; i++) {
    await s.issue({ animaId: 'author', forma: 'reward', valor: BigInt(i + 1), auctor: 'nexus:spellRoyalty' })
    // Distinct natum values, so the sort has something to order by.
    await new Promise(r => setTimeout(r, 2))
  }

  const first = await s.listEarnings({ animaId: 'author' }, { limit: 2 })
  assert.equal(first.entries.length, 2)
  assert.equal(first.entries[0]?.valor, 5n, 'newest first')
  assert.equal(first.entries[1]?.valor, 4n)
  assert.ok(first.nextCursor)

  const second = await s.listEarnings({ animaId: 'author' }, { limit: 2, cursor: first.nextCursor! })
  assert.deepEqual(second.entries.map(e => e.valor), [3n, 2n])

  const third = await s.listEarnings({ animaId: 'author' }, { limit: 2, cursor: second.nextCursor! })
  assert.deepEqual(third.entries.map(e => e.valor), [1n])
  assert.equal(third.nextCursor, undefined, 'no cursor on the last page')

  const seen = [...first.entries, ...second.entries, ...third.entries].map(e => e.id)
  assert.equal(new Set(seen).size, 5, 'every row seen exactly once')
})

test('an identity that never earned reads an empty statement, not an error', async () => {
  const s = new MemorySignorum()
  assert.deepEqual(await s.earningTotals({ animaId: 'nobody' }), [])
  assert.deepEqual(await s.listEarnings({ animaId: 'nobody' }, { limit: 20 }), { entries: [] })
})
