import { describe, it, expect, vi } from 'vitest'
import { startIdleReaper } from '../../../src/crystal/idleReaper.js'
import type { Materia, MateriaStore } from '../../../src/types/materia.js'

function fakeMateria(over: Partial<Materia>): Materia {
  return {
    id: 'm', genus: 'runpod', externusId: 'pod', gpu: 'RTX4090', vramGb: 24, ramGb: 64,
    impetusPerSecond: 0n, status: 'terminated', ...over,
  }
}

describe('startIdleReaper', () => {
  it('terminates each pod the store reaps as idle-expired', async () => {
    const reaped = [
      fakeMateria({ id: 'm1', externusId: 'pod-1' }),
      fakeMateria({ id: 'm2', externusId: 'pod-2' }),
    ]
    const store = { reapIdle: vi.fn().mockResolvedValueOnce(reaped).mockResolvedValue([]) } as unknown as MateriaStore
    const terminated: string[] = []
    const terminate = vi.fn(async (id: string) => { terminated.push(id) })

    const stop = startIdleReaper(store, terminate, 40)
    await new Promise(r => setTimeout(r, 100))
    stop()

    expect((store.reapIdle as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
    expect(terminated).toEqual(['pod-1', 'pod-2'])
  })

  it('does nothing when no pods are reapable', async () => {
    const store = { reapIdle: vi.fn().mockResolvedValue([]) } as unknown as MateriaStore
    const terminate = vi.fn(async () => {})

    const stop = startIdleReaper(store, terminate, 40)
    await new Promise(r => setTimeout(r, 100))
    stop()

    expect(terminate).not.toHaveBeenCalled()
  })

  it('keeps sweeping even if a terminate call throws', async () => {
    const store = {
      reapIdle: vi.fn()
        .mockResolvedValueOnce([fakeMateria({ id: 'm1', externusId: 'pod-1' })])
        .mockResolvedValue([]),
    } as unknown as MateriaStore
    const terminate = vi.fn(async () => { throw new Error('runpod 500') })

    const stop = startIdleReaper(store, terminate, 40)
    await new Promise(r => setTimeout(r, 100))
    stop()

    // sweep ran more than once despite the terminate throwing
    expect((store.reapIdle as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(1)
  })
})
