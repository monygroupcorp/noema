import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Compiler } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import { MemoryFundamentorum } from '../../../src/crystal/MemoryFundamentorum.js'
import type { Fundamentum } from '../../../src/types/fundamentum.js'
import type { Essentia } from '../../../src/types/essendi.js'

// =============================================================================
// The i2i image-input primitive (Compiler half). An image/video/audio-typed,
// slot-mapped aditus is a FILE: the graph's LoadImage node must carry a filename,
// and the runner is told the URL to fetch into that filename. Proven hermetically
// here; the runner-side download (comfyrunner.py) needs a real pod.
// =============================================================================

const dir = mkdtempSync(path.join(tmpdir(), 'wf-media-'))
writeFileSync(path.join(dir, 'upscale-test-v1.json'), JSON.stringify({
  templateId: 'upscale-test',
  version: '1',
  inputTemplate: {
    '1': { class_type: 'LoadImage', inputs: { image: 'PLACEHOLDER' } },
    '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'out' } },
  },
  slotMap: { '/1/inputs/image': 'image' },
}))

const FUND: Fundamentum = {
  id: 'test-comfyui', nomen: 'test', versio: '1.0.0', contentHash: '',
  imageId: 'runpod/pytorch', imageVersion: 'x', runtime: 'ComfyUI',
  intellae: [], vramGb: 8, canonica: true, natum: new Date(), mutatum: new Date(),
}
const ESS: Essentia = {
  id: 'upscale-test', nomen: 'test', genus: 'atomicus', versio: '1.0.0', contentHash: '',
  ministerium: 'runpod', canonica: true, categoria: 'image',
  fundamentumId: 'test-comfyui', fundamentumVersio: '1.0.0',
  aditus: { image: { type: 'image', required: true } },
  exitus: { image: { type: 'image' } },
  workflowTemplate: 'upscale-test', workflowTemplateVersion: '1',
  natum: new Date(), mutatum: new Date(),
}

const makeCompiler = () =>
  new Compiler(new WorkflowTemplateRegistry(dir), () => 42, undefined, new MemoryFundamentorum([FUND]))

test('i2i: an image-typed slot-mapped aditus → a mediaInputs download + the graph slot carries the filename', async () => {
  const { spec } = await makeCompiler().compile(ESS, { image: 'https://r2.example/cat.png?sig=abc' })

  assert.ok(spec.mediaInputs, 'spec carries mediaInputs')
  assert.equal(spec.mediaInputs!.length, 1)
  const mi = spec.mediaInputs![0]
  assert.equal(mi.url, 'https://r2.example/cat.png?sig=abc', 'the full URL is handed to the runner')
  assert.match(mi.destFilename, /^noema_image_[0-9a-f]{16}\.png$/, 'deterministic filename, png ext from the URL path')

  // The graph's LoadImage slot now carries the FILENAME, not the URL.
  const loadImage = spec.workflow.inputTemplate['1'] as { inputs: Record<string, unknown> }
  assert.equal(loadImage.inputs.image, mi.destFilename, 'LoadImage.image = destFilename (not the URL)')
})

test('i2i: destFilename is stable across re-compiles regardless of presign query params', async () => {
  const a = await makeCompiler().compile(ESS, { image: 'https://r2.example/cat.png?sig=AAA' })
  const b = await makeCompiler().compile(ESS, { image: 'https://r2.example/cat.png?sig=BBB' })
  assert.equal(
    a.spec.mediaInputs![0].destFilename,
    b.spec.mediaInputs![0].destFilename,
    'query stripped before hashing → stable content-address (hash-stable spec)',
  )
})
