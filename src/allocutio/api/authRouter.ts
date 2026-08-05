// =============================================================================
// authRouter — the fiat username/password login rail (docs/spec/fiat-auth.md).
// =============================================================================
//
// Fiat (Stripe / no-wallet) users need a persistent, recoverable account. This router
// registers + logs-in a username+password identity and MINTS a session bearer JWT that
// `apiAcceptors.verifyJwt` already knows how to accept (§trap). Nothing here touches GPUs
// or the ledger — it is credential + session issuance only.
//
// NO EMAIL. Registration is anonymous username+password and logs you in immediately (no
// verification step). Account RECOVERY (forgot password) is not email-based — a user binds
// backup channels (Telegram / wallet) to their soul from the profile, and proving one of
// those channels reaches the `animaId` and mints a session. Those recovery endpoints ship
// in a later phase; this router is the username core.
//
//   POST /register            { username, password }     → 201 { session, animaId }
//   POST /login               { username, password }     → 200 { session, animaId }
//   POST /session/refresh     (Bearer session)           → fresh session
//
// Backup recovery channels — bound to the soul (docs/spec/fiat-auth.md §recovery):
//   POST /wallet/challenge    { address }                → { token, statement }  (sign it)
//   POST /wallet/link         (Bearer) { challengeToken, signature } → { address }
//   POST /wallet/register     { challengeToken, signature } → { session, animaId }  (wallet-first signup)
//   POST /wallet/recover      { challengeToken, signature } → { session, animaId }
//   GET  /wallet              (Bearer)                   → { wallets: address[] }
//   POST /telegram/challenge  (Bearer)                   → { code, deepLink? }  (open in Telegram)
//   GET  /telegram            (Bearer)                   → { linked: boolean }
//   POST /telegram/recover    { code }                   → { session, animaId }
//
// Mounted at `/v1/auth` (native) + `/api/v1/auth` (compat) in index.ts.
// =============================================================================

import express, { type Router, type Request, type Response } from 'express'
import type { Persona, PersonaStore } from '../../types/persona.js'
import type { AnimaStore } from '../../types/anima.js'
import {
  type CredentumStore,
  UsernameTakenError,
  normalizeUsername,
  usernameProblem,
  passwordProblem,
} from '../../types/credentum.js'
import { resolveOrCreateAnima } from './apiAcceptors.js'
import { hashPassword, verifyPassword } from '../../crystal/passwordHash.js'
import {
  mintSession,
  readSession,
  DEFAULT_SESSION_TTL_SECONDS,
  type Session,
} from '../../crystal/sessionToken.js'
import { normalizeAddress, mintWalletChallenge, verifyWalletChallenge } from '../../crystal/walletAuth.js'
import type { LinkTokenStore } from '../../types/linkToken.js'
import { makeLogger } from '../../lib/logger.js'

/** Link-code lifetime (seconds) for the Telegram deep-link handshake. */
const TELEGRAM_LINK_TTL_SECONDS = 10 * 60

const log = makeLogger('api:auth')

export interface AuthRouterDeps {
  credenta: CredentumStore
  personae: Pick<PersonaStore, 'findByExternus' | 'findOrCreate' | 'findByAnimaId' | 'linkAnima' | 'switchAnima'>
  animae: Pick<AnimaStore, 'create'>
  /** HS256 secret for session JWTs — the SAME `JWT_SECRET` `verifyJwt` validates against. */
  jwtSecret: string
  /** One-time codes bridging web ⇆ Telegram bot. Absent → the /telegram/* routes report 501. */
  linkTokens?: LinkTokenStore
  /** Bot @username — composes the `https://t.me/<bot>?start=link_<code>` deep link. */
  botUsername?: string
  now?: () => Date
  ttl?: {
    /** Session lifetime (s). Default 7d. */
    sessionSeconds?: number
  }
  /** Optional per-route rate-limit middleware (index.ts wires express-rate-limit; tests omit). */
  rateLimiters?: {
    register?: express.RequestHandler
    login?: express.RequestHandler
    /** Guards the cheap, unauthenticated wallet challenge + recover endpoints. */
    wallet?: express.RequestHandler
  }
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } })
}

