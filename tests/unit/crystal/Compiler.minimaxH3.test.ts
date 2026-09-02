import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import {
  ESSENTIA_MINIMAX_H3_T2V,
  ESSENTIA_MINIMAX_H3_FL2V,
  ESSENTIA_MINIMAX_H3_REF2V,
} from '../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_FUNDAMENTA, FUNDAMENTUM_MINIMAX_H3_COMFYUI } from '../../../src/crystal/seeds/fundamenta.js'
import { MemoryFundamentorum } from '../../../src/crystal/MemoryFundamentorum.js'
import type { Intellarum, Intella } from '../../../src/types/intelligendi.js'
import { asComfyUI } from './Compiler.helpers.js'
import { podDiskGbFor, DEFAULT_POD_DISK_GB, POD_DISK_HEADROOM_GB } from '../../../src/crystal/podDisk.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_WORKFLOWS = path.join(__dirname, '../../../src/crystal/workflows')

const FUNDS = new MemoryFundamentorum(CANONICAL_FUNDAMENTA)

/** DB-free Intellarum resolving the seven MiniMax H3 weights (3 shared + 2 per DiT pair). */
function makeH3Intellarum(): Intellarum {
  const records: Record<string, Intella> = {
    'intella.minimax-h3-fl2va-int8': mk('intella.minimax-h3-fl2va-int8', 'diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors'),
    'intella.minimax-h3-ref2va-int8': mk('intella.minimax-h3-ref2va-int8', 'diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors'),
    'intella.qwen3vl-32b-minimax-h3-int8': mk('intella.qwen3vl-32b-minimax-h3-int8', 'text_encoders/qwen3vl_32b_minimax_h3_int8_convrot.safetensors'),
    'intella.minimax-h3-video-vae': mk('intella.minimax-h3-video-vae', 'vae/minimax_h3_video_vae_fp16.safetensors'),
    'intella.minimax-h3-audio-vae': mk('intella.minimax-h3-audio-vae', 'vae/minimax_h3_audio_vae_fp32.safetensors'),
    'intella.minimax-h3-fl2v-turbo-4step': mk('intella.minimax-h3-fl2v-turbo-4step', 'loras/minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors'),
    'intella.minimax-h3-ref2v-turbo-4step': mk('intella.minimax-h3-ref2v-turbo-4step', 'loras/minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors'),
  }
  return {
    async find(id: string) { return records[id] ?? null },
    async list() { return Object.values(records) },
    async canonical() { return Object.values(records) },
    async findByTrigger() { return [] },
    async triggerMap() { return new Map() },
  }
}

function mk(id: string, dest: string): Intella {
  return {
    id, nomen: id, genus: 'model', architectura: 'dit', parametri: 0,
    sources: [{ provenance: 'huggingface', uri: `https://example.com/${id}.safetensors` }],
    dest, sizeGb: 1, versio: '1.0.0', canonica: true, natum: new Date(),
  } as Intella
}

function makeCompiler() {
  return new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, makeH3Intellarum(), FUNDS)
}

function node(spec: unknown, id: string) {
  return asComfyUI(spec as never).workflow.inputTemplate[id] as { class_type: string; inputs: Record<string, unknown> }
}

test('t2v slots the prompt into the H3 node and wires NEITHER frame port', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_MINIMAX_H3_T2V, { prompt: 'a newsreader at a plain desk' })

  const h3 = node(spec, '8')
  assert.equal(h3.class_type, 'MiniMaxH3ImageToVideo')
  // The prompt enters at the LoRA text extractor and reaches the H3 node with any
  // `<lora:…>` tags stripped — so the model never sees the tag syntax as scene text.
  assert.equal(node(spec, '20').inputs.text, 'a newsreader at a plain desk')
  assert.deepEqual(h3.inputs.prompt, ['20', 0])
  // The whole basis for t2v existing without a t2v checkpoint: both frame ports stay unwired.
  assert.ok(!('first_frame' in h3.inputs), 't2v must not wire first_frame')
  assert.ok(!('last_frame' in h3.inputs), 't2v must not wire last_frame')
  assert.equal(asComfyUI(spec).mediaInputs, undefined, 't2v takes no media inputs')

  assert.deepEqual(spec.models.map(m => m.id).sort(), [
    'intella.minimax-h3-audio-vae',
    'intella.minimax-h3-fl2v-turbo-4step',
    'intella.minimax-h3-fl2va-int8',
    'intella.minimax-h3-video-vae',
    'intella.qwen3vl-32b-minimax-h3-int8',
  ].sort())
})

