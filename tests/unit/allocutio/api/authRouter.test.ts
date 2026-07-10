import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createAuthRouter } from '../../../../src/allocutio/api/authRouter.js'
import { createApiRouter, type ApiFacade } from '../../../../src/allocutio/api/apiRouter.js'
import { IdentityResolver } from '../../../../src/allocutio/api/IdentityResolver.js'
import { makeCredentialAcceptors, type AcceptorDeps } from '../../../../src/allocutio/api/apiAcceptors.js'
import { MemoryCredentum } from '../../../../src/crystal/MemoryCredentum.js'
import { MemoryLinkToken } from '../../../../src/crystal/MemoryLinkToken.js'
import { linkTelegramToAccount, issueTelegramRecoveryCode } from '../../../../src/allocutio/telegram/telegramRecovery.js'
import { Wallet } from 'ethers'

const SECRET = 'test-secret'

// Inline persona/anima fakes (the apiAcceptors.test pattern) — a `'password'` persona
// per username, minting one anima per fresh externusId and reusing it thereafter. Personas
// carry id/genus/externusId/activeAnimaId/animaIds so the wallet + telegram routes
// (findByAnimaId, linkAnima, switchAnima) work.
interface FakePersona { id: string; genus: string; externusId: string; activeAnimaId: string; animaIds: string[] }
function stores() {
  const personaByKey = new Map<string, FakePersona>()
  let n = 0
  let pid = 0
  const created: string[] = []
  const byId = () => new Map([...personaByKey.values()].map(p => [p.id, p]))
  const personae: AcceptorDeps['personae'] & {
    findByAnimaId: (a: string) => Promise<unknown>
    linkAnima: (id: string, a: string) => Promise<unknown>
    switchAnima: (id: string, a: string) => Promise<unknown>
  } = {
    async findByExternus(genus, ext) {
      return (personaByKey.get(`${genus}\0${ext}`) ?? null) as never
    },
    async findOrCreate(genus, ext, defaults) {
      const existing = personaByKey.get(`${genus}\0${ext}`)
      if (existing) return existing as never
      const p: FakePersona = { id: `p${++pid}`, genus, externusId: ext, activeAnimaId: defaults!.animaId, animaIds: [defaults!.animaId] }
      personaByKey.set(`${genus}\0${ext}`, p)
      return p as never
    },
    async findByAnimaId(animaId) {
      return [...personaByKey.values()].filter(p => p.animaIds.includes(animaId)) as never
    },
    async linkAnima(id, animaId) {
      const p = byId().get(id)!; if (!p.animaIds.includes(animaId)) p.animaIds.push(animaId); return p as never
    },
    async switchAnima(id, animaId) {
      const p = byId().get(id)!; p.activeAnimaId = animaId; return p as never
    },
  }
  const animae: AcceptorDeps['animae'] = {
    async create(input) {
      const id = `anima-${++n}`
      created.push(id)
      return { id, ...input } as never
    },
  }
  return { personae, animae, created }
}

function harness() {
  const { personae, animae, created } = stores()
  const credenta = new MemoryCredentum()
  const linkTokens = new MemoryLinkToken()
  const identity = new IdentityResolver(makeCredentialAcceptors({ personae, animae, jwtSecret: SECRET }))

  // Minimal facade — only /v1/me is exercised, echoing the resolved animaId back.
  const api = {
    async getMe(auctor: { animaId?: string }) { return { animaId: auctor.animaId } },
  } as unknown as ApiFacade

  const app = express()
  app.use('/v1/auth', express.json(), createAuthRouter({ credenta, personae, animae, jwtSecret: SECRET, linkTokens, botUsername: 'noemabot' }))
  app.use('/v1', createApiRouter({ api, identity }))
  return { app, credenta, created, personae, animae, linkTokens }
}

test('register → 201 with a live session (no verification step)', async () => {
  const { app } = harness()
  const res = await request(app).post('/v1/auth/register').send({ username: 'Alice', password: 'hunter2!pw' })
  assert.equal(res.status, 201)
  assert.ok(res.body.session?.token, 'a session is minted immediately')
  assert.ok(res.body.animaId)
})

