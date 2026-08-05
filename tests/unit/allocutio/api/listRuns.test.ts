import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi } from '../../../../src/allocutio/api/CrystalApi.js'
import { toSettledRun } from '../../../../src/allocutio/api/runProjection.js'
import { IMPETUS_USD_RATE } from '../../../../src/ledger/rates.js'
import type { ActumIndex } from '../../../../src/types/actumIndex.js'
import type { AuctorKey } from '../../../../src/flow/types.js'

// A settled ActumIndex row (retain-on-settle stamp present).
function settledRow(over: Partial<ActumIndex> = {}): ActumIndex {
  return {
    animaId: 'anima-1',
    actumId: 'act-1',
    modusId: 'modus-x',
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    settledAt: new Date('2026-07-02T00:00:00.000Z'),
    impetus: '1000',
    modusLabel: 'Portrait v2',
    ...over,
  }
}

test('toSettledRun projects cost + DERIVED costUsd + ISO timestamps + label', () => {
  const r = toSettledRun(settledRow())
  assert.equal(r.id, 'act-1')
  assert.equal(r.modusId, 'modus-x')
  assert.equal(r.modusLabel, 'Portrait v2')
  assert.equal(r.status, 'settled')
  assert.equal(r.cost, '1000')
  assert.equal(r.costUsd, 1000 * IMPETUS_USD_RATE)
  assert.equal(r.settledAt, '2026-07-02T00:00:00.000Z')
  assert.equal(r.createdAt, '2026-07-01T00:00:00.000Z')
})

test('toSettledRun falls back to modusId + 0 cost for an unstamped row', () => {
  const r = toSettledRun(settledRow({ impetus: undefined, modusLabel: undefined }))
  assert.equal(r.modusLabel, 'modus-x')
  assert.equal(r.cost, '0')
  assert.equal(r.costUsd, 0)
})

test('listRuns projects a page, derives running-total USD, and passes cursor + clamped limit through', async () => {
  let seenKey: AuctorKey | undefined
  let seenOpts: { limit: number; cursor?: string } | undefined
  const index = {
    async record() {},
    async findFor() { return [] },
    async remove() {},
    async listSettled(key: AuctorKey, opts: { limit: number; cursor?: string }) {
      seenKey = key
      seenOpts = opts
      return { entries: [settledRow(), settledRow({ actumId: 'act-2', impetus: '500' })], nextCursor: 'CUR2' }
    },
    async sumSettledImpetus() { return '1500' },
  }
  const api = new CrystalApi({ actumIndex: index } as any)

  const page = await api.listRuns({ animaId: 'anima-1' }, { cursor: 'CUR1', limit: 999 })

  assert.deepEqual(seenKey, { animaId: 'anima-1' })
  assert.equal(seenOpts?.cursor, 'CUR1')
  assert.equal(seenOpts?.limit, 100, 'limit clamped to 100')
  assert.equal(page.runs.length, 2)
  assert.equal(page.runs[0].cost, '1000')
  assert.equal(page.runs[1].cost, '500')
  assert.equal(page.nextCursor, 'CUR2')
  assert.equal(page.runningTotal.impetus, '1500')
  assert.equal(page.runningTotal.usd, 1500 * IMPETUS_USD_RATE)
})

test('listRuns defaults limit to 20 and omits nextCursor on the last page', async () => {
  let seenLimit = -1
  const index = {
    async record() {}, async findFor() { return [] }, async remove() {},
    async listSettled(_key: AuctorKey, opts: { limit: number; cursor?: string }) {
      seenLimit = opts.limit
      return { entries: [settledRow()] }
    },
    async sumSettledImpetus() { return '1000' },
  }
  const api = new CrystalApi({ actumIndex: index } as any)
  const page = await api.listRuns({ commitment: 'c-1' })
  assert.equal(seenLimit, 20)
  assert.equal(page.nextCursor, undefined)
})

test('listRuns degrades to an empty page when the wired index lacks settled-history methods', async () => {
  const index = { async record() {}, async findFor() { return [] }, async remove() {} }
  const api = new CrystalApi({ actumIndex: index } as any)
  const page = await api.listRuns({ animaId: 'anima-1' })
  assert.deepEqual(page.runs, [])
  assert.deepEqual(page.runningTotal, { impetus: '0', usd: 0 })
})
