import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler, isInferenceSpec, isScriptSpec, type InferenceCompiledSpec, type ScriptCompiledSpec } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import {
  ESSENTIA_QWEN3_VL, ESSENTIA_QWEN3_VL_CAPTION, ESSENTIA_MOSS_MUSIC, ESSENTIA_SHOTVL, ESSENTIA_HEARTMULA, ESSENTIA_HUNYUAN3D,
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
  assert.equal((spec as unknown as Record<string, unknown>).workflow, undefined, 'no ComfyUI graph on an LLM spec')
  assert.equal((spec as unknown as Record<string, unknown>).seed, undefined, 'no image seed on an LLM spec')
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
  // An essentia whose inferentia carries no systemPrompt (Qwen3-VL now bakes one).
  const essentia: Essentia = { ...ESSENTIA_QWEN3_VL, inferentia: { genParams: {} } }
  const { spec } = await makeCompiler().compile(essentia, { prompt: 'hi' })
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

// ── python-modelcard: HeartMuLa compiles to a script spec ─────────────────────

test('HeartMuLa compiles to a ScriptCompiledSpec (CLI args + file inputs)', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_HEARTMULA, {
    lyrics: '[Verse]\na song about foxes', tags: 'piano,happy', temperature: 0.8,
  })
  assert.ok(isScriptSpec(spec as never), 'expected a ScriptCompiledSpec')
  const s = (spec as ScriptCompiledSpec).script
  assert.equal(s.repo, 'https://github.com/HeartMuLa/heartlib')
  assert.equal(s.outputKind, 'audio')
  // fixed args present
  assert.ok(s.args.includes('--model_path=./ckpt'))
  // user knob resolved as a flag+value
  const ti = s.args.indexOf('--temperature')
  assert.ok(ti >= 0 && s.args[ti + 1] === '0.8')
  // omitted knob falls back to the aditus default (max_audio_length_ms default 240000)
  const mi = s.args.indexOf('--max_audio_length_ms')
  assert.ok(mi >= 0 && s.args[mi + 1] === '240000')
  // lyrics/tags written to files (not args)
  assert.equal(s.fileInputs?.['assets/lyrics.txt'], '[Verse]\na song about foxes')
  assert.equal(s.fileInputs?.['assets/tags.txt'], 'piano,happy')
  assert.equal(s.fileInputs?.['assets/lyrics.txt'] !== undefined, true)
  assert.ok(!s.args.includes('--lyrics'), 'lyrics is a file input, not a flag')
  // the 3 ckpt weights are in the manifest with their HF repos
  assert.equal(s.repo && (spec as ScriptCompiledSpec).models.length, 3)
  assert.ok((spec as ScriptCompiledSpec).models.every(m => (m as { repo?: string }).repo))
})

test('Hunyuan3D compiles: 3d categoria, install cmd, wrapper fixedFile, image→flag', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_HUNYUAN3D, { image: 'https://x/cat.png' })
  assert.ok(isScriptSpec(spec as never))
  const s = (spec as ScriptCompiledSpec).script
  assert.ok(s.install?.includes('hy3dshape/requirements.txt'), 'shape-only install, not the default -e .')
  assert.equal(s.outputKind, '3d')
  // image (a uri) becomes a CLI flag
  const ii = s.args.indexOf('--image')
  assert.ok(ii >= 0 && s.args[ii + 1] === 'https://x/cat.png')
  // the wrapper script is dropped into the repo (no-CLI repo)
  assert.ok(s.fileInputs?.['run_shape.py']?.includes('Hunyuan3DDiTFlowMatchingPipeline'))
})

// ── Slice D: the caption modus compiles to a complete, runnable inference spec ──

test('caption modus (image-only) compiles to a full vLLM spec: persona + baked instruction + image', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_QWEN3_VL_CAPTION, { image: 'r2://pic.png' })
  const inf = asInference(spec)

  assert.equal(inf.runtime, 'vLLM')
  // the captioner persona (system turn) + the baked instruction (user turn, via the
  // prompt-Porta praefixum — woven even with no typed prompt) — so it runs image-only.
  assert.match(inf.inference.systemPrompt ?? '', /expert image captioner/)
  assert.equal(inf.inference.prompt, 'Describe this image in one dense caption — subject, attributes, style, and composition.')
  assert.deepEqual(inf.inference.media, [{ type: 'image', ref: 'r2://pic.png' }])
  // baseline genParams under the aditus defaults; the LM weight + HF repo for download.
  assert.equal(inf.inference.genParams.top_p, 0.9)
  assert.equal(inf.inference.genParams.repeat_penalty, 1.05)
  assert.equal(inf.inference.genParams.max_tokens, 256)
  assert.equal(inf.inference.genParams.temperature, 0.3)
  const lm = inf.models.find(m => m.role === 'lm')
  assert.equal(lm!.id, 'intella.qwen3-vl-8b')
  assert.equal((lm as { repo?: string }).repo, 'org/intella.qwen3-vl-8b')
})

test('caption modus: a typed prompt is woven AFTER the baked instruction', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_QWEN3_VL_CAPTION, { image: 'r2://pic.png', prompt: 'focus on the clothing' })
  assert.equal(
    asInference(spec).inference.prompt,
    'Describe this image in one dense caption — subject, attributes, style, and composition., focus on the clothing',
  )
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
