import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { Compiler } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import { MemoryFundamentorum } from '../../../src/crystal/MemoryFundamentorum.js'
import { CANONICAL_FUNDAMENTA } from '../../../src/crystal/seeds/fundamenta.js'
import { CANONICAL_ESSENTIAE } from '../../../src/crystal/seeds/essentiae.js'

// End-to-end proof that the REAL landed `upscale` flow + the i2i image-input primitive
// integrate: an image input compiles to a runner download, the graph's LoadImage node
// carries the filename, and the 4x-UltraSharp weight resolves into the manifest.
const WORKFLOWS = path.join(process.cwd(), 'src', 'crystal', 'workflows')

test('real upscale flow: image → mediaInputs + LoadImage filename + upscale model in spec.models', async () => {
  const upscale = CANONICAL_ESSENTIAE.find(e => e.id === 'upscale')
  assert.ok(upscale, 'upscale essentia is registered in CANONICAL_ESSENTIAE')

  const compiler = new Compiler(
    new WorkflowTemplateRegistry(WORKFLOWS),
    () => 42,
    undefined,
    new MemoryFundamentorum(CANONICAL_FUNDAMENTA),
  )
  const { spec } = await compiler.compile(upscale!, { image: 'https://r2.example/cat.png' })

  // i2i: the image input became a runner download, and the LoadImage slot carries the filename.
  assert.equal(spec.mediaInputs?.length, 1, 'exactly one media input')
  const mi = spec.mediaInputs![0]
  assert.equal(mi.url, 'https://r2.example/cat.png', 'runner is told the source URL')
  const loadImage = spec.workflow.inputTemplate['10'] as { inputs: Record<string, unknown> }
  assert.equal(loadImage.inputs.image, mi.destFilename, 'LoadImage.image = the downloaded filename, not the URL')

  // The 4x-UltraSharp weight resolved into the manifest (fundament weight + template url/dest fallback).
  const upModel = spec.models.find(m => m.role === 'upscale_model')
  assert.ok(upModel, 'upscale model present in spec.models')
  assert.match(upModel!.dest, /4x-UltraSharp\.pth$/, 'resolves to the upscale_models dest')
})
