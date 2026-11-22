import { test } from 'node:test'
import assert from 'node:assert/strict'

import { collectPhoto } from '../../../src/crystal/collectPhoto.js'
import { ensureDefaultDataset } from '../../../src/crystal/defaultDataset.js'
import { MemoryConsuetudinum } from '../../../src/crystal/MemoryConsuetudinum.js'
import { isArchived, liveMedia } from '../../../src/types/dataset.js'
import type { Dataset, DatasetListOpts, DatasetListPage, DatasetMediaItem, DatasetSummaryListPage, Datasets } from '../../../src/types/dataset.js'
import type { MediaFetcher } from '../../../src/crystal/MediaFetcher.js'
import type { ObjectStore } from '../../../src/crystal/R2Uploader.js'
import type { AuctorKey } from '../../../src/flow/types.js'

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
  async archiveDataset(): Promise<Dataset | null> { throw new Error('unused') }
  async restoreDataset(): Promise<Dataset | null> { throw new Error('unused') }
  async archiveMedia(): Promise<Dataset | null> { throw new Error('unused') }
  async restoreMedia(): Promise<Dataset | null> { throw new Error('unused') }
}

function fakeFetcher(bytes: Buffer): MediaFetcher {
  const seen: string[] = []
  return {
    fetch: async (url: string) => { seen.push(url); return bytes },
    seen,
  } as MediaFetcher & { seen: string[] }
}

function fakeStore(): ObjectStore & { puts: Array<{ key: string; bytes: Buffer; contentType: string }> } {
  const puts: Array<{ key: string; bytes: Buffer; contentType: string }> = []
  return {
    puts,
    async put(key: string, bytes: Buffer, contentType: string) {
      puts.push({ key, bytes, contentType })
      return `https://bucket.example/${key}`
    },
    async del() {},
  }
}

const owner: AuctorKey = { animaId: 'anima-1' }

test('collectPhoto mints a default dataset, downloads the Telegram URL, re-hosts it, and appends it', async () => {
  const datasets = new MemoryDatasets()
  const consuetudinum = new MemoryConsuetudinum()
  const bytes = Buffer.from('fake-jpeg-bytes')
  const fetcher = fakeFetcher(bytes)
  const store = fakeStore()

  const result = await collectPhoto(owner, 'https://api.telegram.org/file/bot123:secret/photos/file_1.jpg', {
    datasets, consuetudinum, fetcher, store,
  })

  assert.equal(result.count, 1)
  assert.equal(result.datasetName, 'Telegram collection')

  const dataset = await datasets.find(result.datasetId)
  assert.ok(dataset)
  assert.equal(dataset!.media.length, 1)
  const item = dataset!.media[0]
  assert.equal(item.source, 'upload')
  assert.equal(item.addedBy, 'anima-1')
  // The stored reference is OUR bucket's URL, never the transient Telegram link (clause 2).
  assert.ok(item.url.startsWith('https://bucket.example/'))
  assert.doesNotMatch(item.url, /api\.telegram\.org/)

  assert.equal(store.puts.length, 1)
  assert.equal(store.puts[0].contentType, 'image/jpeg')
  assert.deepEqual(store.puts[0].bytes, bytes)
})

test('collectPhoto reuses an existing default dataset and appends alongside what is already there', async () => {
  const datasets = new MemoryDatasets()
  const consuetudinum = new MemoryConsuetudinum()
  const deps = { datasets, consuetudinum }
  const seeded = await ensureDefaultDataset(owner, deps)
  await datasets.addMedia(seeded.id, [{ id: 'm0', url: 'https://bucket.example/already-there.jpg', source: 'upload', addedAt: new Date() }])

  const result = await collectPhoto(owner, 'https://api.telegram.org/file/bot123:secret/photos/file_2.jpg', {
    ...deps,
    fetcher: fakeFetcher(Buffer.from('more-bytes')),
    store: fakeStore(),
  })

  assert.equal(result.datasetId, seeded.id, 'lands in the SAME default dataset, not a new one')
  assert.equal(result.count, 2, 'counts what was already there plus the new photo')
})
