// =============================================================================
// Storage router — the crystal upload front door (JS-nuke blocker #10)
// =============================================================================
//
// Gives the React web app a way to get input media (i2i input images, profile
// avatar/banner) into R2 without the host proxying the bytes: it mints a short-
// lived presigned PUT URL the browser uploads straight to, and returns the
// permanent public URL the object will live at. Mirrors the legacy
// `POST /api/v1/storage/uploads/sign` contract (`{ signedUrl, permanentUrl }`).
//
// Keys are OWNER-SCOPED: derived from a hash of the caller's AuctorKey so one
// user can't guess/overwrite another's uploads (anon `x-commitment` callers get
// their own namespace too). Content-types are allowlisted to images — this front
// door is not a general file dump.

import express, { type Request, type Response, type Router } from 'express'
import { createHash, randomUUID } from 'node:crypto'
import type { AuctorKey } from '../../flow/types.js'
import type { ObjectStore } from '../../crystal/R2Uploader.js'
import { ApiError, Errors } from './errors.js'
import { makeLogger } from '../../lib/logger.js'
import { credentialsFromHeaders } from './IdentityResolver.js'
import type { Identity } from './apiRouter.js'

const log = makeLogger('storageRouter')

/** Allowlisted upload content-types → file extension. Images only. */
const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
}

/** Owner discriminant → short stable namespace (hashed so we never leak the raw
 *  commitment/bursaToken into an object key). Mirrors the ownerToken flatten. */
function ownerScope(owner: AuctorKey): string {
  const token = 'animaId' in owner ? `a:${owner.animaId}`
    : 'commitment' in owner ? `h:${owner.commitment}`
    : `b:${owner.bursaToken}`
  return createHash('sha256').update(token).digest('hex').slice(0, 16)
}

/**
 * createStorageRouter — one router, mounted at BOTH `/api/v1/storage` (the compat
 * path the deployed web app bakes) and `/v1/storage` (native, for new callers).
 */
export function createStorageRouter(deps: { store: ObjectStore; identity: Identity }): Router {
  const { store, identity } = deps
  const router = express.Router()
  router.use(express.json())

  if (!store.getSignedUploadUrl) {
    // Configured store can't presign — the route below fails closed rather than 404.
    log.warn('object store has no getSignedUploadUrl — /storage/uploads/sign will 503')
  }

  /** Resolve the caller (bursaToken header/body short-circuits to anon bursa). */
  const auth = (req: Request): Promise<AuctorKey> => {
    const bursaToken = req.body?.bursaToken ?? (req.headers['x-bursa-token'] as string | undefined)
    if (bursaToken) return Promise.resolve({ bursaToken })
    return identity.resolve(
      credentialsFromHeaders(req.headers as Record<string, string | undefined>, req.body),
    )
  }

  const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
    async (req: Request, res: Response): Promise<void> => {
      try {
        await fn(req, res)
      } catch (err) {
        if (err instanceof ApiError) {
          res.status(err.httpStatus).json({ error: err.toBody() })
        } else {
          log.error('unhandled storage error', { path: req.path, error: String((err as Error)?.stack ?? err) })
          res.status(500).json({ error: Errors.internal().toBody() })
        }
      }
    }

  // POST /storage/uploads/sign — presign a browser upload.
  // Body: { filename, contentType }  →  { signedUrl, permanentUrl, key }.
  router.post('/uploads/sign', wrap(async (req, res) => {
    if (!store.getSignedUploadUrl) {
      res.status(503).json({ error: { code: 'internal.error', message: 'upload storage unavailable' } })
      return
    }
    const { filename, contentType } = req.body ?? {}
    if (typeof filename !== 'string' || !filename || typeof contentType !== 'string' || !contentType) {
      throw Errors.inputMalformed('filename and contentType are required')
    }
    const ext = ALLOWED_CONTENT_TYPES[contentType]
    if (!ext) {
      throw Errors.inputMalformed(`unsupported contentType '${contentType}' (allowed: ${Object.keys(ALLOWED_CONTENT_TYPES).join(', ')})`)
    }
    const auctor = await auth(req)
    // Owner-scoped, unguessable key. We ignore the client filename for the path
    // (it's untrusted) but keep its extension via the validated content-type.
    const key = `uploads/${ownerScope(auctor)}/${randomUUID()}.${ext}`
    const { signedUrl, publicUrl } = await store.getSignedUploadUrl(key, contentType)
    res.json({ signedUrl, permanentUrl: publicUrl, key })
  }))

  return router
}
