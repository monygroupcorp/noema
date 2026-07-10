import { Router } from 'express'
import type {
  Vestigiorum,
  VestigiumSearchDimension,
  VestigiumVisibility,
  VestigiumGenus,
} from '../../types/vestigium.js'
import type { AuctorKey } from '../../flow/types.js'
import type { Credentials } from '../../allocutio/api/IdentityResolver.js'
import { credentialsFromHeaders } from '../../allocutio/api/IdentityResolver.js'
import { projectVestigia } from '../../crystal/VestigiaProjection.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('vestigia:router')

export interface VestigiaRouterDeps {
  vestigiorum: Vestigiorum
  identity: { resolve(creds: Credentials): Promise<AuctorKey> }
}

/** Vestigia are owned by an identified anima or an anon commitment — never a purse bearer token. */
type VestigiaAuctorKey = { animaId: string } | { commitment: string }

function auctorToken(auctor: VestigiaAuctorKey): string {
  return 'animaId' in auctor ? `animaId:${auctor.animaId}` : `commitment:${auctor.commitment}`
}

// Per-caller projection cache (docs/handoff/2026-07-10-space-real-data.md §1): the
// projection is a VIEW — nothing is stored on the Vestigium record. Recompute when
// the vestigia count changes (a new gen landed) or the cached artifact ages past
// CACHE_MAX_AGE_MS, whichever comes first.
const CACHE_MAX_AGE_MS = 10 * 60 * 1000
interface CacheEntry { result: ReturnType<typeof projectVestigia>; count: number; computedAt: number }
const projectionCache = new Map<string, CacheEntry>()

