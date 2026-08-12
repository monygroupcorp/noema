// =============================================================================
// VestigiaProjection — PCA-to-3D + k-means over a caller's vestigia embeddings.
// =============================================================================
//
// Serves Space.tsx's real-data mode.
// No Python, no UMAP, no new heavy deps — plain TS linear algebra, cheap enough
// for a few thousand 512-dim vectors computed on demand. Ports the shape of
// scripts/corpus-space/project.py (normalize to a ~[-2.5,2.5] cube, c-TF-IDF-ish
// cluster labels from prompt text) without calling it.
//
// Deterministic by construction: k-means centroids are seeded from the input's
// own order (no RNG), so the same fixture always yields the same clustering —
// required for the hermetic projection test.

export interface ProjectionItem {
  id: string
  embedding: number[]
  /** Text used for cluster labeling (typically the prompt). */
  text: string
}

export interface ProjectionPoint {
  id: string
  p: [number, number, number]
  cluster: number
}

export interface ProjectionClusterInfo {
  label: string
  color: string
  count: number
}

export interface ProjectionResult {
  points: ProjectionPoint[]
  clusters: ProjectionClusterInfo[]
  n: number
}

const CUBE_HALF = 2.5
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'over', 'under',
  'a', 'an', 'of', 'in', 'on', 'to', 'is', 'are', 'it', 'its', 'as', 'by', 'at',
  'be', 'or', 'but', 'not', 'was', 'were', 'has', 'have', 'had', 'his', 'her',
  'their', 'they', 'them', 'you', 'your', 'i', 'we', 'our', 'my',
])

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? []).filter(t => !STOPWORDS.has(t))
}

/** Mean-center an n x d matrix (rows = items). Mutates nothing; returns a new matrix + the mean. */
function center(X: number[][]): { centered: number[][]; mean: number[] } {
  const n = X.length
  const d = X[0]?.length ?? 0
  const mean = new Array(d).fill(0)
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j]
  for (let j = 0; j < d; j++) mean[j] /= n || 1
  const centered = X.map(row => row.map((v, j) => v - mean[j]))
  return { centered, mean }
}

/**
 * PCA to `k` components via power iteration + deflation on the (d x d) covariance
 * matrix. Cheap for the embedding sizes here (CLIP-family, a few hundred to ~1.5k
 * dims) and avoids any external linear-algebra dependency.
 */
function pca(centered: number[][], k: number): number[][] {
  const n = centered.length
  const d = centered[0]?.length ?? 0
  if (n === 0 || d === 0) return centered.map(() => new Array(k).fill(0))

  // Covariance matrix C = X^T X (d x d) — symmetric PSD.
  const cov: number[][] = Array.from({ length: d }, () => new Array(d).fill(0))
  for (const row of centered) {
    for (let a = 0; a < d; a++) {
      const ra = row[a]
      if (ra === 0) continue
      for (let b = a; b < d; b++) {
        cov[a][b] += ra * row[b]
      }
    }
  }
  for (let a = 0; a < d; a++) for (let b = 0; b < a; b++) cov[a][b] = cov[b][a]

  const components: number[][] = []
  const work = cov.map(r => r.slice())
  for (let c = 0; c < Math.min(k, d); c++) {
    // Deterministic seed vector (no RNG): a fixed pattern, orthogonalized below.
    let v = new Array(d).fill(0).map((_, i) => Math.sin(i + c + 1))
    for (let iter = 0; iter < 60; iter++) {
      const next = new Array(d).fill(0)
      for (let a = 0; a < d; a++) {
        let s = 0
        const rowA = work[a]
        for (let b = 0; b < d; b++) s += rowA[b] * v[b]
        next[a] = s
      }
      // orthogonalize against previous components (deflation safety net)
      for (const prev of components) {
        let dot = 0
        for (let a = 0; a < d; a++) dot += next[a] * prev[a]
        for (let a = 0; a < d; a++) next[a] -= dot * prev[a]
      }
      const norm = Math.sqrt(next.reduce((s, x) => s + x * x, 0))
      if (norm < 1e-12) { v = next; break }
      v = next.map(x => x / norm)
    }
    components.push(v)
    // Deflate: work -= lambda * v v^T, lambda = v^T C v
    let lambda = 0
    for (let a = 0; a < d; a++) {
      let s = 0
      for (let b = 0; b < d; b++) s += cov[a][b] * v[b]
      lambda += v[a] * s
    }
    for (let a = 0; a < d; a++) for (let b = 0; b < d; b++) work[a][b] -= lambda * v[a] * v[b]
  }
  while (components.length < k) components.push(new Array(d).fill(0))

  return centered.map(row => components.map(comp => {
    let s = 0
    for (let j = 0; j < d; j++) s += row[j] * comp[j]
    return s
  }))
}