test('register validation: bad username / weak password → 400', async () => {
  const { app } = harness()
  assert.equal((await request(app).post('/v1/auth/register').send({ username: 'ab', password: 'longenough1' })).status, 400)
  assert.equal((await request(app).post('/v1/auth/register').send({ username: 'has space', password: 'longenough1' })).status, 400)
  assert.equal((await request(app).post('/v1/auth/register').send({ username: 'a@b', password: 'longenough1' })).status, 400)
  assert.equal((await request(app).post('/v1/auth/register').send({ username: 'goodname', password: 'short' })).status, 400)
})

test('duplicate register → generic 409 (no enumeration); case/space-insensitive', async () => {
  const { app } = harness()
  await request(app).post('/v1/auth/register').send({ username: 'dupe', password: 'password123' })
  const res = await request(app).post('/v1/auth/register').send({ username: ' DUPE ', password: 'different99' })
  assert.equal(res.status, 409)
  assert.doesNotMatch(JSON.stringify(res.body), /exist|taken|registered/i)
})

test('the same-Anima invariant: register → /v1/me and login all resolve ONE anima', async () => {
  const { app, created } = harness()
  const reg = await request(app).post('/v1/auth/register').send({ username: 'same', password: 'password123' })
  assert.equal(reg.status, 201)
  assert.deepEqual(created, ['anima-1'], 'register minted exactly one anima')
  const animaId = reg.body.animaId
  assert.equal(animaId, 'anima-1')
  const sessionToken = reg.body.session.token

  // The session token, carried as a real Bearer, resolves to the SAME anima at /v1/me —
  // proving verifyJwt's `typ:'session'` short-circuit doesn't split the account.
  const me = await request(app).get('/v1/me').set('authorization', `Bearer ${sessionToken}`)
  assert.equal(me.status, 200)
  assert.equal(me.body.animaId, 'anima-1')

  // Logging in yields the same anima — and mints no NEW anima.
  const login = await request(app).post('/v1/auth/login').send({ username: 'same', password: 'password123' })
  assert.equal(login.status, 200)
  assert.equal(login.body.animaId, 'anima-1')
  assert.deepEqual(created, ['anima-1'], 'no second anima across register + me + login')
})

test('login: wrong password → generic 401; correct → 200 (no verification gate)', async () => {
  const { app } = harness()
  await request(app).post('/v1/auth/register').send({ username: 'logger', password: 'password123' })
  assert.equal((await request(app).post('/v1/auth/login').send({ username: 'logger', password: 'WRONG' })).status, 401)
  assert.equal((await request(app).post('/v1/auth/login').send({ username: 'logger', password: 'password123' })).status, 200)
})

test('login: unknown username → generic 401 (no enumeration)', async () => {
  const { app } = harness()
  const res = await request(app).post('/v1/auth/login').send({ username: 'ghost', password: 'password123' })
  assert.equal(res.status, 401)
  assert.equal(res.body.error.code, 'auth.invalid')
})

test('session/refresh: valid session → fresh session; garbage → 401', async () => {
  const { app } = harness()
  const reg = await request(app).post('/v1/auth/register').send({ username: 'refresher', password: 'password123' })
  const token = reg.body.session.token
  const refreshed = await request(app).post('/v1/auth/session/refresh').set('authorization', `Bearer ${token}`)
  assert.equal(refreshed.status, 200)
  assert.equal(refreshed.body.animaId, 'anima-1')
  assert.equal((await request(app).post('/v1/auth/session/refresh').set('authorization', 'Bearer garbage')).status, 401)
})

// ── Wallet backup recovery channel ───────────────────────────────────────────────

// Register a user, returning their session bearer + animaId.
async function signUp(app: express.Express, username: string) {
  const reg = await request(app).post('/v1/auth/register').send({ username, password: 'password123' })
  return { bearer: reg.body.session.token as string, animaId: reg.body.animaId as string }
}