test('fl2v stages the start frame as a media input and wires it into first_frame', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_MINIMAX_H3_FL2V, {
    prompt: 'she turns to camera', first_frame: 'https://r2.example/still.png',
  })

  const h3 = node(spec, '8')
  assert.deepEqual(h3.inputs.first_frame, ['6', 0], 'first_frame is wired to the LoadImage node')

  const media = asComfyUI(spec).mediaInputs
  assert.ok(media && media.length === 1, 'exactly one media input')
  assert.equal(media[0].url, 'https://r2.example/still.png')
  // The graph value is the on-pod FILENAME, never the URL — ComfyUI's LoadImage reads input/.
  assert.equal(node(spec, '6').inputs.image, media[0].destFilename)
  assert.notEqual(node(spec, '6').inputs.image, 'https://r2.example/still.png')
})

test('ref2v stages BOTH image and audio, and keeps the dotted autogrow links intact', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_MINIMAX_H3_REF2V, {
    prompt: '<Audio 1> is the voice-timbre reference for <Picture 1>. He speaks to camera.',
    ref_image: 'https://r2.example/headshot.png',
    ref_audio: 'https://r2.example/voice.wav',
  })

  const h3 = node(spec, '8')
  assert.equal(h3.class_type, 'MiniMaxH3ReferenceToVideo')
  assert.deepEqual(h3.inputs.prompt, ['20', 0])
  // Autogrow inputs are addressed by DOTTED PATH. A flat `ref_image_0` passes validation and
  // dies at execution, so this assertion is the one that protects the whole flow.
  assert.deepEqual(h3.inputs['ref_images.ref_image_0'], ['img0', 0])
  assert.deepEqual(h3.inputs['ref_audios.ref_audio_0'], ['aud0', 0])
  assert.ok(!('ref_image_0' in h3.inputs), 'the flat autogrow key must never appear')

  const media = asComfyUI(spec).mediaInputs
  assert.ok(media && media.length === 2, 'image and audio both staged')
  assert.equal(node(spec, 'img0').inputs.image, media.find(m => m.url.endsWith('.png'))!.destFilename)
  assert.equal(node(spec, 'aud0').inputs.audio, media.find(m => m.url.endsWith('.wav'))!.destFilename)

  assert.equal(spec.models.find(m => m.id === 'intella.minimax-h3-ref2va-int8')?.dest,
    'diffusion_models/minimax_h3_ref2va_pruned_int8_convrot.safetensors')
})

test('every H3 flow forwards the fundament comfyRef + install onto the spec', async () => {
  for (const essentia of [ESSENTIA_MINIMAX_H3_T2V, ESSENTIA_MINIMAX_H3_FL2V, ESSENTIA_MINIMAX_H3_REF2V]) {
    const { spec } = await makeCompiler().compile(essentia, {
      prompt: 'x', first_frame: 'https://r2.example/a.png',
      ref_image: 'https://r2.example/a.png', ref_audio: 'https://r2.example/a.wav',
    })
    const comfy = asComfyUI(spec) as { comfyRef?: string; install?: string[] }
    // Without this the pod falls back to DEFAULT_COMFYUI_REF (v0.26.0) and comes up with no
    // MiniMax H3 nodes at all — healthy-looking, and unable to run a single one of these flows.
    assert.ok(comfy.comfyRef, `${essentia.id} must carry the pinned ComfyUI ref`)
    assert.ok(comfy.install?.some(c => c.includes('comfy-kitchen')),
      `${essentia.id} must carry the int8-kernel install step`)
  }
})

test('a substrate that declares neither field stays byte-identical (hash stability)', async () => {
  // The same flow on a substrate stripped of both fields: the keys must be ABSENT, not empty.
  // This is what keeps every pre-existing ComfyUI flow's spec — and its content hash — unchanged.
  const bare = {
    ...FUNDAMENTUM_MINIMAX_H3_COMFYUI,
    id: 'bare-fund',
    comfyRef: undefined,
    install: undefined,
  }
  const compiler = new Compiler(
    new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, makeH3Intellarum(),
    new MemoryFundamentorum([bare]),
  )
  const { spec } = await compiler.compile(
    { ...ESSENTIA_MINIMAX_H3_T2V, fundamentumId: 'bare-fund' },
    { prompt: 'x' },
  )
  assert.ok(!('comfyRef' in (spec as object)), 'no comfyRef key when the fundament declares none')
  assert.ok(!('install' in (spec as object)), 'no install key when the fundament declares none')
})

