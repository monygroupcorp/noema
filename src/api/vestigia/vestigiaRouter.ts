import { Router } from 'express'
import type {
  Vestigiorum,
  VestigiumSearchDimension,
  VestigiumVisibility,
  VestigiumGenus,
} from '../../types/vestigium.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('vestigia:router')

export function createVestigiaRouter(vestigiorum: Vestigiorum): Router {
  const router = Router()

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
  // List recent vestigia for an identity. No embedding needed.
  //
  // Query params:
  //   animaId     string   required  — whose history to return
  //   limit       number   optional  — max results (default: 50, max: 200)

  router.get('/', async (req, res) => {
    const animaId = (req.query.animaId as string | undefined)?.trim()
    if (!animaId) {
      return res.status(400).json({ error: 'animaId is required' })
    }

    const rawLimit = parseInt(req.query.limit as string ?? '50', 10)
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50

    try {
      const vestigia = await vestigiorum.forIdentity({ animaId }, limit)
      return res.json({ vestigia, count: vestigia.length })
    } catch (err) {
      log.error('forIdentity error', { error: String(err) })
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