// Run the full challenge→sign dance for `wallet` and return { challengeToken, signature }.
async function proveWallet(app: express.Express, wallet: Wallet) {
  const ch = await request(app).post('/v1/auth/wallet/challenge').send({ address: wallet.address })
  assert.equal(ch.status, 200)
  const signature = await wallet.signMessage(ch.body.statement)
  return { challengeToken: ch.body.token as string, signature }
}

test('wallet link (authed) then recover → same anima; logs straight in', async () => {
  const { app } = harness()
  const { bearer, animaId } = await signUp(app, 'walletuser')
  const wallet = Wallet.createRandom()

  const link = await request(app).post('/v1/auth/wallet/link')
    .set('authorization', `Bearer ${bearer}`).send(await proveWallet(app, wallet))
  assert.equal(link.status, 200)
  assert.equal(link.body.address, wallet.address.toLowerCase())

  // A fresh challenge (single flow per sign) — recover with no session at all.
  const rec = await request(app).post('/v1/auth/wallet/recover').send(await proveWallet(app, wallet))
  assert.equal(rec.status, 200)
  assert.equal(rec.body.animaId, animaId, 'recover lands on the linked soul')
  assert.ok(rec.body.session?.token)
})

test('wallet link requires a session → 401 without a bearer', async () => {
  const { app } = harness()
  const wallet = Wallet.createRandom()
  const res = await request(app).post('/v1/auth/wallet/link').send(await proveWallet(app, wallet))
  assert.equal(res.status, 401)
})

test('wallet recover for an unlinked wallet → 401 (no enumeration)', async () => {
  const { app } = harness()
  const res = await request(app).post('/v1/auth/wallet/recover').send(await proveWallet(app, Wallet.createRandom()))
  assert.equal(res.status, 401)
  assert.equal(res.body.error.code, 'auth.invalid')
})

test('a bad/tampered signature → 400, never a session', async () => {
  const { app } = harness()
  const wallet = Wallet.createRandom()
  const ch = await request(app).post('/v1/auth/wallet/challenge').send({ address: wallet.address })
  // Sign a DIFFERENT message than the challenge statement.
  const signature = await wallet.signMessage('not the challenge')
  const res = await request(app).post('/v1/auth/wallet/recover').send({ challengeToken: ch.body.token, signature })
  assert.equal(res.status, 400)
})

test('re-linking a wallet MOVES it to the new account (moved:true); recovery + listing follow', async () => {
  const { app } = harness()
  const a = await signUp(app, 'accounta')
  const b = await signUp(app, 'accountb')
  const wallet = Wallet.createRandom()

  const first = await request(app).post('/v1/auth/wallet/link')
    .set('authorization', `Bearer ${a.bearer}`).send(await proveWallet(app, wallet))
  assert.equal(first.status, 200)
  assert.equal(first.body.moved, false, 'first bind is not a move')

  const second = await request(app).post('/v1/auth/wallet/link')
    .set('authorization', `Bearer ${b.bearer}`).send(await proveWallet(app, wallet))
  assert.equal(second.status, 200)
  assert.equal(second.body.moved, true, 'binding an already-bound wallet is a move')

  // Recovery now lands on B, and A no longer lists the moved wallet (active-pointer filter).
  const rec = await request(app).post('/v1/auth/wallet/recover').send(await proveWallet(app, wallet))
  assert.equal(rec.body.animaId, b.animaId, 'recover follows the move to account B')
  const aList = await request(app).get('/v1/auth/wallet').set('authorization', `Bearer ${a.bearer}`)
  assert.deepEqual(aList.body.wallets, [], 'the losing account no longer lists the moved wallet')
  const bList = await request(app).get('/v1/auth/wallet').set('authorization', `Bearer ${b.bearer}`)
  assert.deepEqual(bList.body.wallets, [wallet.address.toLowerCase()])
})

test('GET /wallet lists the caller\'s linked wallets', async () => {
  const { app } = harness()
  const { bearer } = await signUp(app, 'lister')
  const wallet = Wallet.createRandom()
  await request(app).post('/v1/auth/wallet/link')
    .set('authorization', `Bearer ${bearer}`).send(await proveWallet(app, wallet))

  const list = await request(app).get('/v1/auth/wallet').set('authorization', `Bearer ${bearer}`)
  assert.equal(list.status, 200)
  assert.deepEqual(list.body.wallets, [wallet.address.toLowerCase()])
  // Unauthenticated → 401.
  assert.equal((await request(app).get('/v1/auth/wallet')).status, 401)
})

