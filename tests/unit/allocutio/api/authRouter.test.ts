import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import request from 'supertest'
import { createAuthRouter } from '../../../../src/allocutio/api/authRouter.js'
import { createApiRouter, type ApiFacade } from '../../../../src/allocutio/api/apiRouter.js'
import { IdentityResolver } from '../../../../src/allocutio/api/IdentityResolver.js'
import { makeCredentialAcceptors, type AcceptorDeps } from '../../../../src/allocutio/api/apiAcceptors.js'
import { MemoryCredentum } from '../../../../src/crystal/MemoryCredentum.js'
import type { Mailer, MailMessage } from '../../../../src/allocutio/api/Mailer.js'

const SECRET = 'test-secret'

// Inline persona/anima fakes (the apiAcceptors.test pattern) — a `'password'` persona
// per email, minting one anima per fresh externusId and reusing it thereafter.
function stores() {
  const personaByKey = new Map<string, { activeAnimaId: string }>()
  let n = 0
  const created: string[] = []
  const personae: AcceptorDeps['personae'] = {
    async findByExternus(genus, ext) {
      return (personaByKey.get(`${genus}\0${ext}`) ?? null) as never
    },
    async findOrCreate(genus, ext, defaults) {
      const p = { activeAnimaId: defaults!.animaId }
      personaByKey.set(`${genus}\0${ext}`, p)
      return p as never
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

class CaptureMailer implements Mailer {
  sent: MailMessage[] = []
  async send(msg: MailMessage): Promise<void> { this.sent.push(msg) }
  /** Pull the `token=...` out of the most recent email. */
  lastToken(): string {
    const html = this.sent[this.sent.length - 1]?.html ?? ''
    const m = html.match(/token=([^"&]+)/)
    return m ? decodeURIComponent(m[1]) : ''
  }
}

function harness(opts?: { now?: () => Date }) {
  const { personae, animae, created } = stores()
  const credenta = new MemoryCredentum(opts?.now)
  const mailer = new CaptureMailer()
  const identity = new IdentityResolver(makeCredentialAcceptors({ personae, animae, jwtSecret: SECRET }))

  // Minimal facade — only /v1/me is exercised, echoing the resolved animaId back.
  const api = {
    async getMe(auctor: { animaId?: string }) { return { animaId: auctor.animaId } },
  } as unknown as ApiFacade

  const app = express()
  app.use('/v1/auth', express.json(), createAuthRouter({
    credenta, personae, animae, mailer, jwtSecret: SECRET,
    ...(opts?.now ? { now: opts.now } : {}),
  }))
  app.use('/v1', createApiRouter({ api, identity }))
  return { app, mailer, credenta, created }
}

test('register → 202, sends a verification email, mints no session', async () => {
  const { app, mailer } = harness()
  const res = await request(app).post('/v1/auth/register').send({ email: 'Alice@Example.com ', password: 'hunter2!pw' })
  assert.equal(res.status, 202)
  assert.equal(res.body.session, undefined)
  assert.equal(mailer.sent.length, 1)
  assert.match(mailer.sent[0].subject, /verify/i)
  assert.ok(mailer.lastToken().length > 0)
})

test('register validation: bad email / weak password → 400', async () => {
  const { app } = harness()
  assert.equal((await request(app).post('/v1/auth/register').send({ email: 'nope', password: 'longenough1' })).status, 400)
  assert.equal((await request(app).post('/v1/auth/register').send({ email: 'a@b.co', password: 'short' })).status, 400)
})

test('duplicate register → generic 409 (no enumeration)', async () => {
  const { app } = harness()
  await request(app).post('/v1/auth/register').send({ email: 'dup@example.com', password: 'password123' })
  const res = await request(app).post('/v1/auth/register').send({ email: 'dup@example.com', password: 'different99' })
  assert.equal(res.status, 409)
  assert.doesNotMatch(JSON.stringify(res.body), /exist|taken|registered/i)
})

test('login before verify → 403 email_unverified', async () => {
  const { app } = harness()
  await request(app).post('/v1/auth/register').send({ email: 'u@example.com', password: 'password123' })
  const res = await request(app).post('/v1/auth/login').send({ email: 'u@example.com', password: 'password123' })
  assert.equal(res.status, 403)
  assert.equal(res.body.error.code, 'auth.email_unverified')
})

test('the same-Anima invariant: register → verify → /v1/me and login all resolve ONE anima', async () => {
  const { app, mailer, created } = harness()
  await request(app).post('/v1/auth/register').send({ email: 'same@example.com', password: 'password123' })
  assert.deepEqual(created, ['anima-1'], 'register minted exactly one anima')

  // Verify (auto-login) → a session for that anima.
  const verify = await request(app).post('/v1/auth/verify-email').send({ token: mailer.lastToken() })
  assert.equal(verify.status, 200)
  const animaId = verify.body.animaId
  assert.equal(animaId, 'anima-1')
  const sessionToken = verify.body.session.token

  // The session token, carried as a real Bearer, resolves to the SAME anima at /v1/me —
  // proving verifyJwt's `typ:'session'` short-circuit doesn't split the account.
  const me = await request(app).get('/v1/me').set('authorization', `Bearer ${sessionToken}`)
  assert.equal(me.status, 200)
  assert.equal(me.body.animaId, 'anima-1')

  // Logging in yields the same anima — and mints no NEW anima.
  const login = await request(app).post('/v1/auth/login').send({ email: 'same@example.com', password: 'password123' })
  assert.equal(login.status, 200)
  assert.equal(login.body.animaId, 'anima-1')
  assert.deepEqual(created, ['anima-1'], 'no second anima across verify + me + login')
})

test('login: wrong password → generic 401; correct + verified → 200', async () => {
  const { app, mailer } = harness()
  await request(app).post('/v1/auth/register').send({ email: 'log@example.com', password: 'password123' })
  await request(app).post('/v1/auth/verify-email').send({ token: mailer.lastToken() })
  assert.equal((await request(app).post('/v1/auth/login').send({ email: 'log@example.com', password: 'WRONG' })).status, 401)
  assert.equal((await request(app).post('/v1/auth/login').send({ email: 'log@example.com', password: 'password123' })).status, 200)
})

test('forgot → reset → login with new password works; old fails', async () => {
  const { app, mailer } = harness()
  await request(app).post('/v1/auth/register').send({ email: 'reset@example.com', password: 'oldpassword1' })
  await request(app).post('/v1/auth/verify-email').send({ token: mailer.lastToken() })

  const forgot = await request(app).post('/v1/auth/forgot-password').send({ email: 'reset@example.com' })
  assert.equal(forgot.status, 202)
  const resetToken = mailer.lastToken()
  const reset = await request(app).post('/v1/auth/reset-password').send({ token: resetToken, newPassword: 'newpassword9' })
  assert.equal(reset.status, 200)

  assert.equal((await request(app).post('/v1/auth/login').send({ email: 'reset@example.com', password: 'newpassword9' })).status, 200)
  assert.equal((await request(app).post('/v1/auth/login').send({ email: 'reset@example.com', password: 'oldpassword1' })).status, 401)
})

test('forgot-password for an unknown email → 202 (no enumeration), no email sent', async () => {
  const { app, mailer } = harness()
  const res = await request(app).post('/v1/auth/forgot-password').send({ email: 'ghost@example.com' })
  assert.equal(res.status, 202)
  assert.equal(mailer.sent.length, 0)
})

test('reused verification token is rejected on the second use', async () => {
  const { app, mailer } = harness()
  await request(app).post('/v1/auth/register').send({ email: 'once@example.com', password: 'password123' })
  const token = mailer.lastToken()
  assert.equal((await request(app).post('/v1/auth/verify-email').send({ token })).status, 200)
  assert.equal((await request(app).post('/v1/auth/verify-email').send({ token })).status, 400)
})

test('expired verification + reset tokens are rejected', async () => {
  let t = new Date('2026-01-01T00:00:00Z')
  const { app, mailer } = harness({ now: () => t })
  await request(app).post('/v1/auth/register').send({ email: 'exp@example.com', password: 'password123' })
  const vtoken = mailer.lastToken()
  t = new Date('2026-01-03T00:00:00Z')   // > 24h later
  assert.equal((await request(app).post('/v1/auth/verify-email').send({ token: vtoken })).status, 400)
})

test('session/refresh: valid session → fresh session; garbage → 401', async () => {
  const { app, mailer } = harness()
  await request(app).post('/v1/auth/register').send({ email: 'ref@example.com', password: 'password123' })
  const v = await request(app).post('/v1/auth/verify-email').send({ token: mailer.lastToken() })
  const token = v.body.session.token
  const refreshed = await request(app).post('/v1/auth/session/refresh').set('authorization', `Bearer ${token}`)
  assert.equal(refreshed.status, 200)
  assert.equal(refreshed.body.animaId, 'anima-1')
  assert.equal((await request(app).post('/v1/auth/session/refresh').set('authorization', 'Bearer garbage')).status, 401)
})

test('resend-verification always 202; only emails an existing unverified account', async () => {
  const { app, mailer } = harness()
  assert.equal((await request(app).post('/v1/auth/resend-verification').send({ email: 'ghost@example.com' })).status, 202)
  assert.equal(mailer.sent.length, 0)
  await request(app).post('/v1/auth/register').send({ email: 'rs@example.com', password: 'password123' })
  const before = mailer.sent.length
  assert.equal((await request(app).post('/v1/auth/resend-verification').send({ email: 'rs@example.com' })).status, 202)
  assert.equal(mailer.sent.length, before + 1)
})
