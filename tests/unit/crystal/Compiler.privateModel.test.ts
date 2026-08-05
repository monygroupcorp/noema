// Run-path owner enforcement: a PRIVATE model resolves only for its owner (closes the
// find(id)-by-id hole). Hermetic — a DB-free Intellarum + the real sd15 template.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Compiler, CompilerError } from '../../../src/crystal/Compiler.js'
import { WorkflowTemplateRegistry } from '../../../src/crystal/WorkflowTemplateRegistry.js'
import { ESSENTIA_RUNMAKE_SD15 } from '../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_FUNDAMENTA } from '../../../src/crystal/seeds/fundamenta.js'
import { MemoryFundamentorum } from '../../../src/crystal/MemoryFundamentorum.js'
import type { Intellarum, Intella, Intellae } from '../../../src/types/intelligendi.js'
import type { ModelRef } from '../../../src/types/actum.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REAL_WORKFLOWS = path.join(__dirname, '../../../src/crystal/workflows')
const FUNDS = new MemoryFundamentorum(CANONICAL_FUNDAMENTA)

const SD15_BASE = {
  id: 'intella.sd15-v1-5', nomen: 'sd15 base', genus: 'model' as const, architectura: 'unet' as const,
  familia: 'sd15', parametri: 0,
  sources: [{ provenance: 'huggingface' as const, uri: 'https://example.com/sd15.safetensors' }],
  dest: 'checkpoints/v1-5-pruned-emaonly.safetensors', sizeGb: 1, versio: '1.0.0', canonica: true, natum: new Date(),
} as Intella

/** An Intellarum holding the sd15 base + one PRIVATE lora with the given owner fields. */
function intellarumWithPrivate(owner: { ownerKey?: string; ownerAnimaId?: string }): Intellarum {
  const priv = {
    id: 'intella.private-lora', nomen: 'secret', genus: 'lora' as const, architectura: 'lora' as const,
    familia: 'sd15', parametri: 0,
    sources: [{ provenance: 'miladystation' as const, uri: 'https://example.com/secret.safetensors' }],
    dest: 'models/loras/secret.safetensors', sizeGb: 0.1, versio: '1.0.0', canonica: false,
    access: 'private' as const, ...owner, natum: new Date(),
  } as Intella
  return {
    async find(id: string) { return id === SD15_BASE.id ? SD15_BASE : id === priv.id ? priv : null },
    async list() { return [priv] },
    async canonical() { return [] },
    async findByTrigger() { return [] },
    async triggerMap(): Promise<Map<string, Intellae>> { return new Map() },
  }
}

const compilerWith = (i: Intellarum) => new Compiler(new WorkflowTemplateRegistry(REAL_WORKFLOWS), () => 42, i, FUNDS)
const PIN: ModelRef[] = [{ role: 'lora', id: 'intella.private-lora', dest: 'models/loras/secret.safetensors' }]

test('a private model pinned by a NON-owner is refused (MODEL_FORBIDDEN)', async () => {
  const compiler = compilerWith(intellarumWithPrivate({ ownerKey: 'anima:owner-1' }))
  await assert.rejects(
    () => compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' }, { pinnedModels: PIN, ownerKey: 'anima:someone-else' }),
    (e: unknown) => e instanceof CompilerError && (e as CompilerError).code === 'MODEL_FORBIDDEN',
  )
})

test('a private model pinned with NO run identity is refused', async () => {
  const compiler = compilerWith(intellarumWithPrivate({ ownerKey: 'anima:owner-1' }))
  await assert.rejects(
    () => compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' }, { pinnedModels: PIN }),
    (e: unknown) => e instanceof CompilerError && (e as CompilerError).code === 'MODEL_FORBIDDEN',
  )
})

test('the OWNER can resolve their own private model (ownerKey match)', async () => {
  const compiler = compilerWith(intellarumWithPrivate({ ownerKey: 'anima:owner-1' }))
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' }, { pinnedModels: PIN, ownerKey: 'anima:owner-1' })
  assert.ok(spec.models.find(m => m.id === 'intella.private-lora'), 'private model resolves for its owner')
})

test('a Bursa purse owner resolves its own private model', async () => {
  const compiler = compilerWith(intellarumWithPrivate({ ownerKey: 'bursa:2f2ce3c0' }))
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' }, { pinnedModels: PIN, ownerKey: 'bursa:2f2ce3c0' })
  assert.ok(spec.models.find(m => m.id === 'intella.private-lora'))
})

test('legacy record (ownerAnimaId only) resolves for the matching anima ownerKey', async () => {
  const compiler = compilerWith(intellarumWithPrivate({ ownerAnimaId: 'owner-1' }))  // no ownerKey field
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' }, { pinnedModels: PIN, ownerKey: 'anima:owner-1' })
  assert.ok(spec.models.find(m => m.id === 'intella.private-lora'), 'anima:<id> matches legacy ownerAnimaId')
})

test('legacy animaId opt (not ownerKey) still authorizes the owner', async () => {
  const compiler = compilerWith(intellarumWithPrivate({ ownerAnimaId: 'owner-1' }))
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' }, { pinnedModels: PIN, animaId: 'owner-1' })
  assert.ok(spec.models.find(m => m.id === 'intella.private-lora'))
})

test('a PUBLIC pinned model resolves for anyone (no owner needed)', async () => {
  // Flip the same lora to public — now no ownerKey is required.
  const pub = intellarumWithPrivate({})
  const orig = pub.find
  pub.find = async (id: string) => {
    const r = await orig(id)
    if (r && r.id === 'intella.private-lora') (r as Intella).access = 'public'
    return r
  }
  const compiler = compilerWith(pub)
  const { spec } = await compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' }, { pinnedModels: PIN })
  assert.ok(spec.models.find(m => m.id === 'intella.private-lora'))
})

// ── noema-113: pinnedModels falsy-id guard ───────────────────────────────────
// A shape regression — a bare string, or a `{id: undefined}` ref — must fail LOUD and
// SPECIFIC here, BEFORE it reaches `_resolveModels` as `find(undefined)` → the misleading
// `No URL for model 'undefined'` (the paid 500 on GO this item fixes).

test('a bare-string pinned ref is rejected with MODEL_REF_INVALID (got string)', async () => {
  const compiler = compilerWith(intellarumWithPrivate({}))
  await assert.rejects(
    () => compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' },
      { pinnedModels: ['stationthis'] as unknown as ModelRef[] }),
    (e: unknown) =>
      e instanceof CompilerError &&
      (e as CompilerError).code === 'MODEL_REF_INVALID' &&
      /pinnedModels\[0\] missing id \(got string\)/.test((e as CompilerError).message),
  )
})

test('a pinned ref with an undefined id is rejected with a specific message', async () => {
  const compiler = compilerWith(intellarumWithPrivate({}))
  await assert.rejects(
    () => compiler.compile(ESSENTIA_RUNMAKE_SD15, { prompt: 'a cat' },
      { pinnedModels: [{ role: 'lora', dest: 'models/loras/x.safetensors' } as unknown as ModelRef] }),
    (e: unknown) =>
      e instanceof CompilerError &&
      (e as CompilerError).code === 'MODEL_REF_INVALID' &&
      /pinnedModels\[0\] missing id \(got id undefined\)/.test((e as CompilerError).message),
  )
})
