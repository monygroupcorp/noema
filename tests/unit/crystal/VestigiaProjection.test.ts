import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectVestigia, type ProjectionItem } from '../../../src/crystal/VestigiaProjection.js'

// A fixed embedding fixture: two well-separated clusters in a low-dim subspace of
// a higher-dim embedding, plus a lone outlier. Deterministic — no RNG anywhere in
// the projection path — so re-running this test always yields the same output.
function fixture(): ProjectionItem[] {
  const dim = 16
  const mk = (base: number, jitter: number, id: string, text: string): ProjectionItem => {
    const embedding = new Array(dim).fill(0).map((_, i) => base + jitter * Math.sin(i + base))
    return { id, embedding, text }
  }
  return [
    mk(1, 0.01, 'a1', 'a red dragon breathing fire'),
    mk(1, 0.01, 'a2', 'a red dragon in flight'),
    mk(1, 0.01, 'a3', 'a red dragon portrait'),
    mk(-1, 0.01, 'b1', 'a blue whale swimming'),
    mk(-1, 0.01, 'b2', 'a blue whale underwater'),
    mk(-1, 0.01, 'b3', 'a blue whale breaching'),
  ]
}

test('projectVestigia: empty input', () => {
  const result = projectVestigia([])
  assert.deepEqual(result, { points: [], clusters: [], n: 0 })
})

test('projectVestigia: deterministic on a fixed fixture (same input -> same output)', () => {
  const a = projectVestigia(fixture())
  const b = projectVestigia(fixture())
  assert.deepEqual(a, b)
})

test('projectVestigia: normalizes points into the ~[-2.5,2.5] cube', () => {
  const { points } = projectVestigia(fixture())
  assert.equal(points.length, 6)
  for (const pt of points) {
    for (const coord of pt.p) {
      assert.ok(Math.abs(coord) <= 2.500001, `coord ${coord} outside cube`)
    }
  }
})

test('projectVestigia: separates the two semantic groups into different clusters', () => {
  const { points } = projectVestigia(fixture())
  const byId = new Map(points.map(p => [p.id, p]))
  const dragonClusters = new Set(['a1', 'a2', 'a3'].map(id => byId.get(id)!.cluster))
  const whaleClusters = new Set(['b1', 'b2', 'b3'].map(id => byId.get(id)!.cluster))
  // Each group internally consistent (same cluster), and the two groups differ.
  assert.equal(dragonClusters.size, 1)
  assert.equal(whaleClusters.size, 1)
  assert.notEqual([...dragonClusters][0], [...whaleClusters][0])
})

test('projectVestigia: n=3 renders without crashing, no meaningful clustering', () => {
  const items = fixture().slice(0, 3)
  const result = projectVestigia(items)
  assert.equal(result.n, 3)
  assert.equal(result.points.length, 3)
  // Below the clustering threshold: every point lands in the single cluster id 0.
  assert.ok(result.points.every(p => p.cluster === 0))
  assert.equal(result.clusters.length, 1)
})

test('projectVestigia: clusters array is positionally aligned with point.cluster ids', () => {
  const { points, clusters } = projectVestigia(fixture())
  for (const pt of points) {
    assert.ok(pt.cluster >= 0 && pt.cluster < clusters.length, 'cluster id out of range of clusters array')
  }
})

test('projectVestigia: cluster labels are derived from prompt text, not generic', () => {
  const { clusters } = projectVestigia(fixture())
  const allLabels = clusters.map(c => c.label).join(' ')
  assert.ok(/dragon|red/.test(allLabels) || /whale|blue/.test(allLabels), `unexpected labels: ${allLabels}`)
})
