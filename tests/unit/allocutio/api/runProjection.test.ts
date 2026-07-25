import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toRun, toRunDetail, toCollection } from '../../../../src/allocutio/api/runProjection.js'
import type { Actum, ActumStatus } from '../../../../src/types/actum.js'
import type { Collectio } from '../../../../src/types/collectio.js'

function makeActum(over: Partial<Actum>): Actum {
  return {
    id: 'actum-1',
    modusId: 'modus-1',
    modusVersiono: '1.0.0',
    impetus: 0n,
    signaConsumed: [],
    aditus: {},
    status: 'nascens',
    inceptum: new Date('2026-06-09T00:00:00.000Z'),
    expirat: new Date('2026-06-09T01:00:00.000Z'),
    ...over,
  }
}

test('status maps each ActumStatus to the public RunStatus', () => {
  const cases: Array<[ActumStatus, string]> = [
    ['nascens', 'pending'],
    ['agens', 'running'],
    ['completus', 'complete'],
    ['fractus', 'failed'],
  ]
  for (const [status, expected] of cases) {
    const run = toRun(makeActum({ status }))
    assert.equal(run.status, expected, `${status} → ${expected}`)
  }
})

test('fractus actum surfaces failure with execution_error code and the error message', () => {
  const run = toRun(makeActum({ status: 'fractus', error: 'boom' }))
  assert.equal(run.status, 'failed')
  assert.ok(run.failure)
  assert.equal(run.failure?.code, 'run.execution_error')
  assert.equal(run.failure?.message, 'boom')
})

test('fractus without error falls back to a default message', () => {
  const run = toRun(makeActum({ status: 'fractus' }))
  assert.equal(run.failure?.message, 'run failed')
})

test('cost is the impetus bigint serialised as a string', () => {
  const run = toRun(makeActum({ impetus: 12345n }))
  assert.equal(run.cost, '12345')
  assert.equal(typeof run.cost, 'string')
})

test('createdAt is the inceptum as an ISO string', () => {
  const run = toRun(makeActum({ inceptum: new Date('2026-06-09T00:00:00.000Z') }))
  assert.equal(run.createdAt, '2026-06-09T00:00:00.000Z')
})

test('completus actum surfaces exitus', () => {
  const run = toRun(makeActum({ status: 'completus', exitus: { image: 'http://x/y.png' } }))
  assert.equal(run.status, 'complete')
  assert.deepEqual(run.exitus, { image: 'http://x/y.png' })
})

test('no failure on non-fractus runs', () => {
  const run = toRun(makeActum({ status: 'completus' }))
  assert.equal(run.failure, undefined)
})

test('toRun does not surface aditus, pinnedModels, or modusVersion', () => {
  const run = toRun(makeActum({
    aditus: { prompt: 'a cat' },
    pinnedModels: [{ role: 'checkpoint', modelId: 'sd15' } as any],
  }))
  assert.equal((run as any).aditus, undefined)
  assert.equal((run as any).pinnedModels, undefined)
  assert.equal((run as any).modusVersion, undefined)
})

test('toRunDetail includes everything toRun does', () => {
  const detail = toRunDetail(makeActum({ status: 'completus', impetus: 12345n }))
  const run = toRun(makeActum({ status: 'completus', impetus: 12345n }))
  assert.equal(detail.id, run.id)
  assert.equal(detail.status, run.status)
  assert.equal(detail.modusId, run.modusId)
  assert.equal(detail.cost, run.cost)
})

test('toRunDetail echoes aditus verbatim, including an unresolved shuffle sentinel', () => {
  const detail = toRunDetail(makeActum({ aditus: { prompt: 'a cat', seed: 'shuffle' } }))
  assert.deepEqual(detail.aditus, { prompt: 'a cat', seed: 'shuffle' })
})

test('toRunDetail surfaces pinnedModels when present', () => {
  const pinnedModels = [{ role: 'checkpoint', modelId: 'sd15' } as any]
  const detail = toRunDetail(makeActum({ pinnedModels }))
  assert.deepEqual(detail.pinnedModels, pinnedModels)
})

test('toRunDetail is absent pinnedModels when the Actum has none', () => {
  const detail = toRunDetail(makeActum({}))
  assert.equal(detail.pinnedModels, undefined)
})

test('toRunDetail surfaces the cast-time modus version under the plain name', () => {
  const detail = toRunDetail(makeActum({ modusVersiono: '2.3.1' }))
  assert.equal(detail.modusVersion, '2.3.1')
})

function makeCollectio(over: Partial<Collectio> = {}): Collectio {
  return {
    id: 'col-1',
    modusId: 'modus-1',
    aditusBase: {},
    tractus: [],
    numerus: 3,
    provenanceHash: 'sha256:test',
    by: { animaId: 'anima-1' },
    acta: [],
    completae: 0,
    fractae: 0,
    reiectae: 0,
    concurrentia: 2,
    impetusTotal: 0n,
    status: 'agens',
    natum: new Date('2026-06-09T00:00:00.000Z'),
    ...over,
  }
}

test('toCollection: paused is absent when pausatum is unset (running normally)', () => {
  const col = toCollection(makeCollectio())
  assert.equal(col.paused, undefined)
})

test('toCollection: paused is true when pausatum is set', () => {
  const col = toCollection(makeCollectio({ pausatum: new Date('2026-07-10T00:00:00.000Z') }))
  assert.equal(col.paused, true)
})
