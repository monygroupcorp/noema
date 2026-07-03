// BYO-secrets Phase C (C2): a PRIVATE import from a gated origin (Civitai/HF) has its download
// url rewritten to OUR weight-proxy and is flagged `gated`, so the pod never sees the origin token.
// Hermetic — DB-free Intellarum + the real sd15 template.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import { ESSENTIA_RUNMAKE_SD15 } from '../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_FUNDAMENTA } from '../../../src/crystal/seeds/fundamenta.js'
import { MemoryFundamentorum } from '../../../src/crystal/MemoryFundamentorum.js'
import type { Intellarum, Intella, Intellae } from '../../../src/types/intelligendi.js'
import type { ModelRef } from '../../../src/types/actum.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_WORKFLOWS = path.join(__dirname, '../../../src/crystal/workflows')
const FUNDS = new MemoryFundamentorum(CANONICAL_FUNDAMENTA)
const PROXY = 'https://api.noema.art'
const OWNER = 'anima:owner-1'

const SD15_BASE = {
  id: 'intella.sd15-v1-5', nomen: 'sd15 base', genus: 'model' as const, architectura: 'unet' as const,
  familia: 'sd15', parametri: 0,
  sources: [{ provenance: 'huggingface' as const, uri: 'https://example.com/sd15.safetensors' }],
  dest: 'checkpoints/v1-5-pruned-emaonly.safetensors', sizeGb: 1, versio: '1.0.0', canonica: true, natum: new Date(),
} as Intella

/** A private lora whose origin host we control via `originUri`. */
function intellarumWith(originUri: string, over: Partial<Intella> = {}): Intellarum {
  const priv = {
    id: 'intella.private-lora', nomen: 'secret', genus: 'lora' as const, architectura: 'lora' as const,
    familia: 'sd15', parametri: 0,
    sources: [{ provenance: 'civitai' as const, uri: originUri }],
    dest: 'models/loras/secret.safetensors', sizeGb: 0.1, versio: '1.0.0', canonica: false,
    access: 'private' as const, ownerKey: OWNER, natum: new Date(), ...over,
  } as Intella
  return {
    async find(id: string) { return id === SD15_BASE.id ? SD15_BASE : id === priv.id ? priv : null },
    async list() { return [priv] },
    async canonical() { return [] },
    async findByTrigger() { return [] },
    async triggerMap(): Promise<Map<string, Intellae>> { return new Map() },
  }
}

const compilerWith = (i: Intellarum, proxyBase?: string) =>
  new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, i, FUNDS, proxyBase)
const PIN: ModelRef[] = [{ role: 'lora', id: 'intella.private-lora', dest: 'models/loras/secret.safetensors' }]
const modelOf = (spec: { models: Array<{ id: string; url: string; gated?: boolean }> }) =>
  spec.models.find(m => m.id === 'intella.private-lora')!

test('a private Civitai-origin import is rewritten to the proxy and flagged gated', async () => {
  const compiler = compilerWith(intellarumWith('https://civitai.com/api/download/models/123'), PROXY)
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' }, { pinnedModels: PIN, ownerKey: OWNER })
  const m = modelOf(spec)
  assert.equal(m.url, 'https://api.noema.art/internal/weights/intella.private-lora')
  assert.equal(m.gated, true)
})

test('a private HuggingFace-origin import is rewritten too', async () => {
  const compiler = compilerWith(intellarumWith('https://huggingface.co/foo/bar/resolve/main/x.safetensors'), PROXY)
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' }, { pinnedModels: PIN, ownerKey: OWNER })
  assert.equal(modelOf(spec).gated, true)
})

test('NO proxy configured → no rewrite (pre-Phase-C status quo): keeps origin url, no gated flag', async () => {
  const compiler = compilerWith(intellarumWith('https://civitai.com/api/download/models/123')) // proxyBase omitted
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' }, { pinnedModels: PIN, ownerKey: OWNER })
  const m = modelOf(spec)
  assert.equal(m.url, 'https://civitai.com/api/download/models/123')
  assert.equal(m.gated, undefined)
})

test('a private import from a NON-gated origin (our bucket) is not proxied — no BYO token needed', async () => {
  const compiler = compilerWith(
    intellarumWith('https://models.miladystation2.net/loras/secret.safetensors'), PROXY)
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' }, { pinnedModels: PIN, ownerKey: OWNER })
  const m = modelOf(spec)
  assert.equal(m.url, 'https://models.miladystation2.net/loras/secret.safetensors')
  assert.equal(m.gated, undefined)
})

test('a PUBLIC model from a gated host is NOT proxied (public weights need no token)', async () => {
  const compiler = compilerWith(
    intellarumWith('https://civitai.com/api/download/models/123', { access: 'public' }), PROXY)
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' }, { pinnedModels: PIN })
  const m = modelOf(spec)
  assert.equal(m.url, 'https://civitai.com/api/download/models/123')
  assert.equal(m.gated, undefined)
})

test('the proxy base trailing slash is normalized', async () => {
  const compiler = compilerWith(intellarumWith('https://civitai.com/api/download/models/123'), 'https://api.noema.art/')
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' }, { pinnedModels: PIN, ownerKey: OWNER })
  assert.equal(modelOf(spec).url, 'https://api.noema.art/internal/weights/intella.private-lora')
})
