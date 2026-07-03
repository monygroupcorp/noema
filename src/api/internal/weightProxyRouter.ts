// =============================================================================
// weightProxyRouter — GET /internal/weights/:intellaId  (BYO-secrets Phase C, "C1").
// =============================================================================
// The backend-mediated download proxy (spec model-import §"BYO secrets", option a).
// A run's pod fetches a PRIVATE, gated-origin weight THROUGH us so it never sees the
// owner's Civitai/HF token. The Compiler rewrote the model's download url to this
// endpoint (C2) and flagged it `gated`; the runner presents its per-job token (C0).
//
// Request:  GET /internal/weights/:intellaId
//           Authorization: Bearer <jobToken>
// Flow:
//   1. Authn — verify the job token (self-verifying HMAC). Bad/absent → 404.
//   2. Authz — load the Intella; require it be PRIVATE and owned by the token's
//      ownerKey. Any miss → 404 (never 403: a probe learns nothing about what exists).
//   3. Origin — the source must be a gated host (Civitai/HF); resolve the owner's BYO
//      token (the one place besides the import scrape that legitimately holds `resolve`).
//   4. Stream — fetch the origin with `Authorization: Bearer <byoToken>` and pipe the
//      bytes straight through. The token is set on the outbound request ONLY; it is
//      never written to a response, a log, or disk.
//
// Feature-gate: mounted only when a job-token secret + a `SecretResolver` are configured
// (index.ts). Absent → the route isn't mounted and the Compiler never rewrites to it.
// =============================================================================

import { Router } from 'express'
import { Readable } from 'node:stream'
import type { Intellarum } from '../../types/intelligendi.js'
import type { SecretResolver } from '../../types/secretum.js'
import type { JobTokenClaims } from '../../crystal/jobToken.js'
import { ownsBy } from '../../crystal/ownerKey.js'
import { importSecretProviderForUrl } from '../../crystal/modelImportResolver.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('internal:weight-proxy')

export interface WeightProxyDeps {
  /** Verify a job token → its claims, or null. Bound to the server secret in index.ts. */
  verifyToken: (token: string) => JobTokenClaims | null
  /** Read-only Intella lookup — the authz + origin source. */
  intellae: Pick<Intellarum, 'find'>
  /** The `resolve`-only secret slice (BYO origin token). One of two legitimate holders. */
  secrets: SecretResolver
  /** Injected for tests; defaults to global fetch. */
  fetchFn?: typeof fetch
}

/** Pull the bearer token out of an Authorization header. Null when absent/malformed. */
function bearer(header: string | undefined): string | null {
  if (!header) return null
  const m = /^Bearer\s+(.+)$/i.exec(header)
  return m ? m[1].trim() : null
}

export function createWeightProxyRouter(deps: WeightProxyDeps): Router {
  const router = Router()
  const fetchFn = deps.fetchFn ?? fetch

  // No express.json() — this is a byte stream, not a JSON endpoint.
  router.get('/weights/:intellaId', async (req, res) => {
    // A single opaque 404 for every "can't serve" branch — never reveal which check failed.
    const deny = (reason: string, ctx: Record<string, unknown> = {}): void => {
      log.warn('weight-proxy denied', { reason, intellaId: req.params.intellaId, ...ctx })
      res.status(404).json({ error: 'not found' })
    }

    // 1. Authn.
    const token = bearer(req.headers.authorization)
    const claims = token ? deps.verifyToken(token) : null
    if (!claims) return deny('bad-or-absent-token')

    // 2. Authz — private + owned by the token's ownerKey.
    const intella = await deps.intellae.find(req.params.intellaId).catch(() => null)
    if (!intella) return deny('intella-not-found')
    if (intella.access !== 'private') return deny('not-private')
    if (!ownsBy(intella, claims.ownerKey)) return deny('not-owner', { ownerKey: claims.ownerKey })

    // 3. Origin must be a gated host; resolve the owner's BYO token for it.
    const origin = intella.sources?.[0]?.uri
    const provider = origin ? importSecretProviderForUrl(origin) : null
    if (!origin || !provider) return deny('origin-not-gated')
    const byoToken = await deps.secrets.resolve(claims.ownerKey, provider).catch(() => null)
    if (!byoToken) return deny('no-secret', { provider })

    // 4. Stream origin → pod. The BYO token rides the OUTBOUND request only.
    let originRes: Response
    try {
      originRes = await fetchFn(origin, { headers: { Authorization: `Bearer ${byoToken}` } })
    } catch (err) {
      log.warn('weight-proxy origin fetch threw', { intellaId: intella.id, provider, error: String(err) })
      res.status(502).json({ error: 'origin fetch failed' })
      return
    }
    if (!originRes.ok || !originRes.body) {
      log.warn('weight-proxy origin non-ok', { intellaId: intella.id, provider, status: originRes.status })
      res.status(502).json({ error: 'origin fetch failed' })
      return
    }

    // Pass through content framing so the runner can size/verify the download.
    const ct = originRes.headers.get('content-type')
    const cl = originRes.headers.get('content-length')
    if (ct) res.setHeader('Content-Type', ct)
    if (cl) res.setHeader('Content-Length', cl)
    log.info('weight-proxy streaming', { intellaId: intella.id, provider, sizeBytes: cl ? Number(cl) : undefined })

    try {
      await new Promise<void>((resolve, reject) => {
        const src = Readable.fromWeb(originRes.body as import('node:stream/web').ReadableStream)
        src.on('error', reject)
        res.on('error', reject)
        res.on('close', resolve)
        src.pipe(res)
      })
    } catch (err) {
      // Bytes may already be flowing — can't change the status now, just cut the stream.
      log.warn('weight-proxy stream error', { intellaId: intella.id, error: String(err) })
      if (!res.headersSent) res.status(502).json({ error: 'stream failed' })
      else res.destroy()
    }
  })

  return router
}
