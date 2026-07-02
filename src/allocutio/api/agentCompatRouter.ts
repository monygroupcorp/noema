// =============================================================================
// agentCompatRouter — the baked CAMEL `/api/v1/...` compat surface (ADR-0011 §8).
// =============================================================================
//
// The deployed camel404 client bakes three Noema URLs (referenced from on-chain
// agentURI data), so crystal must answer them EXACTLY, mapped onto the crystal
// provisioning saga + Legatus registry:
//
//   POST /api/v1/treasury/:treasuryId/agents   — provision (Bearer ES256 JWT, body {})
//   GET  /api/v1/agents/:agentAccountId/manifest
//   POST /api/v1/sessions/:agentAccountId/revoke   (revokeToken-gated via ?token=)
//
// The provisioning route does NOT go through the generic `IdentityResolver.auth`
// (which yields only an animaId) — it needs the full verified claims, so it drives
// the `AgentJwtVerifier` directly, then resolves the agent's Anima via the same
// federated find-or-create the acceptor uses. A garbage assertion surfaces as
// 401 INVALID_ASSERTION (never a catch-all 403) — the go/no-go auth-shadow probe.

import express, { type Router, type Request, type Response } from 'express'
import type { AgentJwtVerifier } from './AgentJwtVerifier.js'
import type { AgentProvisioner, TreasuryConfig, ProvisionInput } from '../../crystal/AgentProvisioner.js'
import type { LegatusStore } from '../../types/legatus.js'
import { ApiError } from './errors.js'
import { IMPETUS_USD_RATE } from '../../ledger/rates.js'

/** impetus points → a USD string (2dp), matching the legacy `pointsToUsd`. */
function pointsToUsd(points: bigint): string {
  return (Number(points) * IMPETUS_USD_RATE).toFixed(2)
}

export interface AgentCompatDeps {
  verifier: AgentJwtVerifier
  provisioner: AgentProvisioner
  legati: Pick<LegatusStore, 'findById' | 'setStatus'>
  /** Resolve a verified `(iss, sub)` → the agent's Anima id (federated find-or-create). */
  resolveAgentAnima: (iss: string, sub: string) => Promise<string>
  /** Treasury config resolver — the route confirms the token's issuer matches the treasury. */
  treasury: (treasuryId: string) => TreasuryConfig | null
  /** Current agent balance (Σ valid signa) for the manifest. */
  balanceOf: (animaId: string) => Promise<bigint>
  /** Public origin for the manifest/revoke URIs. Default `https://noema.art`. */
  publicBase?: string
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } })
}