export function createVestigiaRouter(deps: VestigiaRouterDeps): Router {
  const { vestigiorum, identity } = deps
  const router = Router()

  /**
   * Resolve the caller's AuctorKey from bearer session / API key / x-commitment.
   * A purse-token (`bursaToken`) caller has no vestigia ownership concept — treated
   * as an auth failure here, same as an unresolvable credential.
   */
  async function resolveCaller(req: import('express').Request): Promise<VestigiaAuctorKey> {
    const creds = credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body)
    const auctor = await identity.resolve(creds)
    if ('bursaToken' in auctor) throw new Error('purse-token identity has no vestigia')
    return auctor
  }

  // ── GET /search ──────────────────────────────────────────────────────────────
  //
  // Semantic search across one embedding dimension.
  //
  // Query params:
  //   q           string   required  — text to embed and search against
  //   per         string   optional  — promptum | imago | intella  (default: promptum)
  //   limit       number   optional  — max results  (default: 20, max: 100)
  //   minSim      number   optional  — min cosine similarity  (default: 0.7)
  //   animaId     string   optional  — scope to one identity's vestigia
  //   modusId     string   optional  — filter by modus
  //   genus       string   optional  — image | video | text | audio
  //   visibilitas string   optional  — comma-separated: privata,communis,publica
  //
  // Without animaId: returns publica only.
  // With animaId: returns privata + communis + publica for that identity.
  //
  // 503 when CLIP service not configured (embed function absent).

  router.get('/search', async (req, res) => {
    const q = (req.query.q as string | undefined)?.trim()
    if (!q) {
      return res.status(400).json({ error: 'q is required' })
    }

    const per       = (req.query.per as VestigiumSearchDimension | undefined) ?? 'promptum'
    const rawLimit  = parseInt(req.query.limit as string ?? '20', 10)
    const limit     = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20
    const rawMinSim = parseFloat(req.query.minSim as string ?? '0.7')
    const minSimilaritas = Number.isFinite(rawMinSim) ? rawMinSim : 0.7
    const animaId   = (req.query.animaId as string | undefined)?.trim() || undefined
    const modusId   = (req.query.modusId as string | undefined)?.trim() || undefined
    const genus     = (req.query.genus as VestigiumGenus | undefined) || undefined

    const rawVis = (req.query.visibilitas as string | undefined)?.split(',').map(s => s.trim()).filter(Boolean)
    const visibilitas = rawVis?.length ? rawVis as VestigiumVisibility[] : undefined

    try {
      const results = await vestigiorum.search({
        quaerendum: q,
        per,
        limit,
        minSimilaritas,
        auctorKey: animaId ? { animaId } : undefined,
        modusId,
        genus,
        visibilitas,
      })

      return res.json({ results, count: results.length })
    } catch (err) {
      const msg = (err as Error).message ?? 'search failed'
      if (msg.includes('No embed function')) {
        return res.status(503).json({ error: 'embedding service not configured — CLIP_SERVICE_URL is not set' })
      }
      log.error('search error', { error: String(err) })
      return res.status(500).json({ error: 'internal search error' })
    }
  })

  // ── GET / ────────────────────────────────────────────────────────────────────
  //
  // List recent vestigia for the CALLER (resolved from bearer session / API key /
  // x-commitment — matches how the rest of /v1 resolves auctor; no animaId param).
  //
  // Query params:
  //   limit       number   optional  — max results (default: 50, max: 200)

  router.get('/', async (req, res) => {
    let auctor: VestigiaAuctorKey
    try {
      auctor = await resolveCaller(req)
    } catch {
      return res.status(401).json({ error: { code: 'auth.invalid', message: 'Authentication required' } })
    }

    const rawLimit = parseInt(req.query.limit as string ?? '50', 10)
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50

    try {
      const vestigia = await vestigiorum.forIdentity(auctor, limit)
      return res.json({ vestigia, count: vestigia.length })
    } catch (err) {
      log.error('forIdentity error', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  // ── GET /projection ──────────────────────────────────────────────────────────
  //
  // PCA-to-3D + k-means projection of the CALLER's own vestigia — feeds Space.tsx's
  // real-data mode (docs/handoff/2026-07-10-space-real-data.md). Auth: bearer
  // session or x-commitment, same resolution as GET /.
  //
  // Query params:
  //   embedding   string   optional  — imago | promptum  (default: promptum)
  //
  // Response: { points: [{id, p:[x,y,z], cluster}], clusters: [{label,color,count}], n }
  // normalized to the ~[-2.5,2.5] cube Space.tsx expects. Cached per caller;
  // recomputed when the caller's vestigia count changes or the cache ages out.

  router.get('/projection', async (req, res) => {
    let auctor: VestigiaAuctorKey
    try {
      auctor = await resolveCaller(req)
    } catch {
      return res.status(401).json({ error: { code: 'auth.invalid', message: 'Authentication required' } })
    }

    const embeddingParam = (req.query.embedding as string | undefined) === 'imago' ? 'imago' : 'promptum'
    const embeddingField = embeddingParam === 'imago' ? 'embeddingImago' as const : 'embeddingPromptum' as const

    try {
      const vestigia = await vestigiorum.forIdentity(auctor, 5000)
      const cacheKey = `${auctorToken(auctor)}:${embeddingParam}`
      const cached = projectionCache.get(cacheKey)
      const fresh = cached
        && cached.count === vestigia.length
        && (Date.now() - cached.computedAt) < CACHE_MAX_AGE_MS

      if (fresh && cached) {
        return res.json(cached.result)
      }

      const items = vestigia
        .filter(v => Array.isArray(v[embeddingField]) && (v[embeddingField] as number[]).length > 0)
        .map(v => ({ id: v.id, embedding: v[embeddingField] as number[], text: v.promptum }))

      const result = projectVestigia(items)
      projectionCache.set(cacheKey, { result, count: vestigia.length, computedAt: Date.now() })
      return res.json(result)
    } catch (err) {
      log.error('projection error', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  // ── GET /:id ─────────────────────────────────────────────────────────────────

  router.get('/:id', async (req, res) => {
    try {
      const v = await vestigiorum.findById(req.params.id)
      if (!v) return res.status(404).json({ error: 'not found' })
      return res.json({ vestigium: v })
    } catch (err) {
      log.error('findById error', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  return router
}
