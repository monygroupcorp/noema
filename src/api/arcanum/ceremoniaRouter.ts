import { Router, raw, type Request, type Response } from 'express'
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'node:crypto'
import { parse as parseCookie, serialize as serializeCookie } from 'cookie'
import type { CeremoniaStore } from '../../arcanum/CeremoniaStore.js'
import { headHash } from '../../arcanum/CeremoniaStore.js'
import {
  type ZkeyCustody,
  type ContinuationVerifierOpts,
  sha256Hex,
  verifyContinuation,
} from '../../arcanum/CeremoniaCustody.js'
import { readSession } from '../../crystal/sessionToken.js'
import { ownerKeyOf } from '../../crystal/ownerKey.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('ceremonia:router')

// Public sequencer for the Arcanum trusted-setup ceremony — the KZG-summoning model.
// The contribution chain is live server state: contributors self-serve (download the
// head, contribute in-browser, upload), the page polls /v1/ceremony, and the chain
// grows with no redeploy. Mounted at /v1/ceremony (see index.ts).

const MAX_CONTACT = 256
const MAX_NAME = 80
const MAX_ZKEY_BYTES = 64 * 1024 * 1024 // arcanum zkey is ~5MB; cap generously.

// ── One ceremony contribution per session identity (noema-133) ──────────────────────
// Credibility gate, not security: stop refresh-spam from inflating the transcript, not
// block a determined attacker (extra HONEST contributions don't weaken the ceremony).
//
//   • Signed-in caller (fiat-auth `Authorization: Bearer <session jwt>`) → keyed on
//     `ownerKeyOf({ animaId })`, reusing the exact session-token verification authRouter
//     mints (`src/crystal/sessionToken.ts`) — no new identity-resolution plumbing.
//   • Anonymous caller → a `noema-cer-sid` cookie: minted (httpOnly, sameSite=Lax) on the
//     FIRST contribution attempt if absent, HMAC-signed so a tampered/forged value can't
//     be presented as someone else's already-used slot. The identity key is the SHA-256
//     of the cookie's uuid, not the raw cookie (never store/expose a bearer-ish secret
//     verbatim — mirrors `ownerKeyOf`'s bursaToken/commitment discriminants).
const CEREMONY_COOKIE = 'noema-cer-sid'

// Cookie HMAC secret: reuse JWT_SECRET (already the app's session-signing secret) when
// set; else a per-process random secret. The cookie is a low-stakes anti-spam token
// (not the fiat-auth session), so a restart invalidating it is acceptable.
const CEREMONY_COOKIE_SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex')

function signCookieValue(uuid: string): string {
  const sig = createHmac('sha256', CEREMONY_COOKIE_SECRET).update(uuid).digest('hex')
  return `${uuid}.${sig}`
}

/** Verify a signed `noema-cer-sid` value → its uuid, or null if absent/tampered. */
function verifyCookieValue(raw: string | undefined): string | null {
  if (!raw) return null
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return null
  const uuid = raw.slice(0, dot)
  const sig = raw.slice(dot + 1)
  const expected = createHmac('sha256', CEREMONY_COOKIE_SECRET).update(uuid).digest('hex')
  const sigBuf = Buffer.from(sig, 'hex')
  const expectedBuf = Buffer.from(expected, 'hex')
  if (sigBuf.length !== expectedBuf.length) return null
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null
  return uuid
}

/**
 * Resolve the contributor identity-key for this request, minting + setting a
 * ceremony-session cookie on the attempt if the caller has neither a session nor an
 * existing cookie. Signed-in callers key on `ownerKeyOf({ animaId })` (readable, like
 * ops-visible anima ids elsewhere); anon callers key on a SHA-256 of their cookie uuid.
 */
function resolveContributorIdentity(req: Request, res: Response): string {
  const auth = req.header('authorization')
  if (auth?.startsWith('Bearer ') && process.env.JWT_SECRET) {
    const animaId = readSession(auth.slice('Bearer '.length), process.env.JWT_SECRET)
    if (animaId) return ownerKeyOf({ animaId })
  }

  const cookies = parseCookie(req.headers.cookie || '')
  let uuid = verifyCookieValue(cookies[CEREMONY_COOKIE])
  if (!uuid) {
    uuid = randomUUID()
    res.setHeader('Set-Cookie', serializeCookie(CEREMONY_COOKIE, signCookieValue(uuid), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/v1/ceremony',
      maxAge: 60 * 60 * 24 * 30, // 30 days — long enough to outlast a contribution session
    }))
  }
  return `cerid:${sha256Hex(Buffer.from(uuid))}`
}

export interface CeremoniaRouterConfig {
  /** Binary custody for the zkey chain — required for current.zkey + contributions. */
  custody?: ZkeyCustody
  /** snarkjs continuation-verifier inputs (r1cs always; ptau when mounted). */
  verifier?: ContinuationVerifierOpts
}