export function createAgentCompatRouter(deps: AgentCompatDeps): Router {
  const base = (deps.publicBase ?? 'https://noema.art').replace(/\/$/, '')
  const router = express.Router({ mergeParams: true })

  const manifestURI = (id: string): string => `${base}/api/v1/agents/${id}/manifest`
  const revokeURI = (id: string): string => `${base}/api/v1/sessions/${id}/revoke`

  // ── POST /treasury/:treasuryId/agents — provision ────────────────────────────
  router.post('/treasury/:treasuryId/agents', async (req: Request, res: Response): Promise<void> => {
    try {
      const treasuryId = String(req.params.treasuryId)

      // 1. Bearer token.
      const authHeader = req.get('authorization') ?? ''
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
      if (!token) return fail(res, 401, 'UNAUTHORIZED', 'Bearer token required')

      // 2. Treasury must exist + be active (parity: 404/403 before verify leaks).
      const treasury = deps.treasury(treasuryId)
      if (!treasury) return fail(res, 404, 'TREASURY_NOT_FOUND', 'Treasury not found')
      if (treasury.status !== 'active') return fail(res, 403, 'TREASURY_SUSPENDED', 'Treasury is suspended')

      // 3. Verify the ES256 assertion (JWKS). null = unregistered issuer → 401; a
      //    registered-but-invalid token throws ApiError (401/503) — never a 403.
      let verified: Awaited<ReturnType<AgentJwtVerifier['verify']>>
      try {
        verified = await deps.verifier.verify(token)
      } catch (err) {
        if (err instanceof ApiError) return fail(res, err.httpStatus, 'INVALID_ASSERTION', err.message)
        throw err
      }
      if (!verified) return fail(res, 401, 'INVALID_ASSERTION', 'Assertion issuer is not a registered agent issuer')

      // 4. The asserting issuer must be the one this treasury onboards against.
      if (verified.issuer.issuerId !== treasury.issuerId) {
        return fail(res, 401, 'INVALID_ASSERTION', 'Assertion issuer does not match the treasury')
      }

      // 5. Extract + validate claims.
      const p = verified.payload
      const agentId = typeof p.agentId === 'string' ? p.agentId : undefined
      const ownerAddress = String(p.owner_at_assertion ?? '').toLowerCase()
      const sub = typeof p.sub === 'string' ? p.sub : ''
      if (!agentId) return fail(res, 400, 'INVALID_ASSERTION', 'Missing agentId claim')
      if (!/^0x[0-9a-f]{40}$/.test(ownerAddress)) {
        return fail(res, 400, 'INVALID_ASSERTION', 'owner_at_assertion must be a valid Ethereum address')
      }
      // sub = `agent:<chainId>:<adapter>:<agentId>` — chain metadata is optional.
      const parts = sub.split(':')
      const chainId = parts.length >= 4 ? Number(parts[1]) || undefined : undefined
      const adapter = parts.length >= 4 && /^0x[0-9a-f]{40}$/i.test(parts[2]) ? parts[2].toLowerCase() : undefined
      const scope = Array.isArray(p.scope) ? p.scope.map(String) : []
      const sessionExpiresAt = typeof p.exp === 'number' ? new Date(p.exp * 1000) : undefined

      // 6. Resolve the agent's Anima (federated find-or-create — the same identity
      //    the JWKS acceptor mints, so re-auth lands on the same soul).
      const agentAnimaId = await deps.resolveAgentAnima(verified.issuer.issuerId, sub)

      // 7. Run the saga.
      const input: ProvisionInput = {
        agentAnimaId,
        agentId,
        ...(typeof p.tokenId === 'string' || typeof p.tokenId === 'number' ? { tokenId: String(p.tokenId) } : {}),
        ownerAddress,
        ...(chainId !== undefined ? { chainId } : {}),
        ...(adapter !== undefined ? { adapter } : {}),
        issuerId: verified.issuer.issuerId,
        scope,
        ...(sessionExpiresAt ? { sessionExpiresAt } : {}),
      }
      const outcome = await deps.provisioner.provision(treasuryId, input)
      if (!outcome.ok) return fail(res, outcome.httpStatus, outcome.code, outcome.message)

      res.status(outcome.httpStatus).json({
        agentAccountId: outcome.legatus.id,
        manifestURI: manifestURI(outcome.legatus.id),
        revokeURI: revokeURI(outcome.legatus.id),
        balance: { amount: pointsToUsd(outcome.grantedPoints), currency: 'USDC' },
      })
    } catch (err) {
      fail(res, 500, 'INTERNAL_SERVER_ERROR', `Unexpected error during agent provisioning: ${(err as Error).message}`)
    }
  })

  // ── GET /agents/:agentAccountId/manifest — public session manifest ────────────
  router.get('/agents/:agentAccountId/manifest', async (req: Request, res: Response): Promise<void> => {
    try {
      const id = String(req.params.agentAccountId)
      const legatus = await deps.legati.findById(id)
      if (!legatus) return fail(res, 404, 'NOT_FOUND', 'Agent account not found')

      if (legatus.status !== 'active') {
        res.status(200).json({ platform: 'noema.art', agentAccountId: id, status: legatus.status })
        return
      }

      const balance = await deps.balanceOf(legatus.animaId)
      res.status(200).json({
        platform: 'noema.art',
        status: 'active',
        scope: legatus.scope ?? [],
        ...(legatus.sessionExpiresAt ? { expiresAt: Math.floor(new Date(legatus.sessionExpiresAt).getTime() / 1000) } : {}),
        ...(legatus.workspaceModusId ? { workspaceModusId: legatus.workspaceModusId } : {}),
        billing: {
          model: 'treasury-funded',
          treasuryRef: legatus.treasuryId,
          agentBalance: pointsToUsd(balance),
          currency: 'USDC',
        },
      })
    } catch (err) {
      fail(res, 500, 'INTERNAL_ERROR', `Unexpected error fetching manifest: ${(err as Error).message}`)
    }
  })

  // ── POST /sessions/:agentAccountId/revoke — revokeToken-gated ─────────────────
  router.post('/sessions/:agentAccountId/revoke', async (req: Request, res: Response): Promise<void> => {
    try {
      const id = String(req.params.agentAccountId)
      const legatus = await deps.legati.findById(id)
      if (!legatus) return fail(res, 404, 'NOT_FOUND', 'Agent account not found')

      // revokeToken gate (query `?token=`). Every crystal-created Legatus has one.
      if (legatus.revokeToken) {
        const provided = req.query.token
        if (!provided || provided !== legatus.revokeToken) {
          return fail(res, 403, 'FORBIDDEN', 'Invalid or missing revoke token')
        }
      }

      if (legatus.status === 'revoked') {
        res.status(200).json({ agentAccountId: id, status: 'revoked' })   // idempotent
        return
      }

      await deps.legati.setStatus(id, 'revoked')
      res.status(200).json({ agentAccountId: id, status: 'revoked', revokedAt: new Date().toISOString() })
    } catch (err) {
      fail(res, 500, 'INTERNAL_ERROR', `Unexpected error revoking session: ${(err as Error).message}`)
    }
  })

  return router
}
