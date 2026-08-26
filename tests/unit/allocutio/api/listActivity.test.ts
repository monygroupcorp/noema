// =============================================================================
// listActivity — the owner's activity read (`GET /v1/me/activity`)
// =============================================================================
//
// One owner-scoped projection of in-flight + settled runs, newest first, each row
// carrying its kind and a door to the artifact the run produced. Read-only: it
// composes the run index's two existing owner-scoped listings and writes nothing.
//
// Hermetic: in-memory doubles only. No DB, no network.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi, activityKindFor, activityDoorFor } from '../../../../src/allocutio/api/CrystalApi.js'
import type { ActumIndex } from '../../../../src/types/actumIndex.js'
import type { AuctorKey } from '../../../../src/flow/types.js'

const TRAINING = 'modus.aitoolkit-training'
const CAPTION = 'modus.dataset-caption'
const DECOMPOSE = 'modus.dataset-decompose'

/** An in-flight index row (no settle stamp). */
function inFlightRow(over: Partial<ActumIndex> = {}): ActumIndex {
  return {
    animaId: 'anima-1',
    actumId: 'act-live',
    modusId: 'flux-schnell',
    createdAt: new Date('2026-07-05T00:00:00.000Z'),
    ...over,
  }
}

/** A settled index row (retain-on-settle stamp present). */
function settledRow(over: Partial<ActumIndex> = {}): ActumIndex {
  return {
    animaId: 'anima-1',
    actumId: 'act-done',
    modusId: TRAINING,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    settledAt: new Date('2026-07-02T00:00:00.000Z'),
    impetus: '1000',
    modusLabel: 'Style trainer',
    ...over,
  }
}

interface Fixture {
  inFlight?: ActumIndex[]
  settled?: ActumIndex[]
  nextCursor?: string
  acta?: Record<string, { aditus?: Record<string, unknown>; exitus?: Record<string, unknown> }>
}

/** A CrystalApi wired to in-memory index + actum doubles, owner-scoped by the index key. */
function apiFor(f: Fixture) {
  const seen: { key?: AuctorKey; opts?: { limit: number; cursor?: string }; findForCalls: number } = { findForCalls: 0 }
  const owns = (key: AuctorKey, e: ActumIndex) => 'animaId' in key && e.animaId === key.animaId
  const index = {
    async record() {},
    async findFor(key: AuctorKey) {
      seen.findForCalls++
      return (f.inFlight ?? []).filter(e => owns(key, e))
    },
    async remove() {},
    async listSettled(key: AuctorKey, opts: { limit: number; cursor?: string }) {
      seen.key = key
      seen.opts = opts
      const entries = (f.settled ?? []).filter(e => owns(key, e))
      return { entries, ...(f.nextCursor ? { nextCursor: f.nextCursor } : {}) }
    },
    async sumSettledImpetus() { return '0' },
  }
  const actorum = {
    async findById(id: string) {
      const a = f.acta?.[id]
      return a ? { id, ...a } : null
    },
  }
  return { api: new CrystalApi({ actumIndex: index, actorum } as any), seen }
}

test('activityKindFor maps the asset-producing flows and falls back to generation', () => {
  assert.equal(activityKindFor(TRAINING), 'training')
  assert.equal(activityKindFor(CAPTION), 'caption')
  assert.equal(activityKindFor(DECOMPOSE), 'decompose')
  // Pod flows carry essentia-derived ids — no prefix classifies them.
  assert.equal(activityKindFor('flux-schnell'), 'generation')
  assert.equal(activityKindFor('modus.chatgpt'), 'generation')
})

test('listActivity includes IN-FLIGHT rows alongside settled ones, newest first', async () => {
  const { api } = apiFor({
    inFlight: [inFlightRow()],
    settled: [settledRow()],
  })
  const page = await api.listActivity({ animaId: 'anima-1' })
  assert.deepEqual(page.activity.map(r => r.actumId), ['act-live', 'act-done'])
  assert.equal(page.activity[0].status, 'running')
  assert.equal(page.activity[0].settledAt, undefined)
  assert.equal(page.activity[1].status, 'settled')
  assert.equal(page.activity[1].settledAt, '2026-07-02T00:00:00.000Z')
  assert.equal(page.activity[1].modusLabel, 'Style trainer')
})

test('listActivity reports each row\'s kind from the modus table', async () => {
  const { api } = apiFor({
    settled: [
      settledRow({ actumId: 'a-train', modusId: TRAINING, createdAt: new Date('2026-07-04T00:00:00.000Z') }),
      settledRow({ actumId: 'a-cap', modusId: CAPTION, createdAt: new Date('2026-07-03T00:00:00.000Z') }),
      settledRow({ actumId: 'a-dec', modusId: DECOMPOSE, createdAt: new Date('2026-07-02T00:00:00.000Z') }),
      settledRow({ actumId: 'a-gen', modusId: 'flux-schnell', createdAt: new Date('2026-07-01T00:00:00.000Z') }),
    ],
  })
  const page = await api.listActivity({ animaId: 'anima-1' })
  assert.deepEqual(
    page.activity.map(r => [r.actumId, r.kind]),
    [['a-train', 'training'], ['a-cap', 'caption'], ['a-dec', 'decompose'], ['a-gen', 'generation']],
  )
})

