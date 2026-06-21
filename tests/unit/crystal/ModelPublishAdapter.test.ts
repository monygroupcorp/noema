import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ModelPublishAdapter, huggingFaceRegistry, civitaiRegistry, slugify, type ModelView } from '../../../src/crystal/ModelPublishAdapter.js'

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
