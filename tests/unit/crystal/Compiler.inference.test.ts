import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler, isInferenceSpec, type InferenceCompiledSpec } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import {
  ESSENTIA_QWEN3_VL, ESSENTIA_MOSS_MUSIC, ESSENTIA_SHOTVL,
} from '../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_FUNDAMENTA, FUNDAMENTUM_QWEN_VL_VLLM } from '../../../src/crystal/seeds/fundamenta.js'
import { MemoryFundamentorum } from '../../../src/crystal/MemoryFundamentorum.js'
import type { Essentia } from '../../../src/types/essendi.js'
import type { Intellarum, Intella } from '../../../src/types/intelligendi.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_WORKFLOWS = path.join(__dirname, '../../../src/crystal/workflows')

const FUNDS = new MemoryFundamentorum(CANONICAL_FUNDAMENTA)

/** DB-free Intellarum resolving the 3 understanding-track LMs (whatever id is asked). */
function makeLmIntellarum(): Intellarum {
  const lm = (id: string): Intella => ({
    id, nomen: id, genus: 'model', architectura: 'qwen-vl', parametri: 8e9,
    sources: [{ provenance: 'huggingface', uri: `https://huggingface.co/org/${id}`, meta: { repo: `org/${id}` } }],
    dest: `transformers/${id}`, sizeGb: 16, versio: '1.0.0', canonica: true, natum: new Date(),
  } as Intella)
  return {
    async find(id: string) { return lm(id) },
    async list() { return [] },
    async canonical() { return [] },
    async findByTrigger() { return [] },
    async triggerMap() { return new Map() },
  }
}

function makeCompiler(intellarum: Intellarum = makeLmIntellarum(), funds = FUNDS) {
  return new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, intellarum, funds)
}

/** Narrow + assert the spec is an inference spec, returning it typed. */
function asInference(spec: unknown): InferenceCompiledSpec {
  assert.ok(isInferenceSpec(spec as never), 'expected an InferenceCompiledSpec (has .inference)')
  return spec as InferenceCompiledSpec
}

// ── shape: vLLM runtime produces an inference spec, not a graph ────────────────

test('compile(Qwen3-VL) produces an inference spec (no workflow, runtime vLLM)', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_QWEN3_VL, { prompt: 'describe this' })
  const inf = asInference(spec)
  assert.equal(inf.runtime, 'vLLM')
  assert.equal((spec as Record<string, unknown>).workflow, undefined, 'no ComfyUI graph on an LLM spec')
  assert.equal((spec as Record<string, unknown>).seed, undefined, 'no image seed on an LLM spec')
  assert.equal(inf.inference.prompt, 'describe this')
})

test('compile(Qwen3-VL) includes the LM in spec.models with its HF repo id', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_QWEN3_VL, { prompt: 'hi' })
  const lm = asInference(spec).models.find(m => m.role === 'lm')
  assert.ok(lm, 'expected the lm weight in spec.models')
  assert.equal(lm!.id, 'intella.qwen3-vl-8b')
  // repo carried from the Intella's sources[0].meta.repo — the vLLM executor needs it
  // to `huggingface-cli download <repo>` (url/dest alone don't address a whole repo).
  assert.equal((lm as { repo?: string }).repo, 'org/intella.qwen3-vl-8b')
})

// ── genParams: defaults, user override, flow baseline ─────────────────────────

test('genParams: aditus int/float defaults flow into genParams', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_QWEN3_VL, { prompt: 'hi' })
  const { genParams } = asInference(spec).inference
  assert.equal(genParams.max_tokens, 1024)   // aditus default
  assert.equal(genParams.temperature, 0.7)   // aditus default
})

test('genParams: an explicit user knob wins over the default', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_QWEN3_VL, { prompt: 'hi', temperature: 0.1, max_tokens: 64 })
  const { genParams } = asInference(spec).inference
  assert.equal(genParams.temperature, 0.1)
  assert.equal(genParams.max_tokens, 64)
})

test('genParams: flow inferentia.genParams provides a baseline under the aditus knobs', async () => {
  const essentia: Essentia = {
    ...ESSENTIA_QWEN3_VL,
    inferentia: { genParams: { top_p: 0.9, temperature: 0.99 } },
  }
  const { spec } = await makeCompiler().compile(essentia, { prompt: 'hi' })
  const { genParams } = asInference(spec).inference
  assert.equal(genParams.top_p, 0.9, 'flow-only param passes through')
  assert.equal(genParams.temperature, 0.7, 'aditus default (0.7) overrides the flow baseline (0.99)')
})

