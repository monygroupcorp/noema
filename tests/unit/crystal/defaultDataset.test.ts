import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_DATASET_NAME,
  ensureDefaultDataset,
  getDefaultDataset,
  createDefaultDataset,
  setDefaultDataset,
  listOwnDatasets,
} from '../../../src/crystal/defaultDataset.js'
import { MemoryConsuetudinum } from '../../../src/crystal/MemoryConsuetudinum.js'
import { isArchived, liveMedia } from '../../../src/types/dataset.js'
import type { Dataset, DatasetListOpts, DatasetListPage, DatasetMediaItem, DatasetSummaryListPage, Datasets } from '../../../src/types/dataset.js'
import type { AuctorKey } from '../../../src/flow/types.js'

// ── In-memory Datasets double (same shape the existing route tests use) ──
class MemoryDatasets implements Datasets {
  private store = new Map<string, Dataset>()
  private seq = 0
  async create(input: Omit<Dataset, 'id' | 'natum' | 'mutatum'>): Promise<Dataset> {
    const now = new Date()
    const d: Dataset = { ...input, id: `ds-${++this.seq}`, natum: now, mutatum: now }
    this.store.set(d.id, d)
    return d
  }
  async find(id: string): Promise<Dataset | null> { return this.store.get(id) ?? null }
  async list(opts: DatasetListOpts): Promise<DatasetListPage> {
    return { entries: [...this.store.values()].filter((d) => d.owner === opts.owner && !isArchived(d)) }
  }
  async listSummaries(opts: DatasetListOpts): Promise<DatasetSummaryListPage> {
    const { entries } = await this.list(opts)
    return { entries: entries.map((d) => ({ id: d.id, name: d.name, images: liveMedia(d.media).length })) }
  }
  async addCaptionset(): Promise<Dataset | null> { throw new Error('unused') }
  async setCaption(): Promise<Dataset | null> { throw new Error('unused') }
  async setFragments(): Promise<Dataset | null> { throw new Error('unused') }
  async setAccess(): Promise<Dataset | null> { throw new Error('unused') }
  async addMedia(datasetId: string, items: DatasetMediaItem[]): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    if (!d) return null
    const updated: Dataset = { ...d, media: [...d.media, ...items], mutatum: new Date() }
    this.store.set(datasetId, updated)
    return updated
  }
  async archiveDataset(datasetId: string): Promise<Dataset | null> {
    const d = this.store.get(datasetId)
    if (!d) return null
    const updated: Dataset = { ...d, archivum: new Date() }
    this.store.set(datasetId, updated)
    return updated
  }
  async restoreDataset(): Promise<Dataset | null> { throw new Error('unused') }
  async archiveMedia(): Promise<Dataset | null> { throw new Error('unused') }
  async restoreMedia(): Promise<Dataset | null> { throw new Error('unused') }
}

function deps() {
  return { datasets: new MemoryDatasets(), consuetudinum: new MemoryConsuetudinum() }
}

const owner: AuctorKey = { animaId: 'anima-1' }
const other: AuctorKey = { animaId: 'anima-2' }

test('getDefaultDataset: no pointer set -> null, nothing minted', async () => {
  const d = deps()
  assert.equal(await getDefaultDataset(owner, d), null)
  assert.deepEqual((await d.datasets.list({ owner: 'anima-1' })).entries, [])
})

test('ensureDefaultDataset mints a named default exactly once and persists the pointer', async () => {
  const d = deps()
  const first = await ensureDefaultDataset(owner, d)
  assert.equal(first.name, DEFAULT_DATASET_NAME)
  assert.equal(first.owner, 'anima-1')
  assert.equal(first.modality, 'image')

  const second = await ensureDefaultDataset(owner, d)
  assert.equal(second.id, first.id, 'a second call reuses the same dataset, never minting another')

  const found = await getDefaultDataset(owner, d)
  assert.equal(found?.id, first.id)
})

test('an archived default dataset is not returned, and ensureDefaultDataset mints a fresh one', async () => {
  const d = deps()
  const first = await ensureDefaultDataset(owner, d)
  await d.datasets.archiveDataset(first.id)

  assert.equal(await getDefaultDataset(owner, d), null, 'archived -> not resolvable as the default')
  const second = await ensureDefaultDataset(owner, d)
  assert.notEqual(second.id, first.id, 'a fresh default is minted rather than reusing the archived one')
})

test('getDefaultDataset refuses a pointer that resolves to another account\'s dataset', async () => {
  const d = deps()
  const mine = await createDefaultDataset(owner, 'mine', d)
  // Point `other`'s Generatio at MY dataset id directly (bypassing setDefaultDataset's own guard).
  await d.consuetudinum.setGeneratio(other, { defaultDatasetId: mine.id })
  assert.equal(await getDefaultDataset(other, d), null)
})

test('setDefaultDataset matches by id, then by case-insensitive exact name, among the caller\'s OWN datasets', async () => {
  const d = deps()
  const a = await createDefaultDataset(owner, 'Vacation', d)
  const b = await d.datasets.create({ owner: 'anima-1', name: 'Portraits', modality: 'image', custody: 'remote', media: [], captionsets: [], versions: [] })

  const byName = await setDefaultDataset(owner, 'portraits', d)
  assert.equal(byName?.id, b.id)
  assert.equal((await getDefaultDataset(owner, d))?.id, b.id)

  const byId = await setDefaultDataset(owner, a.id, d)
  assert.equal(byId?.id, a.id)
  assert.equal((await getDefaultDataset(owner, d))?.id, a.id)
})

test('setDefaultDataset returns null for a name/id the caller does not own, and does not change the pointer', async () => {
  const d = deps()
  const mine = await createDefaultDataset(owner, 'mine', d)
  const theirs = await d.datasets.create({ owner: 'anima-2', name: 'not-mine', modality: 'image', custody: 'remote', media: [], captionsets: [], versions: [] })

  assert.equal(await setDefaultDataset(owner, 'nope', d), null)
  assert.equal(await setDefaultDataset(owner, theirs.id, d), null)
  assert.equal((await getDefaultDataset(owner, d))?.id, mine.id, 'pointer unchanged after a failed switch')
})

test('listOwnDatasets excludes archived datasets and other accounts\'', async () => {
  const d = deps()
  const live = await d.datasets.create({ owner: 'anima-1', name: 'live', modality: 'image', custody: 'remote', media: [], captionsets: [], versions: [] })
  const archived = await d.datasets.create({ owner: 'anima-1', name: 'gone', modality: 'image', custody: 'remote', media: [], captionsets: [], versions: [] })
  await d.datasets.archiveDataset(archived.id)
  await d.datasets.create({ owner: 'anima-2', name: 'theirs', modality: 'image', custody: 'remote', media: [], captionsets: [], versions: [] })

  const own = await listOwnDatasets(owner, d)
  assert.deepEqual(own.map((x) => x.id), [live.id])
})
