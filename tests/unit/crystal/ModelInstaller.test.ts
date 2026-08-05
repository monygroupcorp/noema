import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ModelInstaller, type ModelInstallClient } from '../../../src/crystal/ModelInstaller.js'
import type { Intellarum } from '../../../src/types/intelligendi.js'
import type { Materia, MateriaStore } from '../../../src/types/materia.js'

const CATALOG: Record<string, { id: string; genus: string; nomen: string; dest: string; sizeGb?: number; sources?: Array<{ uri: string }> }> = {
  'intella.flux':   { id: 'intella.flux',   genus: 'model', nomen: 'FLUX',   dest: 'unet/flux.safetensors',     sizeGb: 24,  sources: [{ uri: 'https://x/flux.safetensors' }] },
  'intella.milady': { id: 'intella.milady', genus: 'lora',  nomen: 'Milady', dest: 'loras/milady.safetensors',  sizeGb: 0.5, sources: [{ uri: 'https://x/milady.safetensors' }] },
}
const fakeIntellarum = { async find(id: string) { return (CATALOG[id] ?? null) as never } } as unknown as Intellarum

function fakeStore() {
  const patches: Array<{ id: string; patch: Partial<Materia> }> = []
  const materiae = { async update(id: string, patch: Partial<Materia>) { patches.push({ id, patch }) } } as unknown as MateriaStore
  return { materiae, patches }
}

test('ModelInstaller resolves refs, installs, and set-unions installedModels', async () => {
  const { materiae, patches } = fakeStore()
  let gotRefs: Array<{ id: string; role: string; url?: string; dest: string; sizeBytes?: number }> = []
  const client: ModelInstallClient = { async installModels(refs) { gotRefs = refs; return { modelsDownloaded: refs.length, modelsReused: 0 } } }
  const installer = new ModelInstaller({ intellarum: fakeIntellarum, materiae, clientFor: () => client })

  const materia = { id: 'mat-1', externusId: 'pod-1', installedModels: ['intella.flux'] } as unknown as Materia
  const { result, installedModels } = await installer.install(materia, ['intella.milady'])

  assert.equal(result.modelsDownloaded, 1, 'one model downloaded')
  assert.deepEqual(gotRefs.map(r => r.id), ['intella.milady'], 'resolved the requested id to a ref')
  assert.equal(gotRefs[0].role, 'lora', 'lora role inferred from genus')
  assert.equal(gotRefs[0].url, 'https://x/milady.safetensors', 'download url from sources[0]')
  assert.equal(gotRefs[0].sizeBytes, 500_000_000, 'sizeGb → sizeBytes')
  assert.deepEqual(installedModels.sort(), ['intella.flux', 'intella.milady'], 'set-union with the prior install')
  assert.deepEqual((patches[0].patch.installedModels ?? []).sort(), ['intella.flux', 'intella.milady'], 'persisted to the Materia')
})

test('ModelInstaller skips unresolvable ids (no ref, no install line)', async () => {
  const { materiae } = fakeStore()
  let called = 0
  const client: ModelInstallClient = { async installModels(refs) { called++; return { modelsDownloaded: refs.length, modelsReused: 0 } } }
  const installer = new ModelInstaller({ intellarum: fakeIntellarum, materiae, clientFor: () => client })

  const { installedModels } = await installer.install({ id: 'mat-1', installedModels: [] } as unknown as Materia, ['does-not-exist'])
  assert.deepEqual(installedModels, [], 'nothing installed for an unknown id')
  assert.equal(called, 0, 'install client not called when no refs resolve')
})
