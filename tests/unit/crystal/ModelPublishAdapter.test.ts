import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ModelPublishAdapter, huggingFaceRegistry, civitaiRegistry, slugify, type ModelView, type RegistryUploader, type RegistryUploadRequest } from '../../../src/crystal/ModelPublishAdapter.js'

// =============================================================================
// ModelPublishAdapter — registry-parameterized model publishing (HF/Civitai).
// PLACEHOLDER: projects account+slug → model URL; real weight upload deferred.
// =============================================================================

const MODEL: ModelView = {
  nomen: 'My Cool LoRA', genus: 'lora', slug: 'my-cool-lora', trigger: 'mcl', familia: 'flux',
  sources: [{ provenance: 'miladystation', uri: 'https://x/lora.safetensors' }],
}

test('slugify: lowercases and hyphenates to a registry-safe slug', () => {
  assert.equal(slugify('My Cool LoRA!'), 'my-cool-lora')
  assert.equal(slugify('  spaced  out  '), 'spaced-out')
  assert.equal(slugify('@@@'), 'model')
})

test('huggingface: custody ours publishes under our org', async () => {
  const adapter = new ModelPublishAdapter(huggingFaceRegistry('ms2stationthis'))
  assert.equal(adapter.key, 'huggingface')
  const { externalRef } = await adapter.publish({ ref: { kind: 'intella', id: 'i' }, output: MODEL }, { visibility: 'unlisted', custody: 'ours' })
  assert.equal(externalRef, 'https://huggingface.co/ms2stationthis/my-cool-lora')
})

test('huggingface: custody theirs publishes under the BYO account (custodyTarget)', async () => {
  const adapter = new ModelPublishAdapter(huggingFaceRegistry('ms2stationthis'))
  const { externalRef } = await adapter.publish(
    { ref: { kind: 'intella', id: 'i' }, output: MODEL },
    { visibility: 'unlisted', custody: 'theirs', custodyTarget: { account: 'alice' } },
  )
  assert.equal(externalRef, 'https://huggingface.co/alice/my-cool-lora')
})

test('civitai: has no org → custody ours with no BYO account throws', async () => {
  const adapter = new ModelPublishAdapter(civitaiRegistry())
  assert.equal(adapter.key, 'civitai')
  await assert.rejects(
    () => adapter.publish({ ref: { kind: 'intella', id: 'i' }, output: MODEL }, { visibility: 'unlisted', custody: 'ours' }),
    /no target account/,
  )
})

test('civitai: custody theirs publishes under the BYO account', async () => {
  const adapter = new ModelPublishAdapter(civitaiRegistry())
  const { externalRef } = await adapter.publish(
    { ref: { kind: 'intella', id: 'i' }, output: MODEL },
    { visibility: 'unlisted', custody: 'theirs', custodyTarget: { account: 'bob' } },
  )
  assert.equal(externalRef, 'https://civitai.com/user/bob?model=my-cool-lora')
})

test('publish: no model payload throws', async () => {
  const adapter = new ModelPublishAdapter(huggingFaceRegistry('org'))
  await assert.rejects(
    () => adapter.publish({ ref: { kind: 'intella', id: 'i' } }, { visibility: 'unlisted', custody: 'ours' }),
    /no model to publish/,
  )
})

test('retract: resolves (real registry deletion deferred)', async () => {
  const adapter = new ModelPublishAdapter(huggingFaceRegistry('org'))
  await assert.doesNotReject(() => adapter.retract())
})

// ── Pluggable per-platform upload strategy (the anti-overfit seam) ───────────

/** A fake uploader that records its request and returns a known handle. */
function spyUploader(): RegistryUploader & { calls: RegistryUploadRequest[] } {
  const calls: RegistryUploadRequest[] = []
  return { calls, async upload(req) { calls.push(req); return { externalRef: `uploaded://${req.account}/${req.slug}` } } }
}

test('publish: delegates real byte movement to the registry uploader when present', async () => {
  const up = spyUploader()
  const adapter = new ModelPublishAdapter(huggingFaceRegistry('ms2stationthis', up))
  const { externalRef } = await adapter.publish({ ref: { kind: 'intella', id: 'i' }, output: MODEL }, { visibility: 'unlisted', custody: 'ours' })

  assert.equal(externalRef, 'uploaded://ms2stationthis/my-cool-lora', 'handle comes from the uploader, not the projection')
  assert.equal(up.calls.length, 1)
  assert.equal(up.calls[0].account, 'ms2stationthis')
  assert.equal(up.calls[0].slug, 'my-cool-lora')
  assert.equal(up.calls[0].private, false)
  assert.equal(up.calls[0].model.nomen, 'My Cool LoRA')
})

test('publish: threads the BYO account + token to the uploader (custody theirs)', async () => {
  const up = spyUploader()
  const adapter = new ModelPublishAdapter(huggingFaceRegistry('ms2stationthis', up))
  await adapter.publish(
    { ref: { kind: 'intella', id: 'i' }, output: MODEL },
    { visibility: 'private', custody: 'theirs', custodyTarget: { account: 'alice', token: 'hf_secret' } },
  )
  assert.equal(up.calls[0].account, 'alice')
  assert.equal(up.calls[0].token, 'hf_secret')
  assert.equal(up.calls[0].private, true, "visibility 'private' → private repo")
})

test('publish: any platform plugs in identically (civitai via the same seam)', async () => {
  const up = spyUploader()
  const adapter = new ModelPublishAdapter(civitaiRegistry(undefined, up))
  const { externalRef } = await adapter.publish(
    { ref: { kind: 'intella', id: 'i' }, output: MODEL },
    { visibility: 'unlisted', custody: 'theirs', custodyTarget: { account: 'bob' } },
  )
  assert.equal(externalRef, 'uploaded://bob/my-cool-lora', 'no HF-specific path — same delegation for civitai')
})

test('publish: with no uploader, falls back to projection only (no bytes moved)', async () => {
  const adapter = new ModelPublishAdapter(huggingFaceRegistry('ms2stationthis'))
  const { externalRef } = await adapter.publish({ ref: { kind: 'intella', id: 'i' }, output: MODEL }, { visibility: 'unlisted', custody: 'ours' })
  assert.equal(externalRef, 'https://huggingface.co/ms2stationthis/my-cool-lora')
})
