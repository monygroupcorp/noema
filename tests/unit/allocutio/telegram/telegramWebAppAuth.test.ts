import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifyWebAppInitData } from '../../../../src/allocutio/telegram/telegramWebAppAuth.js'

const BOT_TOKEN = '123456:test-bot-token'
const NOW = new Date('2026-11-17T12:00:00Z')
const nowSeconds = Math.floor(NOW.getTime() / 1000)
const opts = { now: NOW, maxAgeSeconds: 600 }

/** Sign a launch the way Telegram does (core.telegram.org/bots/webapps, "Validating data"). */
function signInitData(fields: Record<string, string>, botToken = BOT_TOKEN): string {
  const checkString = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n')
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest()
  const hash = createHmac('sha256', secret).update(checkString).digest('hex')
  return new URLSearchParams({ ...fields, hash }).toString()
}

const launch = (over: Record<string, string> = {}) => ({
  query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
  user: JSON.stringify({ id: 279058397, first_name: 'Ada', language_code: 'en' }),
  auth_date: String(nowSeconds - 30),
  ...over,
})

test('a launch Telegram signed with this bot token binds its user id', () => {
  const verdict = verifyWebAppInitData(signInitData(launch()), BOT_TOKEN, opts)
  assert.equal(verdict.ok, true)
  assert.equal(verdict.ok && verdict.telegramUserId, '279058397')
})

test('a forged hash is refused', () => {
  const genuine = new URLSearchParams(signInitData(launch()))
  genuine.set('hash', 'a'.repeat(64))
  assert.deepEqual(verifyWebAppInitData(genuine.toString(), BOT_TOKEN, opts), { ok: false, reason: 'bad_hash' })
})

test('a signed launch with its user swapped is refused', () => {
  const genuine = new URLSearchParams(signInitData(launch()))
  genuine.set('user', JSON.stringify({ id: 1, first_name: 'Mallory' }))
  assert.deepEqual(verifyWebAppInitData(genuine.toString(), BOT_TOKEN, opts), { ok: false, reason: 'bad_hash' })
})

test('a launch signed with another bot token is refused', () => {
  const other = signInitData(launch(), '999999:some-other-bot')
  assert.deepEqual(verifyWebAppInitData(other, BOT_TOKEN, opts), { ok: false, reason: 'bad_hash' })
})

test('a launch older than the window, or from the future, is refused', () => {
  const stale = signInitData(launch({ auth_date: String(nowSeconds - 601) }))
  assert.deepEqual(verifyWebAppInitData(stale, BOT_TOKEN, opts), { ok: false, reason: 'expired' })
  const future = signInitData(launch({ auth_date: String(nowSeconds + 3600) }))
  assert.deepEqual(verifyWebAppInitData(future, BOT_TOKEN, opts), { ok: false, reason: 'expired' })
})

test('malformed input is refused before any user is read', () => {
  for (const bad of ['', 'user=%7B%7D', 'hash=zz', `${signInitData(launch())}&auth_date=1`]) {
    const verdict = verifyWebAppInitData(bad, BOT_TOKEN, opts)
    assert.equal(verdict.ok, false, bad)
  }
  assert.equal(verifyWebAppInitData(signInitData(launch()), '', opts).ok, false, 'no token configured → never ok')
})

test('a validly signed launch with no user is refused', () => {
  const { user: _user, ...noUser } = launch()
  assert.deepEqual(verifyWebAppInitData(signInitData(noUser), BOT_TOKEN, opts), { ok: false, reason: 'no_user' })
})

test('the third-party signature field Telegram now sends stays inside the signed string', () => {
  const withSignature = launch({ signature: 'ZmFrZS1lZDI1NTE5LXNpZ25hdHVyZQ' })
  assert.equal(verifyWebAppInitData(signInitData(withSignature), BOT_TOKEN, opts).ok, true)
  const stripped = new URLSearchParams(signInitData(withSignature))
  stripped.delete('signature')
  assert.deepEqual(verifyWebAppInitData(stripped.toString(), BOT_TOKEN, opts), { ok: false, reason: 'bad_hash' },
    'dropping a signed field breaks the hash')
})