test('user LoRAs stack ON TOP of the baked turbo LoRA, never instead of it', async () => {
  for (const essentia of [ESSENTIA_MINIMAX_H3_T2V, ESSENTIA_MINIMAX_H3_FL2V, ESSENTIA_MINIMAX_H3_REF2V]) {
    const { spec } = await makeCompiler().compile(essentia, {
      prompt: 'a talking head <lora:something:0.8>',
      first_frame: 'https://r2.example/a.png',
      ref_image: 'https://r2.example/a.png', ref_audio: 'https://r2.example/a.wav',
    })

    // node 5 is the 4-step turbo LoRA the graph's `steps: 4` depends on. The user rail
    // (21) takes node 5's OUTPUT as its model, so the turbo LoRA is never displaced.
    const turbo = node(spec, '5')
    assert.equal(turbo.class_type, 'LoraLoaderModelOnly', `${essentia.id}: turbo lora still loaded`)
    const multi = node(spec, '21')
    assert.equal(multi.class_type, 'MultiLoraLoader-70bf3d77')
    assert.deepEqual(multi.inputs.model, ['5', 0], `${essentia.id}: user loras stack on the turbo lora`)
    assert.deepEqual(multi.inputs.text, ['20', 1], 'lora spec comes from extractor output 1')

    // and everything downstream consumes the PATCHED model/clip, not the raw ones
    assert.deepEqual(node(spec, '11').inputs.model, ['21', 0], `${essentia.id}: scheduler on patched model`)
    assert.deepEqual(node(spec, '12').inputs.model, ['21', 0], `${essentia.id}: guider on patched model`)
    assert.deepEqual(node(spec, '8').inputs.clip, ['21', 1], `${essentia.id}: conditioning on patched clip`)
  }
})

test('the LoRA rail is declared, and carries the node pack it needs', async () => {
  for (const essentia of [ESSENTIA_MINIMAX_H3_T2V, ESSENTIA_MINIMAX_H3_FL2V, ESSENTIA_MINIMAX_H3_REF2V]) {
    const { spec } = await makeCompiler().compile(essentia, {
      prompt: 'x', first_frame: 'https://r2.example/a.png',
      ref_image: 'https://r2.example/a.png', ref_audio: 'https://r2.example/a.wav',
    })
    // Without the pack the two rail nodes do not exist on the pod and the whole graph
    // fails to queue — not just the LoRA part.
    const packs = asComfyUI(spec).customNodes ?? []
    assert.ok(packs.some(p => p.url.includes('ComfyUI-Coziness')),
      `${essentia.id} must ship the Coziness pack that provides the rail nodes`)
  }
})

test('the compiled spec asks for a disk that fits 56 GB of weights', async () => {
  const { spec } = await makeCompiler().compile(ESSENTIA_MINIMAX_H3_T2V, { prompt: 'x' })
  const disk = (asComfyUI(spec) as { diskGb?: number }).diskGb
  // The stub Intellarum reports 1 GB per weight, so this asserts the WIRING, not the number:
  // a real manifest is 56 GB and the seed-level guard (podDiskFitsWeights) checks the sizing.
  assert.equal(typeof disk, typeof podDiskGbFor(0) === 'number' ? 'undefined' : 'number',
    'small manifests keep the default and emit nothing')

  // …and with real sizes it must exceed the flat default that broke run 5effbe17.
  const real = podDiskGbFor(56)
  assert.ok(real > DEFAULT_POD_DISK_GB, '56 GB of weights must not ride the 40 GB default')
  assert.ok(real >= 56 + POD_DISK_HEADROOM_GB, 'and must leave working room on top')
})

// ── Timeout budgets (noema-392) ───────────────────────────────────────────────
// `minimax-h3-fl2v` (actum 7d5fd175) died on `job … timed out after 900s waiting for ComfyUI`
// with executionMs 898405 — after the pod, the bootstrap and 56 GB of weights had all been paid
// for. comfyrunner's JOB_TIMEOUT was env-overridable and nothing overrode it. These pin the
// declaration reaching the spec, and the absent-declaration case staying byte-identical.

