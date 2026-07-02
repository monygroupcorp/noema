import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveAgentWorkspace } from '../../../src/crystal/deriveAgentWorkspace.js'
import { CAMEL_TEMPLATE_MODUS } from '../../../src/crystal/seeds/camel.js'

// The §5 workspace-clone invariants, expressed against the crystal compositus model:
//   • private to the agent (canonica:false, owner={animaId}), linked via fonte
//   • the NFT image is baked into the target aditus port as a default…
//   • …and that port is no longer required (the caster is never asked for it)
//   • the prompt stays open (a fresh required input)
//   • $NFT_* placeholders substitute; the content hash re-seals

const NFT_URL = 'https://r2.example/agent-nft/camel42.png'

function derive(over: Partial<Parameters<typeof deriveAgentWorkspace>[1]> = {}) {
  return deriveAgentWorkspace(CAMEL_TEMPLATE_MODUS, {
    slug: 'agent-ws-camel42',
    name: 'Camel #42',
    animaId: 'anima-agent',
    nft: { imageInputKey: 'input_second_image', imageUrl: NFT_URL },
    ...over,
  })
}

test('bakes the NFT image into the target aditus port as a non-required default', () => {
  const ws = derive()
  const port = ws.aditus.input_second_image
  assert.equal(port.default, NFT_URL, 'NFT url baked as the port default')
  assert.equal(port.required, false, 'baked port is no longer a required (exposed) input')
})

test('leaves the prompt an open required input', () => {
  const ws = derive()
  assert.equal(ws.aditus.prompt.required, true)
  assert.equal(ws.aditus.prompt.default, undefined)
})

test('is private to the agent and linked to the template via fonte', () => {
  const ws = derive()
  assert.equal(ws.canonica, false)
  assert.deepEqual(ws.auctor, { animaId: 'anima-agent' })
  assert.equal(ws.fonte, CAMEL_TEMPLATE_MODUS.id)
  assert.equal(ws.id, 'agent-ws-camel42')
  assert.equal(ws.genus, 'compositus')
})

test('re-seals a non-empty content hash distinct from the template', () => {
  const ws = derive()
  assert.ok(ws.contentHash.length > 0)
  assert.notEqual(ws.contentHash, CAMEL_TEMPLATE_MODUS.contentHash)
})

test('substitutes $NFT_* placeholders across string fields', () => {
  const ws = derive({
    name: '$NFT_NAME workspace',
    placeholders: { '$NFT_NAME': 'Sir Camel', '$NFT_IMAGE': NFT_URL, '$NFT_TOKEN_ID': '42', '$NFT_DESCRIPTION': '' },
  })
  assert.equal(ws.nomen, 'Sir Camel workspace', 'placeholder in the display name substituted')
  assert.ok(!JSON.stringify(ws).includes('$NFT_'), 'no unsubstituted $NFT_* tokens remain')
})

test('preserves Date-typed fields through $NFT_* substitution (no JSON-flatten to string)', () => {
  const ws = derive({ placeholders: { '$NFT_NAME': 'Sir Camel', '$NFT_IMAGE': NFT_URL } })
  assert.ok(ws.natum instanceof Date, 'natum stays a Date, not an ISO string')
  assert.ok(ws.mutatum instanceof Date, 'mutatum stays a Date')
})

test('does not mutate the shared template modus', () => {
  const before = JSON.stringify(CAMEL_TEMPLATE_MODUS)
  derive()
  assert.equal(JSON.stringify(CAMEL_TEMPLATE_MODUS), before)
})

test('throws if the template has no port to bake the NFT image into', () => {
  assert.throws(
    () => derive({ nft: { imageInputKey: 'nonexistent_port', imageUrl: NFT_URL } }),
    (err: unknown) => (err as { code?: string }).code === 'TEMPLATE_SLOT_MISSING',
  )
})
