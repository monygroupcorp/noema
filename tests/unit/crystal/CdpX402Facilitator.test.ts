import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createCdpX402Facilitator, type CdpFacilitatorClient, type CdpPaymentPayload } from '../../../src/crystal/CdpX402Facilitator.js'
import type { X402Accept } from '../../../src/types/x402.js'

const ACCEPT: X402Accept = {
  scheme: 'exact',
  network: 'eip155:8453',
  asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  amount: '404400',
  payTo: '0xPlatformReceiver',
  maxTimeoutSeconds: 300,
  extra: { name: 'USD Coin', version: '2' },
}

// A minimal fake of the decoded X-PAYMENT payload.
const fakePayload = (): CdpPaymentPayload => ({
  x402Version: 2,
  resource: { url: 'x', description: 'x', mimeType: 'application/json' },
  accepted: { ...ACCEPT, extra: { ...ACCEPT.extra } },
  payload: { signature: '0xsig', authorization: { nonce: '0xnonce' } },
})

/** A configurable fake CDP client capturing what requirements it was verified/settled against. */
function fakeClient(over: Partial<{
  verify: CdpFacilitatorClient['verify']; settle: CdpFacilitatorClient['settle']
}> = {}): { client: CdpFacilitatorClient; seen: { verifyReq?: unknown; settleReq?: unknown } } {
  const seen: { verifyReq?: unknown; settleReq?: unknown } = {}
  const client: CdpFacilitatorClient = {
    async verify(_p, req) { seen.verifyReq = req; return { isValid: true, payer: '0xPAYER' } },
    async settle(_p, req) { seen.settleReq = req; return { success: true, transaction: '0xTX', payer: '0xPAYER' } },
    ...over,
  }
  return { client, seen }
}

test('verify: valid payment → payer lowercased, amount = OUR price, stable sig hash', async () => {
  const { client } = fakeClient()
  const fac = createCdpX402Facilitator({ client, decodePayment: fakePayload })
  const header = 'base64header'
  const r = await fac.verify(header, ACCEPT)
  assert.equal(r.valid, true)
  assert.equal(r.payer, '0xpayer')
  assert.equal(r.amount, '404400')
  assert.equal(r.signatureHash, createHash('sha256').update(header).digest('hex'))
})

test('verify: passes OUR requirements to the facilitator, never the payer-claimed accepted block', async () => {
  const { client, seen } = fakeClient()
  const fac = createCdpX402Facilitator({ client, decodePayment: fakePayload })
  await fac.verify('h', ACCEPT)
  // A malicious payer could claim a cheaper `accepted`, but we verify against ACCEPT.
  assert.deepEqual(seen.verifyReq, {
    scheme: 'exact', network: 'eip155:8453', asset: ACCEPT.asset,
    amount: '404400', payTo: '0xPlatformReceiver', maxTimeoutSeconds: 300,
    extra: { name: 'USD Coin', version: '2' },
  })
})

test('verify: invalid payment → not valid, surfaces reason, no sig hash', async () => {
  const { client } = fakeClient({ async verify() { return { isValid: false, invalidReason: 'insufficient_funds' } } })
  const fac = createCdpX402Facilitator({ client, decodePayment: fakePayload })
  const r = await fac.verify('h', ACCEPT)
  assert.equal(r.valid, false)
  assert.equal(r.error, 'insufficient_funds')
  assert.equal(r.signatureHash, undefined)
})

test('verify: malformed header (decode throws) → fail closed, never calls facilitator', async () => {
  let called = false
  const client: CdpFacilitatorClient = {
    async verify() { called = true; return { isValid: true } },
    async settle() { return { success: true, transaction: '' } },
  }
  const fac = createCdpX402Facilitator({ client, decodePayment: () => { throw new Error('bad base64') } })
  const r = await fac.verify('garbage', ACCEPT)
  assert.equal(r.valid, false)
  assert.match(r.error ?? '', /malformed X-PAYMENT/)
  assert.equal(called, false)
})

test('verify: facilitator throws (network/CDP error) → fail closed', async () => {
  const { client } = fakeClient({ async verify() { throw new Error('CDP 503') } })
  const fac = createCdpX402Facilitator({ client, decodePayment: fakePayload })
  const r = await fac.verify('h', ACCEPT)
  assert.equal(r.valid, false)
  assert.match(r.error ?? '', /facilitator verify failed: CDP 503/)
})

test('settle: success → transaction hash surfaced', async () => {
  const { client } = fakeClient()
  const fac = createCdpX402Facilitator({ client, decodePayment: fakePayload })
  const r = await fac.settle('h', ACCEPT)
  assert.equal(r.success, true)
  assert.equal(r.transaction, '0xTX')
})

test('settle: failure → surfaces errorReason, no transaction', async () => {
  const { client } = fakeClient({ async settle() { return { success: false, errorReason: 'reverted', transaction: '' } } })
  const fac = createCdpX402Facilitator({ client, decodePayment: fakePayload })
  const r = await fac.settle('h', ACCEPT)
  assert.equal(r.success, false)
  assert.equal(r.error, 'reverted')
})

test('settle: facilitator throws → fail closed', async () => {
  const { client } = fakeClient({ async settle() { throw new Error('timeout') } })
  const fac = createCdpX402Facilitator({ client, decodePayment: fakePayload })
  const r = await fac.settle('h', ACCEPT)
  assert.equal(r.success, false)
  assert.match(r.error ?? '', /facilitator settle failed: timeout/)
})
