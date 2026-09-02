// =============================================================================
// modelAdminRouter — internal model-license clearance/backfill.
// =============================================================================
//
// `CrystalApi.setModelLicense` is gated on `_assertPlatformAdmin`, which passes only for
// an auctor whose animaId equals `PLATFORM_ANIMA_ID` — an identity that, per its own
// documented default (`docs/spec/intella-schema.md` "Phantom anima as deflationary sink"),
// is deliberately an anima NO ONE HOLDS KEYS FOR unless the operator has explicitly
// repointed it at a real account. So absent that repoint, no human session can ever reach
// this control through the web app — not a permissions bug on any one account, a structural
// gap. This gives the operator a path that doesn't depend on impersonating that identity.
//
//   POST /internal/v1/admin/models/:intellaId/license   { license?, commercialUse?, reclassify? }
//
// Gated by `x-internal-secret` (same discipline as the other /internal routers). Deliberately
// bypasses CrystalApi and works directly against Intellarum + the exported classifier, mirroring
// treasuryAdminRouter's own style — no CrystalApi/AuctorKey construction needed.
//
// Scope: license clearance ONLY. The same PLATFORM_ANIMA_ID gate also blocks the feed-review
// queue (approve/reject/confirm-csam) and the revenue/cogs reports — those are NOT covered
// here. Confirming/reporting CSAM carries its own legal weight (18 U.S.C. §2258A) and needs
// its own deliberate ruling on how a human reaches it, not a fast unblock bundled into this.

import express, { type Router, type Request, type Response } from 'express'
import type { Intellarum } from '../../types/intelligendi.js'
import { classifyModelLicense, type CommercialVerdict } from '../../crystal/modelLicense.js'

export interface ModelAdminDeps {
  intellarum: Pick<Intellarum, 'find' | 'setLicense'>
  /** `x-internal-secret` gate. Absent → every request is refused (401). */
  secret?: string
}

const VALID_VERDICTS: CommercialVerdict[] = ['yes', 'no', 'conditional', 'unknown']

export function createModelAdminRouter(deps: ModelAdminDeps): Router {
  const router = express.Router()

  // The gate is unconditional: an unconfigured secret refuses every request rather than
  // admitting it. Configuration is asserted at boot (see `src/index.ts`).
  router.use((req: Request, res: Response, next): void => {
    const provided = req.headers['x-internal-secret'] ?? req.query.token
    if (!deps.secret || provided !== deps.secret) {
      res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'invalid internal secret' } })
      return
    }
    next()
  })

  // POST /admin/models/:intellaId/license { license?, commercialUse?, reclassify? } — set an
  // explicit clearance, or re-derive from the model's recorded base string. Mirrors
  // CrystalApi.setModelLicense's two modes exactly (see that method's doc comment).
  router.post('/admin/models/:intellaId/license', async (req: Request, res: Response): Promise<void> => {
    if (!deps.intellarum.setLicense) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'model registry has no license write path' } })
      return
    }
    const intellaId = String(req.params.intellaId)
    const model = await deps.intellarum.find(intellaId)
    if (!model) { res.status(404).json({ error: { code: 'MODEL_NOT_FOUND', message: 'Model not found' } }); return }

    const { license: rawLicense, commercialUse: rawVerdict, reclassify } = req.body ?? {}
    let license: string | undefined
    let commercialUse: CommercialVerdict | undefined

    if (reclassify === true) {
      ({ license, commercialUse } = classifyModelLicense(model))
    } else {
      if (rawLicense !== undefined && typeof rawLicense !== 'string') {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'license must be a string' } })
        return
      }
      if (rawVerdict !== undefined && !VALID_VERDICTS.includes(rawVerdict)) {
        res.status(400).json({ error: { code: 'BAD_REQUEST', message: `commercialUse must be one of ${VALID_VERDICTS.join(', ')}` } })
        return
      }
      license = rawLicense
      commercialUse = rawVerdict
    }

    if (license === undefined && commercialUse === undefined) {
      res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'provide license and/or commercialUse, or reclassify:true' } })
      return
    }

    const updated = await deps.intellarum.setLicense(intellaId, {
      ...(license !== undefined ? { license } : {}),
      ...(commercialUse !== undefined ? { commercialUse } : {}),
    })
    if (!updated) { res.status(404).json({ error: { code: 'MODEL_NOT_FOUND', message: 'Model not found' } }); return }
    res.status(200).json({ intellaId, license: updated.license, commercialUse: updated.commercialUse })
  })

  return router
}