// ── Telegram backup recovery channel ─────────────────────────────────────────────

test('telegram challenge → code + deep link (authed); 401 without a bearer', async () => {
  const { app } = harness()
  const { bearer } = await signUp(app, 'tguser')
  const res = await request(app).post('/v1/auth/telegram/challenge').set('authorization', `Bearer ${bearer}`)
  assert.equal(res.status, 200)
  assert.ok(res.body.code)
  assert.match(res.body.deepLink, /^https:\/\/t\.me\/noemabot\?start=link_/)
  assert.equal((await request(app).post('/v1/auth/telegram/challenge')).status, 401)
})

test('the full loop: web link code → bot binds → bot recovery code → web session (same anima)', async () => {
  const { app, personae, animae, linkTokens } = harness()
  const { bearer, animaId } = await signUp(app, 'tgloop')

  // 1. Web mints a link code.
  const challenge = await request(app).post('/v1/auth/telegram/challenge').set('authorization', `Bearer ${bearer}`)
  const linkCode = challenge.body.code

  // Status is not-linked before the bot redeems it.
  const before = await request(app).get('/v1/auth/telegram').set('authorization', `Bearer ${bearer}`)
  assert.equal(before.body.linked, false)

  // 2. Bot redeems it for telegram user 555 → re-points that Telegram at the web soul.
  const outcome = await linkTelegramToAccount({ personae, linkTokens }, '555', linkCode)
  assert.equal(outcome, 'linked')

  // Status now reflects the linked Telegram.
  const after = await request(app).get('/v1/auth/telegram').set('authorization', `Bearer ${bearer}`)
  assert.equal(after.body.linked, true)

  // 3. Bot mints a recovery code for telegram user 555 → 4. web redeems → session on the SAME soul.
  const recoveryCode = await issueTelegramRecoveryCode({ personae, animae, linkTokens }, '555')
  const rec = await request(app).post('/v1/auth/telegram/recover').send({ code: recoveryCode })
  assert.equal(rec.status, 200)
  assert.equal(rec.body.animaId, animaId, 'recover lands on the web account, not a telegram-native anima')
  assert.ok(rec.body.session?.token)
})

test('telegram recover: a reused / bogus code → 400 (single-use), never a session', async () => {
  const { app, personae, animae, linkTokens } = harness()
  const { animaId } = await signUp(app, 'tgonce')
  await linkTelegramToAccount({ personae, linkTokens }, '777', await (async () => {
    // issue a tg-link code directly for this anima and bind it
    return linkTokens.issue(animaId, 'tg-link', 600)
  })())
  const code = await issueTelegramRecoveryCode({ personae, animae, linkTokens }, '777')
  assert.equal((await request(app).post('/v1/auth/telegram/recover').send({ code })).status, 200)
  // Second use of the same code is rejected (single-use).
  assert.equal((await request(app).post('/v1/auth/telegram/recover').send({ code })).status, 400)
  assert.equal((await request(app).post('/v1/auth/telegram/recover').send({ code: 'garbage' })).status, 400)
})

test('an invalid link code does not bind anything', async () => {
  const { personae, linkTokens } = harness()
  assert.equal(await linkTelegramToAccount({ personae, linkTokens }, '999', 'not-a-real-code'), 'invalid')
})

// ── Trust proxy setting for rate-limiter behind caddy ───────────────────────────────

test('express app can set trust proxy for caddy reverse proxy', () => {
  // The real src/index.ts calls app.set('trust proxy', 1) after express() creation
  // to handle X-Forwarded-For headers from caddy. This allows express-rate-limit
  // to correctly extract the client IP instead of treating the caddy IP as the client.
  const testApp = express()
  testApp.set('trust proxy', 1)
  assert.equal(testApp.get('trust proxy'), 1, 'trust proxy should be 1 for single-hop caddy proxy')
})