test('listActivity opens a door per kind from the run record', async () => {
  const { api } = apiFor({
    settled: [
      settledRow({ actumId: 'a-train', modusId: TRAINING, createdAt: new Date('2026-07-04T00:00:00.000Z') }),
      settledRow({ actumId: 'a-cap', modusId: CAPTION, createdAt: new Date('2026-07-03T00:00:00.000Z') }),
      settledRow({ actumId: 'a-dec', modusId: DECOMPOSE, createdAt: new Date('2026-07-02T00:00:00.000Z') }),
      settledRow({ actumId: 'a-gen', modusId: 'flux-schnell', createdAt: new Date('2026-07-01T00:00:00.000Z') }),
    ],
    acta: {
      'a-train': { aditus: { dataset: 'ds-1' }, exitus: { loraId: 'model-1', loraUrl: 'https://example.invalid/w.safetensors' } },
      'a-cap': { aditus: { dataset: 'ds-1' }, exitus: { captionsetId: 'cs-1' } },
      'a-dec': { aditus: { dataset: 'ds-1', captionset: 'cs-1' }, exitus: {} },
      'a-gen': { aditus: { prompt: 'a cat' }, exitus: { image: 'https://example.invalid/out.png' } },
    },
  })
  const rows = (await api.listActivity({ animaId: 'anima-1' })).activity
  assert.deepEqual(rows[0].door, { modelId: 'model-1', datasetId: 'ds-1' })
  assert.deepEqual(rows[1].door, { captionsetId: 'cs-1', datasetId: 'ds-1' })
  assert.deepEqual(rows[2].door, { datasetId: 'ds-1', captionsetId: 'cs-1' })
  assert.deepEqual(rows[3].door, { mediaUrl: 'https://example.invalid/out.png' })
})

test('listActivity omits the door when the run recorded no artifact — never a guess', async () => {
  const { api } = apiFor({
    settled: [settledRow({ actumId: 'a-train', modusId: TRAINING })],
    acta: { 'a-train': { aditus: {}, exitus: { trained: true } } },
  })
  const rows = (await api.listActivity({ animaId: 'anima-1' })).activity
  assert.equal(rows[0].door, undefined)
})

test('listActivity omits the door when the run record is unreachable', async () => {
  const { api } = apiFor({ settled: [settledRow({ actumId: 'a-train', modusId: TRAINING })] })
  const rows = (await api.listActivity({ animaId: 'anima-1' })).activity
  assert.equal(rows.length, 1)
  assert.equal(rows[0].door, undefined)
})

test('activityDoorFor: a partial training exitus yields only the fields present', () => {
  assert.deepEqual(activityDoorFor('training', { dataset: 'ds-1' }, {}), { datasetId: 'ds-1' })
  assert.deepEqual(activityDoorFor('training', {}, { loraId: 'model-1' }), { modelId: 'model-1' })
  assert.equal(activityDoorFor('generation', {}, { text: 'not a url' }), undefined)
})

test('listActivity is owner-scoped — a foreign key sees nothing', async () => {
  const { api } = apiFor({
    inFlight: [inFlightRow()],
    settled: [settledRow()],
    acta: { 'act-done': { exitus: { loraId: 'model-1' } } },
  })
  const page = await api.listActivity({ animaId: 'anima-2' })
  assert.deepEqual(page.activity, [])
})

test('listActivity pages settled history: cursor + clamped limit through, in-flight only on the first page', async () => {
  const { api, seen } = apiFor({
    inFlight: [inFlightRow()],
    settled: [settledRow()],
    nextCursor: 'CUR2',
  })

  const first = await api.listActivity({ animaId: 'anima-1' }, { limit: 999 })
  assert.deepEqual(seen.key, { animaId: 'anima-1' })
  assert.equal(seen.opts?.limit, 100, 'limit clamped to 100')
  assert.equal(seen.opts?.cursor, undefined)
  assert.equal(seen.findForCalls, 1)
  assert.equal(first.nextCursor, 'CUR2')
  assert.deepEqual(first.activity.map(r => r.actumId), ['act-live', 'act-done'])

  const next = await api.listActivity({ animaId: 'anima-1' }, { cursor: 'CUR2' })
  assert.equal(seen.opts?.cursor, 'CUR2')
  assert.equal(seen.opts?.limit, 20, 'limit defaults to 20')
  assert.equal(seen.findForCalls, 1, 'in-flight rows are not re-listed on a cursor page')
  assert.deepEqual(next.activity.map(r => r.actumId), ['act-done'])
})

test('listActivity degrades to an empty page when the wired index lacks settled listing', async () => {
  const index = { async record() {}, async findFor() { return [] }, async remove() {} }
  const api = new CrystalApi({ actumIndex: index } as any)
  const page = await api.listActivity({ animaId: 'anima-1' })
  assert.deepEqual(page.activity, [])
  assert.equal(page.nextCursor, undefined)
})