test('every H3 flow forwards the fundament timeout budgets onto the spec', async () => {
  for (const essentia of [ESSENTIA_MINIMAX_H3_T2V, ESSENTIA_MINIMAX_H3_FL2V, ESSENTIA_MINIMAX_H3_REF2V]) {
    const { spec } = await makeCompiler().compile(essentia, {
      prompt: 'x', first_frame: 'https://r2.example/a.png',
      ref_image: 'https://r2.example/a.png', ref_audio: 'https://r2.example/a.wav',
    })
    const comfy = asComfyUI(spec) as { jobTimeoutMs?: number; readyTimeoutMs?: number }
    assert.equal(comfy.jobTimeoutMs, FUNDAMENTUM_MINIMAX_H3_COMFYUI.jobTimeoutMs,
      `${essentia.id} must carry the substrate job budget`)
    assert.equal(comfy.readyTimeoutMs, FUNDAMENTUM_MINIMAX_H3_COMFYUI.readyTimeoutMs,
      `${essentia.id} must carry the substrate readiness budget`)
  }
})

test('the H3 job budget clears the 900s that killed fl2v, with room for load variance', () => {
  const jobMs = FUNDAMENTUM_MINIMAX_H3_COMFYUI.jobTimeoutMs!
  // The confirmed failure. Anything at or under this ships the same broken run again.
  assert.ok(jobMs > 900_000, 'must exceed the 900s default that fl2v breached')
  // t2v's one measured success was 768s, ~700s of it model load. Two runs cannot bound the tail
  // of that load, so the budget is a MULTIPLE of the measurement, not the measurement plus a
  // little. If this ever drops below 3x, the sizing argument in the fundament no longer holds.
  assert.ok(jobMs >= 3 * 768_000, 'must be at least 3x the one measured successful execution')
  // …and bounded above by the actum's own expirat: PROVISION_BUDGET_MS (45 min) +
  // maxJobSeconds (30 min default) = 75 min of wall clock, against which this run also spends
  // ~226s provisioning and ~713s pulling weights. A job budget past that is reaped mid-run.
  assert.ok(jobMs + 226_000 + 713_000 < 75 * 60_000,
    'provision + download + job must fit inside the actum terminus')
})

test('the H3 readiness budget exceeds the platform default it missed', () => {
  const readyMs = FUNDAMENTUM_MINIMAX_H3_COMFYUI.readyTimeoutMs!
  // Attempt 1 of run 01a7dc6b missed the 5-minute default and cost a whole second pod.
  assert.ok(readyMs > 5 * 60_000, 'must exceed the 5 min default that cost run 01a7dc6b a pod')
  // But not unbounded: a genuinely dead pod still has to be given up on.
  assert.ok(readyMs <= 30 * 60_000, 'a dead pod must still be abandoned inside half an hour')
})

test('a substrate declaring no budgets produces a spec with neither key (hash stability)', async () => {
  // The keys must be ABSENT, not zero, not null. This is what keeps every pre-existing ComfyUI
  // flow's compiled spec — and the content hash stored on its Actum/Deploymentum — unchanged.
  const bare = {
    ...FUNDAMENTUM_MINIMAX_H3_COMFYUI,
    id: 'bare-budget-fund',
    readyTimeoutMs: undefined,
    jobTimeoutMs: undefined,
  }
  const compiler = new Compiler(
    new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, makeH3Intellarum(),
    new MemoryFundamentorum([bare]),
  )
  const { spec, hash } = await compiler.compile(
    { ...ESSENTIA_MINIMAX_H3_T2V, fundamentumId: 'bare-budget-fund' },
    { prompt: 'x' },
  )
  assert.ok(!('readyTimeoutMs' in (spec as object)), 'no readyTimeoutMs key when none is declared')
  assert.ok(!('jobTimeoutMs' in (spec as object)), 'no jobTimeoutMs key when none is declared')

  // And the hash is the hash of that same key-set — recompiling a substrate that declares
  // nothing is stable across this change.
  const again = await compiler.compile(
    { ...ESSENTIA_MINIMAX_H3_T2V, fundamentumId: 'bare-budget-fund' },
    { prompt: 'x' },
  )
  assert.equal(again.hash, hash, 'a substrate declaring no budgets hashes identically')
})

test('a zero or negative budget is treated as no declaration, never as an instant timeout', async () => {
  const typo = { ...FUNDAMENTUM_MINIMAX_H3_COMFYUI, id: 'typo-fund', readyTimeoutMs: 0, jobTimeoutMs: -1 }
  const compiler = new Compiler(
    new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, makeH3Intellarum(),
    new MemoryFundamentorum([typo]),
  )
  const { spec } = await compiler.compile(
    { ...ESSENTIA_MINIMAX_H3_T2V, fundamentumId: 'typo-fund' },
    { prompt: 'x' },
  )
  assert.ok(!('readyTimeoutMs' in (spec as object)), 'a 0 budget must not reach the pod')
  assert.ok(!('jobTimeoutMs' in (spec as object)), 'a negative budget must not reach the pod')
})
