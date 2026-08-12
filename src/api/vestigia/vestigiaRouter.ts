import { Router } from 'express'
import type {
  Vestigiorum,
  VestigiumSearchDimension,
  VestigiumVisibility,
  VestigiumGenus,
  ImpressioKind,
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

// Per-caller projection cache: the
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
  //   animaId     string   optional  — scope to your OWN identity's vestigia (must match the
  //                                     authenticated caller; foreign/anonymous animaId → 403)
  //   modusId     string   optional  — filter by modus
  //   genus       string   optional  — image | video | text | audio
  //   visibilitas string   optional  — comma-separated: privata,communis,publica
  //
  // VISIBILITY SCOPING IS DERIVED FROM THE RESOLVED CALLER, NEVER FROM QUERY PARAMS.
  //   - No animaId (public gallery search): returns `publica` only. A `visibilitas` param
  //     cannot widen this — privata/communis are unreachable without an owning caller.
  //   - animaId == authenticated caller's own animaId: returns that caller's own vestigia
  //     (privata + communis + publica, or the requested subset).
  //   - animaId present but caller is anonymous or a different identity: 403. This is the
  //     CRIT-1 fix (2026-08-08) — previously animaId + visibilitas came straight from the
  //     query with no ownership check, so an anonymous caller could read every identity's
  //     private vestigia.
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
    const requestedAnimaId = (req.query.animaId as string | undefined)?.trim() || undefined
    const modusId   = (req.query.modusId as string | undefined)?.trim() || undefined
    const genus     = (req.query.genus as VestigiumGenus | undefined) || undefined

    const rawVis = (req.query.visibilitas as string | undefined)?.split(',').map(s => s.trim()).filter(Boolean)
    const requestedVis = rawVis?.length ? rawVis as VestigiumVisibility[] : undefined

    // Resolve the caller if credentials are present; anonymous is allowed (public search).
    let caller: VestigiaAuctorKey | undefined
    try {
      caller = await resolveCaller(req)
    } catch {
      caller = undefined
    }

    // Derive owner scope + allowed visibility from the CALLER, never the raw query.
    let auctorKey: VestigiaAuctorKey | undefined
    let visibilitas: VestigiumVisibility[] | undefined
    if (requestedAnimaId) {
      // Personal-space search: only ever your own animaId.
      if (!caller || !('animaId' in caller) || caller.animaId !== requestedAnimaId) {
        return res.status(403).json({
          error: { code: 'auth.forbidden', message: 'animaId scope requires an authenticated matching caller' },
        })
      }
      auctorKey = { animaId: requestedAnimaId }
      const allowed: VestigiumVisibility[] = ['privata', 'communis', 'publica']
      visibilitas = requestedVis?.length
        ? requestedVis.filter(v => allowed.includes(v))
        : allowed
    } else {
      // Public gallery search: publica only. A visibilitas param cannot widen scope.
      auctorKey = undefined
      visibilitas = ['publica']
    }

    try {
      const results = await vestigiorum.search({
        quaerendum: q,
        per,
        limit,
        minSimilaritas,
        auctorKey,
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
  // real-data mode. Auth: bearer
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
  //
  // Read a single vestigium by id. `communis`/`publica` are open-by-id by design
  // (link-shareable / public gallery — see VestigiumVisibility doc comments). A
  // `privata` vestigium is owner-only: a foreign or unauthenticated caller gets the
  // same 404 as an absent id (no existence leak), matching the owner-scoped
  // 404-on-foreign-or-absent contract DELETE /:id and POST /:id/impressio establish
  // below (noema-046, product ruling 2026-07-13).

  router.get('/:id', async (req, res) => {
    try {
      const v = await vestigiorum.findById(req.params.id)
      if (!v) return res.status(404).json({ error: 'not found' })
      if (v.visibilitas === 'privata') {
        let auctor: VestigiaAuctorKey
        try {
          auctor = await resolveCaller(req)
        } catch {
          return res.status(404).json({ error: 'not found' })
        }
        if (auctorToken(v.auctorKey as VestigiaAuctorKey) !== auctorToken(auctor)) {
          return res.status(404).json({ error: 'not found' })
        }
      }
      return res.json({ vestigium: v })
    } catch (err) {
      log.error('findById error', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  // ── DELETE /:id ──────────────────────────────────────────────────────────────
  //
  // Remove-from-space (product ruling 2026-07-13): the space is a full history
  // until the OWNER removes an entry. Owner-scoped — a stranger or an absent id
  // both 404 (no existence leak). Hard-deletes the vestigium record only; the
  // underlying Actum/spend history is untouched.

  router.delete('/:id', async (req, res) => {
    let auctor: VestigiaAuctorKey
    try {
      auctor = await resolveCaller(req)
    } catch {
      return res.status(401).json({ error: { code: 'auth.invalid', message: 'Authentication required' } })
    }

    try {
      const v = await vestigiorum.findById(req.params.id)
      if (!v || auctorToken(v.auctorKey as VestigiaAuctorKey) !== auctorToken(auctor)) {
        return res.status(404).json({ error: 'not found' })
      }
      await vestigiorum.delete(v.id)
      return res.json({ ok: true })
    } catch (err) {
      log.error('delete error', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  // ── POST /:id/impressio ──────────────────────────────────────────────────────
  //
  // Set (or clear, with `impressio: null`) the CALLER's own reaction on their own
  // vestigium — wires the existing Impressio.auctorImpressio shape used for
  // personal filtering. Owner-scoped, same 404-on-foreign-or-absent contract as
  // DELETE above.
  //
  // Body: { impressio: 'amor' | 'risus' | 'maeror' | null }

  router.post('/:id/impressio', async (req, res) => {
    let auctor: VestigiaAuctorKey
    try {
      auctor = await resolveCaller(req)
    } catch {
      return res.status(401).json({ error: { code: 'auth.invalid', message: 'Authentication required' } })
    }

    const raw = (req.body as { impressio?: unknown } | undefined)?.impressio
    const impressio: ImpressioKind | null = raw === null ? null : (raw as ImpressioKind)
    if (impressio !== null && !['amor', 'risus', 'maeror'].includes(impressio)) {
      return res.status(400).json({ error: 'impressio must be amor | risus | maeror | null' })
    }

    try {
      const v = await vestigiorum.findById(req.params.id)
      if (!v || auctorToken(v.auctorKey as VestigiaAuctorKey) !== auctorToken(auctor)) {
        return res.status(404).json({ error: 'not found' })
      }
      const updated = await vestigiorum.setAuctorImpressio(v.id, auctor, impressio)
      return res.json({ vestigium: updated })
    } catch (err) {
      log.error('setAuctorImpressio error', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  return router
}
