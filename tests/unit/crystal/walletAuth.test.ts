// walletAuth — EIP-191 wallet challenge/verify (auth/replay-security surface). Hermetic.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Wallet } from 'ethers'
import jwt from 'jsonwebtoken'
import {
  normalizeAddress,
  challengeMessage,
  mintWalletChallenge,
  verifyWalletChallenge,
} from '../../../src/crystal/walletAuth.js'

const SECRET = 'test-wallet-auth-secret'

test('normalizeAddress: canonicalizes a checksummed/mixed-case address to lowercase', () => {
  const wallet = Wallet.createRandom()
  const lower = normalizeAddress(wallet.address.toLowerCase())
  const upper = normalizeAddress(wallet.address.toUpperCase().replace('0X', '0x'))
  const checksummed = normalizeAddress(wallet.address)
  assert.equal(lower, wallet.address.toLowerCase())
  assert.equal(upper, wallet.address.toLowerCase())
  assert.equal(checksummed, wallet.address.toLowerCase())
})

test('normalizeAddress: malformed input returns null', () => {
  assert.equal(normalizeAddress('not-an-address'), null)
  assert.equal(normalizeAddress(''), null)
  assert.equal(normalizeAddress(undefined), null)
  assert.equal(normalizeAddress(null), null)
  assert.equal(normalizeAddress(12345), null)
  assert.equal(normalizeAddress('0xdeadbeef'), null)
})

test('happy path: mint -> sign with an ethers.Wallet -> verify succeeds and binds the address', async () => {
  const wallet = Wallet.createRandom()
  const address = normalizeAddress(wallet.address)
  assert.ok(address)
  const { token, statement } = mintWalletChallenge(address as string, SECRET)
  const signature = await wallet.signMessage(statement)
  const proven = verifyWalletChallenge(token, signature, SECRET)
  assert.equal(proven, address)
})

test('statement embeds the nonce carried by the token', () => {
  const wallet = Wallet.createRandom()
  const address = normalizeAddress(wallet.address) as string
  const { token, statement } = mintWalletChallenge(address, SECRET)
  const payload = jwt.verify(token, SECRET) as { nonce: string }
  assert.equal(statement, challengeMessage(payload.nonce))
})

test('rejection: signature from the wrong wallet does not verify', async () => {
  const owner = Wallet.createRandom()
  const impostor = Wallet.createRandom()
  const address = normalizeAddress(owner.address) as string
  const { token, statement } = mintWalletChallenge(address, SECRET)
  const wrongSignature = await impostor.signMessage(statement)
  assert.equal(verifyWalletChallenge(token, wrongSignature, SECRET), null)
})

test('rejection: tampered token (wrong secret at verify time) does not verify', async () => {
  const wallet = Wallet.createRandom()
  const address = normalizeAddress(wallet.address) as string
  const { token, statement } = mintWalletChallenge(address, SECRET)
  const signature = await wallet.signMessage(statement)
  assert.equal(verifyWalletChallenge(token, signature, 'a-different-secret'), null)
})

test('rejection: expired challenge does not verify', async () => {
  const wallet = Wallet.createRandom()
  const address = normalizeAddress(wallet.address) as string
  const { token, statement } = mintWalletChallenge(address, SECRET, -1)
  const signature = await wallet.signMessage(statement)
  assert.equal(verifyWalletChallenge(token, signature, SECRET), null)
})

test('rejection: signature over a tampered statement (different nonce) does not verify', async () => {
  const wallet = Wallet.createRandom()
  const address = normalizeAddress(wallet.address) as string
  const { token } = mintWalletChallenge(address, SECRET)
  const tamperedStatement = challengeMessage('forged-nonce')
  const signature = await wallet.signMessage(tamperedStatement)
  assert.equal(verifyWalletChallenge(token, signature, SECRET), null)
})

test('rejection: malformed token/signature inputs return null without throwing', () => {
  assert.equal(verifyWalletChallenge('', '', SECRET), null)
  assert.equal(verifyWalletChallenge(undefined, undefined, SECRET), null)
  assert.equal(verifyWalletChallenge(123 as unknown as string, 'sig', SECRET), null)
  assert.equal(verifyWalletChallenge('not-a-jwt', 'not-a-signature', SECRET), null)
})

test('rejection: a well-formed but foreign JWT (wrong typ) does not verify', () => {
  const foreignToken = jwt.sign({ typ: 'something-else', addr: '0xabc', nonce: 'n' }, SECRET, { expiresIn: 60 })
  assert.equal(verifyWalletChallenge(foreignToken, 'anysignature', SECRET), null)
})
