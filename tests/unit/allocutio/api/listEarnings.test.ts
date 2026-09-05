import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi } from '../../../../src/allocutio/api/CrystalApi.js'
import { toEarning } from '../../../../src/allocutio/api/runProjection.js'
import { MemorySignorum } from '../../../../src/ledger/MemorySignorum.js'
import { IMPETUS_USD_RATE } from '../../../../src/ledger/rates.js'
import type { Signum } from '../../../../src/types/significandi.js'

// GET /v1/me/earnings — the read side of the royalty rails. A run pays its flow's author and
// its models' authors, a guest gen pays the pod's host, a referred deposit pays the referrer;
// all of it lands as ledger rows on the earner, and this is where the earner reads it back.

function row(over: Partial<Signum> = {}): Signum {
  return {
    id: 'sig-1',
    animaId: 'author',
    forma: 'reward',
    valor: 100n,
    auctor: 'nexus:spellRoyalty',
    status: 'valid',
    natum: new Date('2026-07-02T00:00:00.000Z'),
    ...over,
  }
}

test('toEarning projects impetus + DERIVED usd + ISO timestamp + the stream it came from', () => {
  const e = toEarning(row({ auctor: 'nexus:hostCut', valor: 250n, contextId: 'studio-9' }))
  assert.equal(e.id, 'sig-1')
  assert.equal(e.kind, 'host-cut')
  assert.equal(e.impetus, '250')
  assert.equal(e.usd, 250 * IMPETUS_USD_RATE)
  assert.equal(e.earnedAt, '2026-07-02T00:00:00.000Z')
  assert.equal(e.studioId, 'studio-9')
})

test('toEarning leaves studioId absent on a royalty, which is not served from a studio', () => {
  assert.equal(toEarning(row()).studioId, undefined)
})

test('toEarning refuses a row that is not an earning rather than guessing a kind', () => {
  assert.throws(() => toEarning(row({ auctor: 'stripe:purchase' })), /not an earning auctor/)
})

test('listEarnings reports the lifetime total, the streams behind it, and the payments', async () => {
  const signorum = new MemorySignorum()
  await signorum.issue({ animaId: 'author', forma: 'reward', valor: 100n, auctor: 'nexus:spellRoyalty' })
  await signorum.issue({ animaId: 'author', forma: 'reward', valor: 50n, auctor: 'nexus:spellRoyalty' })
  await signorum.issue({ animaId: 'author', forma: 'reward', valor: 25n, auctor: 'nexus:modelRoyalty' })
  // Not earnings: a deposit the account funded itself, and the platform's own skim.
  await signorum.issue({ animaId: 'author', forma: 'eth', valor: 9_000n, auctor: 'alchemy-webhook' })
  await signorum.issue({ animaId: 'author', forma: 'reward', valor: 700n, auctor: 'nexus:platformSkim' })

  const api = new CrystalApi({ signorum } as any)
  const view = await api.listEarnings({ animaId: 'author' })

  assert.equal(view.lifetime.impetus, '175', 'the deposit and the platform skim are not earnings')
  assert.equal(view.lifetime.usd, 175 * IMPETUS_USD_RATE)
  assert.deepEqual(view.streams.map(s => s.kind), ['spell-royalty', 'model-royalty'], 'stable display order')
  assert.deepEqual(view.streams[0], {
    kind: 'spell-royalty', impetus: '150', usd: 150 * IMPETUS_USD_RATE, count: 2,
  })
  assert.equal(view.earnings.length, 3)
  assert.ok(view.earnings.every(e => e.kind === 'spell-royalty' || e.kind === 'model-royalty'))
})

test('listEarnings shows one earner nothing of another earner', async () => {
  const signorum = new MemorySignorum()
  await signorum.issue({ animaId: 'author', forma: 'reward', valor: 100n, auctor: 'nexus:spellRoyalty' })
  await signorum.issue({ animaId: 'stranger', forma: 'reward', valor: 9_999n, auctor: 'nexus:spellRoyalty' })

  const api = new CrystalApi({ signorum } as any)
  assert.equal((await api.listEarnings({ animaId: 'author' })).lifetime.impetus, '100')
  assert.equal((await api.listEarnings({ animaId: 'stranger' })).lifetime.impetus, '9999')
})

test('listEarnings clamps the page size and passes the cursor through', async () => {
  let seen: { limit: number; cursor?: string } | undefined
  const signorum = {
    async earningTotals() { return [] },
    async listEarnings(_by: unknown, opts: { limit: number; cursor?: string }) {
      seen = opts
      return { entries: [], nextCursor: 'CUR2' }
    },
  }
  const api = new CrystalApi({ signorum } as any)

  const view = await api.listEarnings({ animaId: 'author' }, { cursor: 'CUR1', limit: 999 })
  assert.equal(seen?.cursor, 'CUR1')
  assert.equal(seen?.limit, 100, 'limit clamped to 100')
  assert.equal(view.nextCursor, 'CUR2')

  await api.listEarnings({ animaId: 'author' })
  assert.equal(seen?.limit, 20, 'default page size')
})

test('a bursa-token caller has no ledger identity, so it reads an empty statement', async () => {
  let touched = false
  const signorum = {
    async earningTotals() { touched = true; return [] },
    async listEarnings() { touched = true; return { entries: [] } },
  }
  const api = new CrystalApi({ signorum } as any)

  const view = await api.listEarnings({ bursaToken: 'tok-1' })
  assert.deepEqual(view, { lifetime: { impetus: '0', usd: 0 }, streams: [], earnings: [] })
  assert.equal(touched, false, 'a token with no identity never reaches the ledger')
})
