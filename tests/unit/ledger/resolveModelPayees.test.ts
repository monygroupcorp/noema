import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveModelRoyaltyPayees } from '../../../src/ledger/resolveModelPayees.js'
import type { Actum } from '../../../src/types/actum.js'
import type { Editio, Editiones, ArtifactRef } from '../../../src/types/editio.js'

// =============================================================================
// resolveModelPayees — turn the models a gen used into weighted royalty payees,
// via each model's published Editio (the royalty surface, spec §5e).
// =============================================================================

let seq = 0
function ed(id: string, patch: Partial<Editio>): Editio {
  const now = new Date(Date.now() + seq++) // monotonic so "newest" is deterministic
  return {
    id: `e-${seq}`, artifactRef: { kind: 'intella', id }, destination: 'huggingface',
    visibility: 'unlisted', custody: 'ours', by: { animaId: 'pub' },
    status: 'published', natum: now, mutatum: now, ...patch,
  }
}

/** A fake Editionum keyed by intella id. */
function fakeEditiones(byId: Record<string, Editio[]>) {
  return {
    async listByArtifact(ref: ArtifactRef): Promise<Editiones> {
      return ref.kind === 'intella' ? (byId[ref.id] ?? []) : []
    },
  }
}

/** A fake deployment store whose bundle lists the given model ids. */
function fakeDeployments(hash: string, modelIds: string[]) {
  return {
    async find(h: string) {
      return h === hash ? { hash, spec: { models: modelIds.map((id) => ({ id, role: 'lora' })) }, natum: new Date() } : null
    },
  }
}

const actum = (over: Partial<Actum> = {}): Actum =>
  ({ id: 'act-1', deploymentHash: 'sha256:dep', ...over } as Actum)

test('returns [] when the actum used no models', async () => {
  const out = await resolveModelRoyaltyPayees(actum({ deploymentHash: undefined }), {})
  assert.deepEqual(out, [])
})

test('a model with a published owners[] split pays that split', async () => {
  const deps = {
    deployments: fakeDeployments('sha256:dep', ['lora-a']),
    editiones: fakeEditiones({ 'lora-a': [ed('lora-a', { owners: [{ animaId: 'x', weight: 0.6 }, { animaId: 'y', weight: 0.4 }] })] }),
  }
  assert.deepEqual(await resolveModelRoyaltyPayees(actum(), deps), [{ animaId: 'x', weight: 0.6 }, { animaId: 'y', weight: 0.4 }])
})

test('a published model with no explicit split pays its publisher 100%', async () => {
  const deps = {
    deployments: fakeDeployments('sha256:dep', ['lora-a']),
    editiones: fakeEditiones({ 'lora-a': [ed('lora-a', { by: { animaId: 'solo' } })] }),
  }
  assert.deepEqual(await resolveModelRoyaltyPayees(actum(), deps), [{ animaId: 'solo', weight: 1 }])
})

test('an anon (commitment) publisher with no split yields no payee', async () => {
  const deps = {
    deployments: fakeDeployments('sha256:dep', ['lora-a']),
    editiones: fakeEditiones({ 'lora-a': [ed('lora-a', { by: { commitment: '0xabc' } })] }),
  }
  assert.deepEqual(await resolveModelRoyaltyPayees(actum(), deps), [])
})

test('an unpublished / canonical model (no Editio) yields no payee', async () => {
  const deps = {
    deployments: fakeDeployments('sha256:dep', ['canon-1']),
    editiones: fakeEditiones({}),
  }
  assert.deepEqual(await resolveModelRoyaltyPayees(actum(), deps), [])
})

test('only the published Editio counts (pending/rejected ignored)', async () => {
  const deps = {
    deployments: fakeDeployments('sha256:dep', ['lora-a']),
    editiones: fakeEditiones({ 'lora-a': [ed('lora-a', { status: 'pending', by: { animaId: 'nope' } })] }),
  }
  assert.deepEqual(await resolveModelRoyaltyPayees(actum(), deps), [])
})

test('the newest published Editio wins when a model was published more than once', async () => {
  const older = ed('lora-a', { by: { animaId: 'old' } })
  const newer = ed('lora-a', { owners: [{ animaId: 'new', weight: 1 }] })
  const deps = {
    deployments: fakeDeployments('sha256:dep', ['lora-a']),
    editiones: fakeEditiones({ 'lora-a': [older, newer] }),
  }
  assert.deepEqual(await resolveModelRoyaltyPayees(actum(), deps), [{ animaId: 'new', weight: 1 }])
})

test('multiple models are weighted equally; a shared payee is summed', async () => {
  // lora-a → solo author A (weight 1); lora-b → split A 0.5 / B 0.5.
  // Each model contributes weights summing to 1, so A = 1 + 0.5 = 1.5, B = 0.5.
  const deps = {
    deployments: fakeDeployments('sha256:dep', ['lora-a', 'lora-b']),
    editiones: fakeEditiones({
      'lora-a': [ed('lora-a', { by: { animaId: 'A' } })],
      'lora-b': [ed('lora-b', { owners: [{ animaId: 'A', weight: 0.5 }, { animaId: 'B', weight: 0.5 }] })],
    }),
  }
  const out = await resolveModelRoyaltyPayees(actum(), deps)
  assert.deepEqual(new Map(out.map((p) => [p.animaId, p.weight])), new Map([['A', 1.5], ['B', 0.5]]))
})

test('host-pinned models are included and de-duplicated against the bundle', async () => {
  const deps = {
    deployments: fakeDeployments('sha256:dep', ['lora-a']),
    editiones: fakeEditiones({
      'lora-a': [ed('lora-a', { by: { animaId: 'A' } })],
      'lora-pinned': [ed('lora-pinned', { by: { animaId: 'P' } })],
    }),
  }
  const pinned = actum({ pinnedModels: [{ role: 'lora', id: 'lora-a', dest: 'x' }, { role: 'lora', id: 'lora-pinned', dest: 'y' }] })
  const out = await resolveModelRoyaltyPayees(pinned, deps)
  // lora-a appears in both the bundle and the pins but is counted once.
  assert.deepEqual(new Map(out.map((p) => [p.animaId, p.weight])), new Map([['A', 1], ['P', 1]]))
})
