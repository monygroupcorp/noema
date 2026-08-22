import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MintAdapter, MarketplaceAdapter } from '../../../src/crystal/MintAdapter.js'
import type { PublishArtifact, PublishPolicy } from '../../../src/crystal/PublicationAdapter.js'

// =============================================================================
// MintAdapter / MarketplaceAdapter (#5) — freeze a drop's canon into a
// deterministic, content-addressed handle. Mint is permanent (no retract);
// a marketplace listing is revocable.
// =============================================================================

const MANIFEST = { provenanceHash: 'sha256:abc123', numerus: 100, nomen: 'My Drop' }
const artifact = (output: unknown = MANIFEST, editioId = 'ed-1'): PublishArtifact =>
  ({ ref: { kind: 'collectio', id: 'col-1' }, output: output as Record<string, unknown>, editioId })
const policy = (owners?: PublishPolicy['owners']): PublishPolicy =>
  ({ visibility: 'marketplace', custody: 'ours', ...(owners ? { owners } : {}) })

test('MintAdapter: freezes a collectio into a deterministic mint reference', async () => {
  const mint = new MintAdapter()
  const a = await mint.publish(artifact(), policy())
  const b = await mint.publish(artifact(), policy())
  assert.equal(a.externalRef, b.externalRef, 'same canon → same handle (the freeze is deterministic)')
  assert.match(a.externalRef, /^mint:evm:[0-9a-f]{64}$/)
})

test('MintAdapter: the ownership split is part of the frozen canon', async () => {
  const mint = new MintAdapter()
  const bare = (await mint.publish(artifact(), policy())).externalRef
  const split = (await mint.publish(artifact(), policy([{ animaId: 'a', weight: 0.6 }, { animaId: 'b', weight: 0.4 }]))).externalRef
  assert.notEqual(bare, split, 'a different owners[] split yields a different freeze digest')
})

test('MintAdapter: owners order does not change the digest (a split is a set)', async () => {
  const mint = new MintAdapter()
  const ab = await mint.publish(artifact(), policy([{ animaId: 'a', weight: 0.6 }, { animaId: 'b', weight: 0.4 }]))
  const ba = await mint.publish(artifact(), policy([{ animaId: 'b', weight: 0.4 }, { animaId: 'a', weight: 0.6 }]))
  assert.equal(ab.externalRef, ba.externalRef)
})

test('MintAdapter: a different provenance or size changes the freeze', async () => {
  const mint = new MintAdapter()
  const base = (await mint.publish(artifact(), policy())).externalRef
  const reHash = (await mint.publish(artifact({ ...MANIFEST, provenanceHash: 'sha256:def' }), policy())).externalRef
  const reSize = (await mint.publish(artifact({ ...MANIFEST, numerus: 50 }), policy())).externalRef
  assert.notEqual(base, reHash)
  assert.notEqual(base, reSize)
})

test('MintAdapter: chain is configurable and appears in the handle', async () => {
  const mint = new MintAdapter({ chain: 'base' })
  assert.match((await mint.publish(artifact(), policy())).externalRef, /^mint:base:/)
})

test('MintAdapter: is permanent — it exposes no retract', () => {
  assert.equal(typeof (new MintAdapter() as { retract?: unknown }).retract, 'undefined')
})

test('MintAdapter: rejects an artifact with no frozen canon', async () => {
  const mint = new MintAdapter()
  await assert.rejects(() => mint.publish(artifact({ nomen: 'no provenance' }), policy()), /no frozen canon/)
})

test('MarketplaceAdapter: lists under a stable per-publication handle', async () => {
  const market = new MarketplaceAdapter({ base: 'https://noema.art/market/' })
  const { externalRef } = await market.publish(artifact(), policy())
  assert.equal(externalRef, 'https://noema.art/market/listing/ed-1', 'keyed by editioId, trailing slash trimmed')
})

test('MarketplaceAdapter: is revocable — retract exists and is a no-op', async () => {
  const market = new MarketplaceAdapter({ base: 'https://noema.art/market' })
  assert.equal(typeof market.retract, 'function')
  // `MarketplaceAdapter.retract` takes no argument (the listing handle is derived from the
  // publication id it minted), so the optional-interface parameter is not passed here.
  await market.retract!()
})

test('MarketplaceAdapter: key is configurable (other venues = config, not new classes)', async () => {
  const market = new MarketplaceAdapter({ key: 'opensea', base: 'https://opensea.io/x' })
  assert.equal(market.key, 'opensea')
})
