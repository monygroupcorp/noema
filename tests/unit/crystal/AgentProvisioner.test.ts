import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AgentProvisioner, type TreasuryConfig, type ProvisionInput } from '../../../src/crystal/AgentProvisioner.js'
import { MemoryLegatus } from '../../../src/crystal/MemoryLegatus.js'
import { MemorySignorum } from '../../../src/ledger/MemorySignorum.js'
import { MemoryModorum } from '../../../src/execution/MemoryModorum.js'
import { CAMEL_TEMPLATE_MODUS } from '../../../src/crystal/seeds/camel.js'

const TREASURY: TreasuryConfig = {
  treasuryId: 'camelcabal-1',
  animaId: 'camelcabal-1',
  issuerId: 'https://camelcabal.fun',
  templateModusId: CAMEL_TEMPLATE_MODUS.id,
  nftImageInputKey: 'input_second_image',
  starterGrant: 0n,
  status: 'active',
}

function baseInput(over: Partial<ProvisionInput> = {}): ProvisionInput {
  return {
    agentAnimaId: 'anima-agent',
    agentId: 'camel42',
    tokenId: '42',
    ownerAddress: '0x' + 'a'.repeat(40),
    chainId: 1,
    adapter: '0x' + 'b'.repeat(40),
    issuerId: 'https://camelcabal.fun',
    scope: ['generate'],
    nftImageUrl: 'https://r2.example/nft/camel42.png',
    nftName: 'Camel #42',
    ...over,
  }
}

async function harness(treasury: TreasuryConfig = TREASURY, opts: { seedTemplate?: boolean } = {}) {
  const legati = new MemoryLegatus()
  const signorum = new MemorySignorum()
  const modorum = new MemoryModorum()
  if (opts.seedTemplate !== false) await modorum.register(CAMEL_TEMPLATE_MODUS)
  const provisioner = new AgentProvisioner({
    legati,
    signorum,
    modorum,
    treasury: (id) => (id === treasury.treasuryId ? treasury : null),
  })
  return { legati, signorum, modorum, provisioner }
}

test('fresh provision creates a Legatus + registers the workspace + returns 202', async () => {
  const { provisioner, legati, modorum } = await harness()
  const out = await provisioner.provision('camelcabal-1', baseInput())
  assert.ok(out.ok)
  if (!out.ok) return
  assert.equal(out.httpStatus, 202)
  assert.equal(out.legatus.agentId, 'camel42')
  assert.equal(out.legatus.animaId, 'anima-agent')
  assert.equal(out.legatus.status, 'active')
  assert.ok(out.legatus.revokeToken.length > 0)
  assert.ok(out.legatus.workspaceModusId)
  // The workspace was actually registered, NFT-baked + private.
  const ws = await modorum.find(out.legatus.workspaceModusId!)
  assert.ok(ws)
  assert.equal(ws!.canonica, false)
  assert.equal(ws!.aditus.input_second_image.default, 'https://r2.example/nft/camel42.png')
  assert.equal(await legati.findByAgentId('camel42').then(l => l?.id), out.legatus.id)
})

test('idempotent: re-provision same agentId → 200 same account, no second workspace/grant', async () => {
  const { provisioner, modorum } = await harness()
  const first = await provisioner.provision('camelcabal-1', baseInput())
  assert.ok(first.ok)
  const before = (await modorum.list()).length
  const second = await provisioner.provision('camelcabal-1', baseInput())
  assert.ok(second.ok)
  if (!first.ok || !second.ok) return
  assert.equal(second.httpStatus, 200)
  assert.equal(second.legatus.id, first.legatus.id)
  assert.equal(second.grantedPoints, 0n)
  assert.equal((await modorum.list()).length, before, 'no second workspace registered')
})

test('revoked agent → 409 terminal', async () => {
  const { provisioner, legati } = await harness()
  const out = await provisioner.provision('camelcabal-1', baseInput())
  assert.ok(out.ok)
  if (!out.ok) return
  await legati.setStatus(out.legatus.id, 'revoked')
  const retry = await provisioner.provision('camelcabal-1', baseInput())
  assert.equal(retry.ok, false)
  if (retry.ok) return
  assert.equal(retry.httpStatus, 409)
  assert.equal(retry.code, 'AGENT_REVOKED')
})

test('unknown treasury → 404; suspended treasury → 403', async () => {
  const { provisioner } = await harness()
  const notFound = await provisioner.provision('nope', baseInput())
  assert.equal(notFound.ok, false)
  if (!notFound.ok) assert.equal(notFound.httpStatus, 404)

  const { provisioner: p2 } = await harness({ ...TREASURY, status: 'suspended' })
  const suspended = await p2.provision('camelcabal-1', baseInput())
  assert.equal(suspended.ok, false)
  if (!suspended.ok) assert.equal(suspended.httpStatus, 403)
})

test('missing template → 503 WORKSPACE not created', async () => {
  const { provisioner, legati } = await harness(TREASURY, { seedTemplate: false })
  const out = await provisioner.provision('camelcabal-1', baseInput())
  assert.equal(out.ok, false)
  if (out.ok) return
  assert.equal(out.httpStatus, 503)
  assert.equal(out.code, 'TEMPLATE_NOT_FOUND')
  assert.equal(await legati.findByAgentId('camel42'), null, 'no Legatus created on template failure')
})

test('grant shortfall compensates: Legatus suspended + 402, then resume succeeds after funding', async () => {
  const treasury: TreasuryConfig = { ...TREASURY, starterGrant: 500n }
  const { provisioner, legati, signorum } = await harness(treasury)

  // Treasury has nothing → the starter-grant transfer fails.
  const out = await provisioner.provision('camelcabal-1', baseInput())
  assert.equal(out.ok, false)
  if (out.ok) return
  assert.equal(out.httpStatus, 402)
  assert.equal(out.code, 'INSUFFICIENT_FUNDS')
  const suspended = await legati.findByAgentId('camel42')
  assert.equal(suspended?.status, 'suspended', 'compensated to a resumable state')

  // Fund the treasury, then re-provision → resumes the grant only → active.
  await signorum.issue({ animaId: 'camelcabal-1', forma: 'minted', valor: 500n, auctor: 'test' })
  const resumed = await provisioner.provision('camelcabal-1', baseInput())
  assert.ok(resumed.ok)
  if (!resumed.ok) return
  assert.equal(resumed.httpStatus, 202)
  assert.equal(resumed.legatus.status, 'active')
  assert.equal(resumed.grantedPoints, 500n)
  // The agent's Anima actually received the grant.
  assert.equal(await signorum.balance({ animaId: 'anima-agent' }), 500n)
  assert.equal(await signorum.balance({ animaId: 'camelcabal-1' }), 0n, 'treasury debited')
})

test('a positive grant transfers treasury→agent on first provision', async () => {
  const treasury: TreasuryConfig = { ...TREASURY, starterGrant: 300n }
  const { provisioner, signorum } = await harness(treasury)
  await signorum.issue({ animaId: 'camelcabal-1', forma: 'minted', valor: 1000n, auctor: 'test' })
  const out = await provisioner.provision('camelcabal-1', baseInput())
  assert.ok(out.ok)
  if (!out.ok) return
  assert.equal(out.grantedPoints, 300n)
  assert.equal(await signorum.balance({ animaId: 'anima-agent' }), 300n)
  assert.equal(await signorum.balance({ animaId: 'camelcabal-1' }), 700n)
})