// ── systemPrompt (the inferentia form half) ───────────────────────────────────

test('inferentia.systemPrompt is carried onto the inference spec', async () => {
  const essentia: Essentia = {
    ...ESSENTIA_SHOTVL,
    inferentia: { systemPrompt: 'You are a cinematography expert.' },
  }
  const { spec } = await makeCompiler().compile(essentia, { prompt: 'analyze the framing' })
  assert.equal(asInference(spec).inference.systemPrompt, 'You are a cinematography expert.')
})

test('MOSS-Music compiles via the sglang substrate (custom-arch runtime)', async () => {
  // MOSS points at the moss-sglang fundamentum (runtime 'sglang') — vLLM can't serve its custom
  // arch, SGLang can (trust_remote_code). The 'sglang' runtime must route to the inference path.
  const { spec } = await makeCompiler().compile(ESSENTIA_MOSS_MUSIC, { audio: 'r2://song.mp3', prompt: 'transcribe' })
  const inf = asInference(spec)
  assert.equal(inf.runtime, 'sglang')
  assert.deepEqual(inf.inference.media, [{ type: 'audio', ref: 'r2://song.mp3' }])
})

test('no systemPrompt → field omitted', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_QWEN3_VL, { prompt: 'hi' })
  assert.equal('systemPrompt' in asInference(spec).inference, false)
})

// ── media inputs: image / audio / video ports collected by type ───────────────

test('media: an image input becomes a media entry; absent → omitted', async () => {
  const withImg = await makeCompiler().compile(ESSENTIA_QWEN3_VL, { prompt: 'what is this', image: 'r2://pic.png' })
  assert.deepEqual(asInference(withImg.spec).inference.media, [{ type: 'image', ref: 'r2://pic.png' }])

  const noImg = await makeCompiler().compile(ESSENTIA_QWEN3_VL, { prompt: 'hi' })
  assert.equal('media' in asInference(noImg.spec).inference, false, 'no media → field omitted')
})

test('media: MOSS audio and ShotVL video map to their port types', async () => {
  const moss = await makeCompiler().compile(ESSENTIA_MOSS_MUSIC, { audio: 'r2://song.mp3', prompt: 'transcribe' })
  assert.deepEqual(asInference(moss.spec).inference.media, [{ type: 'audio', ref: 'r2://song.mp3' }])

  const shot = await makeCompiler().compile(ESSENTIA_SHOTVL, { prompt: 'shot size?', video: 'r2://clip.mp4' })
  assert.deepEqual(asInference(shot.spec).inference.media, [{ type: 'video', ref: 'r2://clip.mp4' }])
})

// ── affix weave works in the inference path too ───────────────────────────────

test('weave: a prompt suffixum is woven into the inference prompt', async () => {
  const essentia: Essentia = {
    ...ESSENTIA_QWEN3_VL,
    aditus: { ...ESSENTIA_QWEN3_VL.aditus, prompt: { ...ESSENTIA_QWEN3_VL.aditus.prompt, suffixum: 'be concise' } },
  }
  const { spec } = await makeCompiler().compile(essentia, { prompt: 'explain quantum tunneling' })
  assert.equal(asInference(spec).inference.prompt, 'explain quantum tunneling, be concise')
})

// ── enforcement: unknown runtime is a hard error ──────────────────────────────

test('an unknown runtime throws UNKNOWN_RUNTIME (no silent ComfyUI fallback)', async () => {
  const bogusFund = { ...FUNDAMENTUM_QWEN_VL_VLLM, id: 'bogus-fund', runtime: 'magic-runtime' }
  const compiler = makeCompiler(makeLmIntellarum(), new MemoryFundamentorum([bogusFund]))
  const essentia: Essentia = { ...ESSENTIA_QWEN3_VL, fundamentumId: 'bogus-fund' }
  await assert.rejects(
    () => compiler.compile(essentia, { prompt: 'hi' }),
    (err: unknown) => (err as { code?: string }).code === 'UNKNOWN_RUNTIME',
  )
})

// ── determinism: same inputs → same content hash ──────────────────────────────

test('compile is deterministic: identical inputs → identical hash', async () => {
  const a = await makeCompiler().compile(ESSENTIA_QWEN3_VL, { prompt: 'hi', image: 'r2://x.png' })
  const b = await makeCompiler().compile(ESSENTIA_QWEN3_VL, { prompt: 'hi', image: 'r2://x.png' })
  assert.equal(a.hash, b.hash)
  assert.match(a.hash, /^sha256:/)
})
