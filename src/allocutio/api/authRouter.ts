// =============================================================================
// authRouter — the fiat username/password login rail (docs/spec/fiat-auth.md).
// =============================================================================
//
// Greenfield: fiat (Stripe / no-wallet) users need a persistent, recoverable account.
// This router registers/verifies/logs-in an email+password identity and MINTS a session
// bearer JWT that `apiAcceptors.verifyJwt` already knows how to accept (§trap). Nothing
// here touches GPUs or the ledger — it is credential + email + session issuance only.
//
//   POST /register            { email, password }        → 202 (email sent, no session)
//   GET|POST /verify-email    { token }                  → session (auto-login on verify)
//   POST /resend-verification { email }                  → 202 (always, no enumeration)
//   POST /login               { email, password }        → session (verified only)
//   POST /session/refresh     (Bearer session)           → fresh session
//   POST /forgot-password     { email }                  → 202 (always, no enumeration)
//   POST /reset-password      { token, newPassword }     → 200
//
// Mounted at `/v1/auth` (native) + `/api/v1/auth` (compat) in index.ts.
// =============================================================================

import express, { type Router, type Request, type Response } from 'express'
import type { PersonaStore } from '../../types/persona.js'
import type { AnimaStore } from '../../types/anima.js'
import {
  type CredentumStore,
  EmailTakenError,
  normalizeEmail,
  isValidEmail,
  passwordProblem,
} from '../../types/credentum.js'
import { resolveOrCreateAnima } from './apiAcceptors.js'
import { hashPassword, verifyPassword } from '../../crystal/passwordHash.js'
import {
  mintSession,
  readSession,
  makeLinkToken,
  hashLinkToken,
  DEFAULT_SESSION_TTL_SECONDS,
  type Session,
} from '../../crystal/sessionToken.js'
import type { Mailer } from './Mailer.js'
import { makeLogger } from '../../lib/logger.js'

const log = makeLogger('api:auth')

const HOUR_MS = 60 * 60 * 1000

export interface AuthRouterDeps {
  credenta: CredentumStore
  personae: Pick<PersonaStore, 'findByExternus' | 'findOrCreate'>
  animae: Pick<AnimaStore, 'create'>
  mailer: Mailer
  /** HS256 secret for session JWTs — the SAME `JWT_SECRET` `verifyJwt` validates against. */
  jwtSecret: string
  /** Base URL the emailed verify/reset links point at (a frontend page). Default: relative path. */
  appBaseUrl?: string
  now?: () => Date
  ttl?: {
    /** Session lifetime (s). Default 7d. */
    sessionSeconds?: number
    /** Verify-token lifetime (ms). Default 24h. */
    verifyMs?: number
    /** Reset-token lifetime (ms). Default 1h. */
    resetMs?: number
  }
  /** Optional per-route rate-limit middleware (index.ts wires express-rate-limit; tests omit). */
  rateLimiters?: {
    register?: express.RequestHandler
    login?: express.RequestHandler
    forgot?: express.RequestHandler
    resend?: express.RequestHandler
  }
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } })
}