/** Normalize coordinates to a centered cube ~[-2.5, 2.5] (matches Space.tsx's scene scale). */
function normalizeToCube(coords: number[][]): number[][] {
  const n = coords.length
  if (n === 0) return coords
  const dims = coords[0].length
  const mean = new Array(dims).fill(0)
  for (const row of coords) for (let j = 0; j < dims; j++) mean[j] += row[j]
  for (let j = 0; j < dims; j++) mean[j] /= n

  const centered = coords.map(row => row.map((v, j) => v - mean[j]))
  const absVals = centered.flat().map(Math.abs).sort((a, b) => a - b)
  const p99Idx = Math.min(absVals.length - 1, Math.floor(0.99 * (absVals.length - 1)))
  const p99 = absVals.length ? absVals[p99Idx] : 0
  const scale = CUBE_HALF / (p99 + 1e-9)
  return centered.map(row => row.map(v => v * scale))
}

/** Deterministic Lloyd's k-means: centroids seeded from evenly-spaced input rows (no RNG). */
function kmeans(points: number[][], k: number): number[] {
  const n = points.length
  if (n === 0) return []
  const dims = points[0].length
  const kk = Math.max(1, Math.min(k, n))

  let centroids: number[][] = []
  for (let i = 0; i < kk; i++) centroids.push(points[Math.floor((i * n) / kk)].slice())

  let assignments = new Array(n).fill(0)
  for (let iter = 0; iter < 25; iter++) {
    const next = new Array(n)
    for (let i = 0; i < n; i++) {
      let best = 0, bestDist = Infinity
      for (let c = 0; c < kk; c++) {
        let d2 = 0
        for (let j = 0; j < dims; j++) { const diff = points[i][j] - centroids[c][j]; d2 += diff * diff }
        if (d2 < bestDist) { bestDist = d2; best = c }
      }
      next[i] = best
    }
    const changed = next.some((v: number, i: number) => v !== assignments[i])
    assignments = next
    if (!changed && iter > 0) break

    const sums = Array.from({ length: kk }, () => new Array(dims).fill(0))
    const counts = new Array(kk).fill(0)
    for (let i = 0; i < n; i++) {
      counts[assignments[i]]++
      for (let j = 0; j < dims; j++) sums[assignments[i]][j] += points[i][j]
    }
    centroids = centroids.map((old, c) => counts[c] === 0 ? old : sums[c].map(s => s / counts[c]))
  }
  return assignments
}

const GOLDEN = 0.6180339887498949
function clusterColor(i: number): string {
  const h = (i * GOLDEN) % 1
  const s = 0.55, v = 0.95
  const hi = Math.floor(h * 6)
  const f = h * 6 - hi
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
  let r = 0, g = 0, b = 0
  switch (hi % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    case 5: r = v; g = p; b = q; break
  }
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`
}

/** c-TF-IDF-lite: top terms per cluster mega-doc, weighted against the other clusters. */
function clusterLabels(texts: string[], assignments: number[], k: number): string[] {
  const docs: Map<string, number>[] = Array.from({ length: k }, () => new Map())
  for (let i = 0; i < texts.length; i++) {
    const c = assignments[i]
    if (c >= k) continue
    for (const term of tokenize(texts[i])) {
      docs[c].set(term, (docs[c].get(term) ?? 0) + 1)
    }
  }
  const docFreq = new Map<string, number>()
  for (const doc of docs) for (const term of doc.keys()) docFreq.set(term, (docFreq.get(term) ?? 0) + 1)

  return docs.map(doc => {
    const total = Array.from(doc.values()).reduce((s, v) => s + v, 0) || 1
    const scored = Array.from(doc.entries()).map(([term, tf]) => {
      const idf = Math.log(1 + k / (1 + (docFreq.get(term) ?? 0)))
      return { term, score: (tf / total) * idf }
    })
    scored.sort((a, b) => b.score - a.score)
    const top = scored.slice(0, 2).map(s => s.term)
    return top.length ? top.join(' · ') : 'untitled'
  })
}

/**
 * Project a caller's embedding set to a labeled 3D point cloud.
 * Deterministic given the same `items` order and content — no randomness.
 */
export function projectVestigia(items: ProjectionItem[]): ProjectionResult {
  const n = items.length
  if (n === 0) return { points: [], clusters: [], n: 0 }

  const { centered } = center(items.map(it => it.embedding))
  const coords3 = normalizeToCube(pca(centered, 3))

  // k scaled to n (few tiny clusters for a handful of points, up to 24 for large corpora).
  const k = Math.max(1, Math.min(24, Math.round(Math.sqrt(n / 2))))
  const assignments = n < 4 ? new Array(n).fill(0) : kmeans(coords3, k)
  const effectiveK = n < 4 ? 1 : k

  const labels = clusterLabels(items.map(it => it.text), assignments, effectiveK)
  const counts = new Array(effectiveK).fill(0)
  for (const c of assignments) counts[c]++

  // Positional contract: `clusters[i]` describes cluster id `i` — points reference
  // their cluster by that same index, so every id in [0, effectiveK) gets an entry
  // (even a count-0 one) to keep the array/id correspondence exact.
  const clusters: ProjectionClusterInfo[] = []
  for (let c = 0; c < effectiveK; c++) {
    clusters.push({ label: labels[c], color: clusterColor(c), count: counts[c] })
  }

  const points: ProjectionPoint[] = items.map((it, i) => ({
    id: it.id,
    p: [coords3[i][0], coords3[i][1], coords3[i][2]],
    cluster: assignments[i],
  }))

  return { points, clusters, n }
}
