import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CANONICAL_ESSENTIAE } from '../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_FUNDAMENTA } from '../../../src/crystal/seeds/fundamenta.js'
import { CANONICAL_INTELLAE } from '../../../src/crystal/seeds/intellae.js'
import { podDiskGbFor, DEFAULT_POD_DISK_GB, POD_DISK_HEADROOM_GB } from '../../../src/crystal/podDisk.js'

// A pod that cannot hold its own weights fails LATE and MISLEADINGLY: provisioning succeeds,
// the bootstrap succeeds, and then `wget` exits 3 partway through the fetch, surfacing as
// "model download failed" against a mirror URL that is perfectly fine. noema-372's first
// successful provision died this way — three small weights landed, the 21 GB DiT and 27 GB
// text encoder did not, on the flat 40 GB `containerDiskInGb` every pod used to get.
//
// The disk is now derived (`podDiskGbFor`), so this guard is not checking a declaration —
// it is checking that the derivation actually covers every seeded flow, and it fails loudly
// if someone reintroduces a flat size.

const sizeById = new Map(CANONICAL_INTELLAE.map(i => [i.id, i.sizeGb ?? 0]))
const fundById = new Map(CANONICAL_FUNDAMENTA.map(f => [f.id, f]))

/** Weight GB a pod-dispatched flow must hold: its fundament's manifest ∪ its own extras. */
function weightGbFor(essentiaId: string): number | null {
  const e = CANONICAL_ESSENTIAE.find(x => x.id === essentiaId)
  if (!e || e.ministerium !== 'runpod' || !e.fundamentumId) return null
  const f = fundById.get(e.fundamentumId)
  const ids = [...(f?.intellae ?? []), ...(e.intellae ?? [])].map(w => w.id)
  return ids.reduce((sum, id) => sum + (sizeById.get(id) ?? 0), 0)
}

const podFlows = CANONICAL_ESSENTIAE.filter(e => e.ministerium === 'runpod' && e.fundamentumId)

test('the walk finds pod-dispatched flows at all (guard is not vacuous)', () => {
  assert.ok(podFlows.length > 0)
})

test('every pod flow gets a disk that holds its weights plus working room', () => {
  const tooSmall: string[] = []
  for (const e of podFlows) {
    const gb = weightGbFor(e.id)
    if (gb === null) continue
    const granted = podDiskGbFor(gb)
    if (granted < gb + POD_DISK_HEADROOM_GB) {
      tooSmall.push(`${e.id}: ${gb.toFixed(1)} GB of weights, ${granted} GB granted`)
    }
  }
  assert.deepEqual(tooSmall, [], 'the derived disk must cover weights + headroom for every flow')
})

test('the flows that used to overflow the flat default now get more than it', () => {
  // Regression pins, computed from the seeds rather than hardcoded totals: these are the
  // flows whose weights alone exceed what every pod used to be given.
  const overflowing = podFlows
    .filter(e => (weightGbFor(e.id) ?? 0) + POD_DISK_HEADROOM_GB > DEFAULT_POD_DISK_GB)
    .map(e => e.id)

  assert.ok(overflowing.includes('minimax-h3-t2v'), 'minimax h3 is one of them')
  assert.ok(overflowing.some(id => id.startsWith('ltx-')), 'so is ltx, which is why this is not a minimax bug')

  for (const id of overflowing) {
    assert.ok(podDiskGbFor(weightGbFor(id)!) > DEFAULT_POD_DISK_GB,
      `${id} must be granted more than the flat default`)
  }
})

test('a flow that comfortably fits still gets the default (no needless churn)', () => {
  // Emitting a disk for everything would change every ComfyUI flow's compiled-spec hash.
  const small = podFlows.find(e => (weightGbFor(e.id) ?? 999) + POD_DISK_HEADROOM_GB <= DEFAULT_POD_DISK_GB)
  assert.ok(small, 'expected at least one flow that fits the default')
  assert.equal(podDiskGbFor(weightGbFor(small.id)!), DEFAULT_POD_DISK_GB)
})
