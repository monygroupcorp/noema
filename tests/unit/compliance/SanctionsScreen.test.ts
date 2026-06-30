import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeBlocklistScreen, permissiveSanctionsScreen } from '../../../src/compliance/SanctionsScreen.js'

const CHECKSUMMED = '0xAbC0000000000000000000000000000000000123'
const LOWER = CHECKSUMMED.toLowerCase()

test('makeBlocklistScreen blocks a listed address regardless of case', async () => {
  const screen = makeBlocklistScreen([CHECKSUMMED])
  // list stored checksummed, queried lowercase
  const v1 = await screen.screen(LOWER)
  assert.equal(v1.ok, false)
  // list stored lowercase, queried checksummed
  const screen2 = makeBlocklistScreen([LOWER])
  const v2 = await screen2.screen(CHECKSUMMED)
  assert.equal(v2.ok, false)
})

test('makeBlocklistScreen clears an unlisted address', async () => {
  const screen = makeBlocklistScreen([CHECKSUMMED])
  const v = await screen.screen('0x9999999999999999999999999999999999999999')
  assert.equal(v.ok, true)
})

test('makeBlocklistScreen ignores blank entries and trims', async () => {
  const screen = makeBlocklistScreen(['', '  ', `  ${CHECKSUMMED}  `])
  const blocked = await screen.screen(LOWER)
  assert.equal(blocked.ok, false)
  const clear = await screen.screen('')
  assert.equal(clear.ok, true)  // empty query is not on the list
})

test('blocked verdict carries a reason naming the address', async () => {
  const screen = makeBlocklistScreen([CHECKSUMMED])
  const v = await screen.screen(LOWER)
  assert.equal(v.ok, false)
  if (!v.ok) assert.match(v.reason, new RegExp(LOWER))
})

test('permissiveSanctionsScreen clears everything', async () => {
  const v = await permissiveSanctionsScreen.screen(LOWER)
  assert.equal(v.ok, true)
})
