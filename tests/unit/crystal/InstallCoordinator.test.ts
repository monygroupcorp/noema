import { test } from 'node:test'
import assert from 'node:assert/strict'
import { InstallCoordinator } from '../../../src/crystal/InstallCoordinator.js'
import type { ModelInstaller } from '../../../src/crystal/ModelInstaller.js'
import type { Materia } from '../../../src/types/materia.js'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const materia = (externusId: string, installed: string[] = []) =>
  ({ externusId, installedModels: installed } as unknown as Materia)

test('installs serialize per pod — the second waits for the first to settle', async () => {
  const order: string[] = []
  let releaseFirst!: () => void
  const installer = {
    async install(_m: Materia, ids: string[]) {
      order.push(`start:${ids[0]}`)
      if (ids[0] === 'a') await new Promise<void>(r => { releaseFirst = r })
      order.push(`end:${ids[0]}`)
      return { result: { modelsDownloaded: ids.length, modelsReused: 0 }, installedModels: ids }
    },
  } as unknown as ModelInstaller
  const coord = new InstallCoordinator(installer)
  const m = materia('pod-1')

  const p1 = coord.installLive(m, ['a'])
  const p2 = coord.installLive(m, ['b'])
  await sleep(5)
  assert.deepEqual(order, ['start:a'], 'the second install has not started while the first is in flight')
  releaseFirst()
  await Promise.all([p1, p2])
  assert.deepEqual(order, ['start:a', 'end:a', 'start:b', 'end:b'], 'fully serialized on the pod')
})

test('ensureForGen installs only the models missing from the pod', async () => {
  const calls: string[][] = []
  const installer = {
    async install(_m: Materia, ids: string[]) { calls.push(ids); return { result: { modelsDownloaded: ids.length, modelsReused: 0 }, installedModels: ids } },
  } as unknown as ModelInstaller
  const coord = new InstallCoordinator(installer)
  await coord.ensureForGen(materia('pod-1', ['x']), [{ id: 'x' }, { id: 'y' }, { id: undefined }])
  assert.deepEqual(calls, [['y']], 'only the missing, id-bearing model is installed')
})

test('ensureForGen is a no-op when every model is already present', async () => {
  let called = 0
  const installer = { async install() { called++; return { result: { modelsDownloaded: 0, modelsReused: 0 }, installedModels: [] } } } as unknown as ModelInstaller
  const coord = new InstallCoordinator(installer)
  await coord.ensureForGen(materia('pod-1', ['x', 'y']), [{ id: 'x' }, { id: 'y' }])
  assert.equal(called, 0, 'no install when nothing is missing')
})

test('a gen admission awaits an in-flight live install on the same pod', async () => {
  const order: string[] = []
  let releaseLive!: () => void
  const installer = {
    async install(_m: Materia, ids: string[]) {
      order.push(`install:${ids.join(',')}`)
      if (ids.includes('live')) await new Promise<void>(r => { releaseLive = r })
      return { result: { modelsDownloaded: ids.length, modelsReused: 0 }, installedModels: ids }
    },
  } as unknown as ModelInstaller
  const coord = new InstallCoordinator(installer)
  const m = materia('pod-1')

  const live = coord.installLive(m, ['live'])          // in flight
  const gen = coord.ensureForGen(m, [{ id: 'gen' }])   // queued behind it
  await sleep(5)
  assert.deepEqual(order, ['install:live'], 'gen admission has not run while the live add is downloading')
  releaseLive()
  await Promise.all([live, gen])
  assert.deepEqual(order, ['install:live', 'install:gen'], 'gen admission ran after the live install settled')
})