function verifyLink(base: string, token: string): string {
  return `${base}/verify-email?token=${encodeURIComponent(token)}`
}
function resetLink(base: string, token: string): string {
  return `${base}/reset-password?token=${encodeURIComponent(token)}`
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const { credenta, personae, animae, mailer, jwtSecret } = deps
  const now = deps.now ?? (() => new Date())
  const appBaseUrl = deps.appBaseUrl ?? ''
  const sessionSeconds = deps.ttl?.sessionSeconds ?? DEFAULT_SESSION_TTL_SECONDS
  const verifyMs = deps.ttl?.verifyMs ?? 24 * HOUR_MS
  const resetMs = deps.ttl?.resetMs ?? 1 * HOUR_MS
  const rl = deps.rateLimiters ?? {}

  const router = express.Router()
  const noop: express.RequestHandler = (_req, _res, next) => next()

  const mint = (animaId: string): Session => mintSession(animaId, jwtSecret, sessionSeconds)

  /** Fire-and-forget: a send failure must never fail the request (the user can resend). */
  const sendMail = (to: string, subject: string, html: string): void => {
    void mailer.send({ to, subject, html }).catch(err =>
      log.warn('auth: email send failed', { to, subject, error: String(err) }))
  }

  // ── POST /register ────────────────────────────────────────────────────────────
  router.post('/register', rl.register ?? noop, async (req: Request, res: Response) => {
    const email = normalizeEmail(req.body?.email)
    const password = req.body?.password
    if (!isValidEmail(email)) return fail(res, 400, 'input.malformed', 'A valid email is required')
    const pwProblem = passwordProblem(password)
    if (pwProblem) return fail(res, 400, 'input.malformed', pwProblem)

    // Resolve (or mint) the soul behind this email's `'password'` persona FIRST — the
    // credential joins onto it. A dup email lands on the existing persona/anima, then
    // `create` throws below → generic 409 (no enumeration, no second anima minted).
    const animaId = await resolveOrCreateAnima(personae, animae, 'password', email)
    const passwordHash = await hashPassword(password)
    const verify = makeLinkToken()
    try {
      await credenta.create({
        email,
        passwordHash,
        animaId,
        verifyTokenHash: verify.hash,
        verifyTokenExp: new Date(now().getTime() + verifyMs),
      })
    } catch (err) {
      if (err instanceof EmailTakenError) {
        // Generic — do NOT reveal that the email exists.
        return fail(res, 409, 'conflict.registration', 'Could not complete registration')
      }
      throw err
    }
    sendMail(email, 'Verify your NOEMA email',
      `<p>Confirm your email to activate your account:</p><p><a href="${verifyLink(appBaseUrl, verify.plaintext)}">Verify email</a></p>`)
    // 202: account exists but is unverified; no session until verified.
    res.status(202).json({ status: 'verification_sent' })
  })

  // ── GET|POST /verify-email ──────────────────────────────────────────────────────
  const verifyEmail = async (req: Request, res: Response): Promise<void> => {
    const token = String(req.body?.token ?? req.query?.token ?? '')
    if (!token) return fail(res, 400, 'input.malformed', 'A verification token is required')
    const cred = await credenta.findByVerifyTokenHash(hashLinkToken(token))
    if (!cred || !cred.verifyTokenExp || cred.verifyTokenExp.getTime() <= now().getTime()) {
      return fail(res, 400, 'auth.token_invalid', 'This verification link is invalid or has expired')
    }
    await credenta.markVerified(cred.id)
    // Auto-login on verify: hand back a session for the anima the credential is joined to.
    res.status(200).json({ session: mint(cred.animaId), animaId: cred.animaId })
  }
  router.post('/verify-email', verifyEmail)
  router.get('/verify-email', verifyEmail)

  // ── POST /resend-verification ────────────────────────────────────────────────────
  router.post('/resend-verification', rl.resend ?? noop, async (req: Request, res: Response) => {
    const email = normalizeEmail(req.body?.email)
    const cred = isValidEmail(email) ? await credenta.findByEmail(email) : null
    if (cred && !cred.emailVerified) {
      const verify = makeLinkToken()
      await credenta.setVerifyToken(cred.id, verify.hash, new Date(now().getTime() + verifyMs))
      sendMail(email, 'Verify your NOEMA email',
        `<p>Confirm your email to activate your account:</p><p><a href="${verifyLink(appBaseUrl, verify.plaintext)}">Verify email</a></p>`)
    }
    // Always 202 — never reveal whether the email exists or is already verified.
    res.status(202).json({ status: 'verification_sent' })
  })

  // ── POST /login ──────────────────────────────────────────────────────────────────
  router.post('/login', rl.login ?? noop, async (req: Request, res: Response) => {
    const email = normalizeEmail(req.body?.email)
    const password = req.body?.password
    const cred = isValidEmail(email) && typeof password === 'string' ? await credenta.findByEmail(email) : null
    // Verify the hash even when the account is missing? We can't (no hash) — but the
    // generic message + rate-limiting keep enumeration cost high enough for v1.
    const ok = cred ? await verifyPassword(password, cred.passwordHash) : false
    if (!cred || !ok) return fail(res, 401, 'auth.invalid', 'Invalid email or password')
    // Policy (docs/spec/fiat-auth.md §policy): block login until the email is verified.
    if (!cred.emailVerified) {
      return fail(res, 403, 'auth.email_unverified', 'Verify your email before signing in')
    }
    res.status(200).json({ session: mint(cred.animaId), animaId: cred.animaId })
  })

  // ── POST /session/refresh ────────────────────────────────────────────────────────
  router.post('/session/refresh', async (req: Request, res: Response) => {
    const authz = req.headers.authorization
    const token = authz?.startsWith('Bearer ') ? authz.slice('Bearer '.length) : ''
    const animaId = token ? readSession(token, jwtSecret) : null
    if (!animaId) return fail(res, 401, 'auth.invalid', 'A valid session is required to refresh')
    res.status(200).json({ session: mint(animaId), animaId })
  })

  // ── POST /forgot-password ─────────────────────────────────────────────────────────
  router.post('/forgot-password', rl.forgot ?? noop, async (req: Request, res: Response) => {
    const email = normalizeEmail(req.body?.email)
    const cred = isValidEmail(email) ? await credenta.findByEmail(email) : null
    if (cred) {
      const reset = makeLinkToken()
      await credenta.setResetToken(cred.id, reset.hash, new Date(now().getTime() + resetMs))
      sendMail(email, 'Reset your NOEMA password',
        `<p>Reset your password (this link expires shortly):</p><p><a href="${resetLink(appBaseUrl, reset.plaintext)}">Reset password</a></p>`)
    }
    // Always 202 — never reveal whether the email exists.
    res.status(202).json({ status: 'reset_sent' })
  })

  // ── POST /reset-password ───────────────────────────────────────────────────────────
  router.post('/reset-password', async (req: Request, res: Response) => {
    const token = String(req.body?.token ?? '')
    const newPassword = req.body?.newPassword
    if (!token) return fail(res, 400, 'input.malformed', 'A reset token is required')
    const pwProblem = passwordProblem(newPassword)
    if (pwProblem) return fail(res, 400, 'input.malformed', pwProblem)
    const cred = await credenta.findByResetTokenHash(hashLinkToken(token))
    if (!cred || !cred.resetTokenExp || cred.resetTokenExp.getTime() <= now().getTime()) {
      return fail(res, 400, 'auth.token_invalid', 'This reset link is invalid or has expired')
    }
    await credenta.setPassword(cred.id, await hashPassword(newPassword))
    // NOTE: sessions are stateless short-lived JWTs — existing ones aren't revoked here.
    // A password reset also implies the address is controlled, so we verify it if it wasn't.
    if (!cred.emailVerified) await credenta.markVerified(cred.id)
    res.status(200).json({ status: 'password_reset' })
  })

  return router
}