/** A MongoDB unique-index collision (E11000). The wallet-signup create path treats it as the
 *  race guard: a concurrent double-signup that loses the insert re-reads the winner's binding
 *  rather than 500ing (mirrors the Stripe idempotency discipline — the unique index is the
 *  real single-writer guard, a read-then-write alone is a race). */
function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 11000
}

export function createAuthRouter(deps: AuthRouterDeps): Router {
  const { credenta, personae, animae, jwtSecret, linkTokens, botUsername } = deps
  const sessionSeconds = deps.ttl?.sessionSeconds ?? DEFAULT_SESSION_TTL_SECONDS
  const rl = deps.rateLimiters ?? {}

  const router = express.Router()
  const noop: express.RequestHandler = (_req, _res, next) => next()

  const mint = (animaId: string): Session => mintSession(animaId, jwtSecret, sessionSeconds)

  // ── POST /register ────────────────────────────────────────────────────────────
  router.post('/register', rl.register ?? noop, async (req: Request, res: Response) => {
    const username = normalizeUsername(req.body?.username)
    const password = req.body?.password
    const unProblem = usernameProblem(username)
    if (unProblem) return fail(res, 400, 'input.malformed', unProblem)
    const pwProblem = passwordProblem(password)
    if (pwProblem) return fail(res, 400, 'input.malformed', pwProblem)

    // Resolve (or mint) the soul behind this username's `'password'` persona FIRST — the
    // credential joins onto it. A dup username lands on the existing persona/anima, then
    // `create` throws below → generic 409 (no enumeration, no second anima minted).
    const animaId = await resolveOrCreateAnima(personae, animae, 'password', username)
    const passwordHash = await hashPassword(password)
    try {
      await credenta.create({ username, passwordHash, animaId })
    } catch (err) {
      if (err instanceof UsernameTakenError) {
        // Generic — do NOT reveal that the username exists.
        return fail(res, 409, 'conflict.registration', 'Could not complete registration')
      }
      throw err
    }
    log.info('auth: account created', { animaId })
    // Anonymous username accounts are usable immediately — no verification gate.
    res.status(201).json({ session: mint(animaId), animaId })
  })

  // ── POST /login ──────────────────────────────────────────────────────────────────
  router.post('/login', rl.login ?? noop, async (req: Request, res: Response) => {
    const username = normalizeUsername(req.body?.username)
    const password = req.body?.password
    const cred = username && typeof password === 'string' ? await credenta.findByUsername(username) : null
    // Verify the hash even when the account is missing? We can't (no hash) — but the
    // generic message + rate-limiting keep enumeration cost high enough for v1.
    const ok = cred ? await verifyPassword(password, cred.passwordHash) : false
    if (!cred || !ok) return fail(res, 401, 'auth.invalid', 'Invalid username or password')
    res.status(200).json({ session: mint(cred.animaId), animaId: cred.animaId })
  })

  // The animaId behind a Bearer session, or null. Shared by refresh + the authed wallet routes.
  const sessionAnima = (req: Request): string | null => {
    const authz = req.headers.authorization
    const token = authz?.startsWith('Bearer ') ? authz.slice('Bearer '.length) : ''
    return token ? readSession(token, jwtSecret) : null
  }

  // ── POST /session/refresh ────────────────────────────────────────────────────────
  router.post('/session/refresh', async (req: Request, res: Response) => {
    const animaId = sessionAnima(req)
    if (!animaId) return fail(res, 401, 'auth.invalid', 'A valid session is required to refresh')
    res.status(200).json({ session: mint(animaId), animaId })
  })

  // ── POST /wallet/challenge ─────────────────────────────────────────────────────────
  // Public: hand back a short-lived challenge for `address` to sign. Proves nothing yet.
  router.post('/wallet/challenge', rl.wallet ?? noop, (req: Request, res: Response) => {
    const address = normalizeAddress(req.body?.address)
    if (!address) return fail(res, 400, 'input.malformed', 'A valid wallet address is required')
    res.status(200).json(mintWalletChallenge(address, jwtSecret))
  })

  // ── POST /wallet/link ───────────────────────────────────────────────────────────────
  // Authed: bind the proven wallet to the CALLER's soul as a `'web'` persona (recovery channel).
  router.post('/wallet/link', async (req: Request, res: Response) => {
    const animaId = sessionAnima(req)
    if (!animaId) return fail(res, 401, 'auth.invalid', 'Sign in to link a wallet')
    const address = verifyWalletChallenge(req.body?.challengeToken, req.body?.signature, jwtSecret)
    if (!address) return fail(res, 400, 'auth.token_invalid', 'Wallet verification failed or expired')
    const existing = await personae.findByExternus('web', address)
    let moved = false
    if (!existing) {
      await personae.findOrCreate('web', address, { animaId })
    } else if (existing.activeAnimaId !== animaId) {
      // MOVE the binding to the caller (it was tied to another soul). Consistent with the
      // Telegram link's last-wins policy — no permanent dead-end — but here "existing web
      // persona pointing elsewhere" unambiguously means a real move, so we signal it. The
      // losing account's GET /wallet then correctly reports it no longer linked.
      await personae.linkAnima(existing.id, animaId)
      await personae.switchAnima(existing.id, animaId)
      moved = true
    }
    log.info('auth: wallet linked', { animaId, moved })
    res.status(200).json({ address, moved })
  })

  // ── POST /wallet/register ────────────────────────────────────────────────────────────
  // Public: wallet-FIRST signup — mint an account from a proven wallet, no username/password.
  // Prove the wallet, then:
  //   • bound already (a `'web'` persona exists for this address) → log straight into THAT soul
  //     — never a duplicate, never a 409 (mirrors /wallet/link's "existing persona" branch).
  //   • absent → MINT a new anima and bind the wallet as its `'web'` persona. That binding IS the
  //     deposit-attribution seam (crystal/resolveWalletAnima reads `('web', address)`), so it must
  //     be race-safe: the unique (genus:'web', externusId) index is the guard — a concurrent
  //     double-signup that loses the insert dup-keys, and we re-read + adopt the WINNER's binding
  //     (the losing path's freshly-minted anima is orphaned — never bound, never credited).
  // Returns { session, animaId } like /register (201 on a fresh mint, 200 when it resolved to an
  // already-bound soul). Does NOT touch deposit crediting/the ledger — it only writes the binding
  // attribution later READS.
  router.post('/wallet/register', rl.wallet ?? noop, async (req: Request, res: Response) => {
    const address = verifyWalletChallenge(req.body?.challengeToken, req.body?.signature, jwtSecret)
    if (!address) return fail(res, 400, 'auth.token_invalid', 'Wallet verification failed or expired')

    // Already bound → this is a login, not a signup. Issue a session for the bound soul.
    const bound = await personae.findByExternus('web', address)
    if (bound) {
      log.info('auth: wallet signup resolved to existing soul', { animaId: bound.activeAnimaId })
      return res.status(200).json({ session: mint(bound.activeAnimaId), animaId: bound.activeAnimaId })
    }

    // Absent → mint a soul and bind the wallet. On a unique-index collision (a concurrent
    // signup won the insert between our read and our write) re-read and adopt the winner.
    const anima = await animae.create({ nomen: `web:${address}` })
    let persona: Persona
    try {
      persona = await personae.findOrCreate('web', address, { animaId: anima.id })
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err
      const winner = await personae.findByExternus('web', address)
      if (!winner) throw err // dup-key but no visible row → a real fault, don't paper over it
      persona = winner
    }
    const minted = persona.activeAnimaId === anima.id
    log.info('auth: wallet signup', { animaId: persona.activeAnimaId, minted })
    res.status(minted ? 201 : 200).json({ session: mint(persona.activeAnimaId), animaId: persona.activeAnimaId })
  })

  // ── POST /wallet/recover ─────────────────────────────────────────────────────────────
  // Public: prove a wallet → log straight into the soul it's bound to (forgot-password path).
  router.post('/wallet/recover', rl.wallet ?? noop, async (req: Request, res: Response) => {
    const address = verifyWalletChallenge(req.body?.challengeToken, req.body?.signature, jwtSecret)
    if (!address) return fail(res, 400, 'auth.token_invalid', 'Wallet verification failed or expired')
    const persona = await personae.findByExternus('web', address)
    if (!persona) return fail(res, 401, 'auth.invalid', 'No account is linked to this wallet')
    res.status(200).json({ session: mint(persona.activeAnimaId), animaId: persona.activeAnimaId })
  })

  // ── GET /wallet ─────────────────────────────────────────────────────────────────────
  // Authed: the caller's linked wallet addresses (the `'web'` personae that are EVM addresses —
  // filters out non-address `'web'` masks like Privy DIDs).
  router.get('/wallet', async (req: Request, res: Response) => {
    const animaId = sessionAnima(req)
    if (!animaId) return fail(res, 401, 'auth.invalid', 'Sign in to view linked wallets')
    // Filter on the ACTIVE pointer, not mere membership: since /wallet/link can now MOVE a
    // binding (linkAnima $addToSet never removes the old anima), a wallet moved away still
    // lists this soul in its animaIds. `activeAnimaId` is authoritative (same as GET /telegram).
    const masks = await personae.findByAnimaId(animaId)
    const wallets = masks
      .filter(p => p.genus === 'web' && p.activeAnimaId === animaId && normalizeAddress(p.externusId))
      .map(p => p.externusId)
    res.status(200).json({ wallets })
  })

  // ── POST /telegram/challenge ─────────────────────────────────────────────────────────
  // Authed: mint a one-time link code + deep link. Tapping it opens the bot, which redeems
  // the code (`/start link_<code>`) and re-points the caller's Telegram at this account.
  router.post('/telegram/challenge', async (req: Request, res: Response) => {
    const animaId = sessionAnima(req)
    if (!animaId) return fail(res, 401, 'auth.invalid', 'Sign in to link Telegram')
    if (!linkTokens) return fail(res, 501, 'unsupported', 'Telegram linking is not configured')
    const code = await linkTokens.issue(animaId, 'tg-link', TELEGRAM_LINK_TTL_SECONDS)
    const deepLink = botUsername ? `https://t.me/${botUsername}?start=link_${code}` : undefined
    res.status(200).json({ code, ...(deepLink ? { deepLink } : {}), ...(botUsername ? { botUsername } : {}) })
  })

  // ── GET /telegram ─────────────────────────────────────────────────────────────────────
  // Authed: is a Telegram identity bound to this soul? (a `telegram` persona pointing here).
  router.get('/telegram', async (req: Request, res: Response) => {
    const animaId = sessionAnima(req)
    if (!animaId) return fail(res, 401, 'auth.invalid', 'Sign in to view Telegram backup')
    // Filter on the ACTIVE pointer, not mere membership: a re-pointed persona (linkAnima
    // uses $addToSet, never removes) can still list a former soul in animaIds, so `some(genus)`
    // would report a backup this soul no longer actually has. `activeAnimaId` is authoritative.
    const masks = await personae.findByAnimaId(animaId)
    res.status(200).json({ linked: masks.some(p => p.genus === 'telegram' && p.activeAnimaId === animaId) })
  })

  // ── POST /telegram/recover ─────────────────────────────────────────────────────────────
  // Public: redeem a bot-issued recovery code → log straight into the bound soul (forgot-password).
  router.post('/telegram/recover', rl.wallet ?? noop, async (req: Request, res: Response) => {
    if (!linkTokens) return fail(res, 501, 'unsupported', 'Telegram recovery is not configured')
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : ''
    const animaId = code ? await linkTokens.consume(code, 'tg-recover') : null
    if (!animaId) return fail(res, 400, 'auth.token_invalid', 'That recovery code is invalid or has expired')
    res.status(200).json({ session: mint(animaId), animaId })
  })

  return router
}
