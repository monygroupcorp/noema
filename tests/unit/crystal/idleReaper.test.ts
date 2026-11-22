import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startIdleReaper } from '../../../src/crystal/idleReaper.js'
import type { Materia, MateriaStore } from '../../../src/types/materia.js'

function fakeMateria(over: Partial<Materia>): Materia {
  return {
    id: 'm', genus: 'runpod', externusId: 'pod', gpu: 'RTX4090', vramGb: 24, ramGb: 64,
    impetusPerSecond: 0n, status: 'terminated', ...over,
  }
}

// Minimal MateriaStore stub — the reaper only calls reapIdle.
function makeStore(reapResults: Materia[][]): MateriaStore {
  let i = 0
  return {
    async reapIdle() { return reapResults[i++] ?? [] },
  } as unknown as MateriaStore
}

const wait = (ms: number) => new Promise(r => setTimeout(r, ms))

test('startIdleReaper terminates each pod the store reaps as idle-expired', async () => {
  const reaped = [
    fakeMateria({ id: 'm1', externusId: 'pod-1' }),
    fakeMateria({ id: 'm2', externusId: 'pod-2' }),
  ]
  const store = makeStore([reaped])
  const terminated: string[] = []
  const stop = startIdleReaper(store, async (id) => { terminated.push(id) }, 40)
  await wait(100)
  stop()
  assert.deepEqual(terminated, ['pod-1', 'pod-2'])
})

test('startIdleReaper does nothing when no pods are reapable', async () => {
  const store = makeStore([])
  let calls = 0
  const stop = startIdleReaper(store, async () => { calls++ }, 40)
  await wait(100)
  stop()
  assert.equal(calls, 0)
})

test('startIdleReaper forwards hasLiveActum through to the store on every sweep', async () => {
  const seen: unknown[] = []
  const store: MateriaStore = {
    async reapIdle(_now: Date, hasLiveActum?: (materiaId: string) => Promise<boolean>) {
      seen.push(hasLiveActum)
      return []
    },
  } as unknown as MateriaStore
  const hasLiveActum = async (_id: string) => false
  const stop = startIdleReaper(store, async () => {}, 40, hasLiveActum)
  await wait(90)
  stop()
  assert.ok(seen.length > 0, 'expected at least one sweep')
  for (const got of seen) assert.equal(got, hasLiveActum, 'the same predicate reaches reapIdle each sweep')
})

test('startIdleReaper keeps sweeping even if a terminate call throws', async () => {
  let sweepCount = 0
  const store: MateriaStore = {
    async reapIdle() {
      sweepCount++
      return sweepCount === 1 ? [fakeMateria({ id: 'm1', externusId: 'pod-1' })] : []
    },
  } as unknown as MateriaStore
  const stop = startIdleReaper(store, async () => { throw new Error('runpod 500') }, 40)
  await wait(100)
  stop()
  // sweep ran more than once despite the terminate throwing
  assert.ok(sweepCount > 1, `expected multiple sweeps, got ${sweepCount}`)
})