export function createCeremoniaRouter(
  store: CeremoniaStore,
  config: CeremoniaRouterConfig = {},
): Router {
  const router = Router()

  // ── GET /v1/ceremony ──────────────────────────────────────────────────────────
  // Public, pollable status: phase, published root/final hashes, and the live chain.
  router.get('/', async (_req, res) => {
    try {
      const status = await store.status()
      return res.json({ ...status, headHash: headHash(status) })
    } catch (err) {
      log.error('ceremony status error', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  // ── POST /v1/ceremony/slots ─────────────────────────────────────────────────────
  // Register interest in a contributor slot. Body: { contact: string }.
  router.post('/slots', async (req, res) => {
    const contact = req.body?.contact
    if (typeof contact !== 'string' || !contact.trim()) {
      return res.status(400).json({ error: 'contact is required' })
    }
    if (contact.length > MAX_CONTACT) {
      return res.status(400).json({ error: 'contact too long' })
    }
    try {
      await store.requestSlot(contact.trim())
      return res.status(201).json({ ok: true })
    } catch (err) {
      log.error('ceremony slot request error', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  // ── GET /v1/ceremony/current.zkey ─────────────────────────────────────────────
  // Stream the current head — the zkey the next contributor builds on. The x-zkey-hash
  // header is the head's sha256 (== the value to pass back as x-based-on).
  router.get('/current.zkey', async (_req, res) => {
    if (!config.custody) return res.status(501).json({ error: 'ceremony custody not configured' })
    try {
      const status = await store.status()
      if (status.phase !== 'open') return res.status(409).json({ error: 'ceremony not open' })
      const head = headHash(status)
      if (!head) return res.status(409).json({ error: 'ceremony not open' })
      const bytes = await config.custody.get(head)
      if (!bytes) return res.status(503).json({ error: 'head zkey not in custody' })
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('x-zkey-hash', head)
      res.setHeader('Content-Disposition', `attachment; filename="arcanum_${head.slice(0, 8)}.zkey"`)
      return res.end(bytes)
    } catch (err) {
      log.error('current.zkey error', { error: String(err) })
      return res.status(500).json({ error: 'internal error' })
    }
  })

  // ── POST /v1/ceremony/contributions ───────────────────────────────────────────
  // Upload a contribution. Body: raw zkey bytes (application/octet-stream).
  // Headers: x-based-on (head hash you built on), x-contributor-name (your handle).
  //
  // The server verifies it's a valid Phase-2 continuation (snarkjs), then appends under
  // an optimistic lock so concurrent uploads can't fork the chain. Anyone may contribute;
  // the gate is cryptographic, not an account — the 1-of-N honesty guarantee does the rest.
  router.post('/contributions',
    raw({ type: 'application/octet-stream', limit: MAX_ZKEY_BYTES }),
    async (req, res) => {
      if (!config.custody || !config.verifier) {
        return res.status(501).json({ error: 'ceremony custody not configured' })
      }
      const basedOn = String(req.header('x-based-on') || '').toLowerCase()
      const nameRaw = String(req.header('x-contributor-name') || 'anonymous').slice(0, MAX_NAME)
      const name = nameRaw.trim() || 'anonymous'
      const bytes = req.body as Buffer
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        return res.status(400).json({ error: 'empty body — send the zkey as application/octet-stream' })
      }
      if (!/^[0-9a-f]{64}$/.test(basedOn)) {
        return res.status(400).json({ error: 'x-based-on header (head hash) is required' })
      }

      // Resolve (and, for a first-seen anon caller, mint) the contributor identity
      // BEFORE the expensive checks — the cookie is set on the attempt either way.
      const identityKey = resolveContributorIdentity(req, res)

      try {
        const status = await store.status()
        if (status.phase !== 'open') return res.status(409).json({ error: 'ceremony not open' })
        const head = headHash(status)
        if (head !== basedOn) {
          return res.status(409).json({ error: 'stale head — re-fetch current.zkey and contribute again', head })
        }

        // One-per-session gate: refuse a repeat BEFORE the expensive crypto verify.
        // Distinct from the stale-head 409 above — this is "you already contributed",
        // not "the chain moved".
        if (await store.hasContributed(identityKey)) {
          return res.status(409).json({ error: "you've already contributed to this ceremony" })
        }

        const outputHash = sha256Hex(bytes)
        if (outputHash === head) {
          return res.status(400).json({ error: 'no contribution detected (output identical to input)' })
        }

        // The head's own bytes are what the upload has to continue — `x-based-on` only
        // names them, and the client picks that header.
        const headBytes = await config.custody.get(head)
        if (!headBytes) return res.status(503).json({ error: 'head zkey not in custody' })

        const verdict = await verifyContinuation(bytes, headBytes, config.verifier)
        if (!verdict.ok) {
          // A verifier that could not run is our fault, not the contributor's: say so, and
          // leave their one-per-session slot unspent (nothing is recorded on this path).
          if (verdict.unavailable) {
            return res.status(503).json({ error: 'could not verify right now — please try again shortly' })
          }
          return res.status(400).json({ error: verdict.reason ?? 'invalid contribution' })
        }

        // Store bytes BEFORE the chain append so the head is always retrievable once named.
        await config.custody.put(outputHash, bytes)

        const appended = await store.appendContribution(
          { index: status.chain.length + 1, name, outputHash },
          head,
          identityKey,
        )
        if (!appended) {
          // Someone extended the head, or landed this identity's contribution, between
          // our read and write — re-check which so the caller gets the right message.
          if (await store.hasContributed(identityKey)) {
            return res.status(409).json({ error: "you've already contributed to this ceremony" })
          }
          return res.status(409).json({ error: 'another contribution landed first — re-fetch and retry' })
        }

        log.info('ceremony contribution accepted', {
          index: status.chain.length + 1, name, outputHash, deepVerified: verdict.deepVerified,
        })
        const next = await store.status()
        return res.status(201).json({ ...next, headHash: headHash(next), deepVerified: verdict.deepVerified })
      } catch (err) {
        log.error('contribution error', { error: String(err) })
        return res.status(500).json({ error: 'internal error' })
      }
    },
  )

  return router
}
