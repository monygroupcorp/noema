// GET /v1/editiones/:id/preview (docs/spec/publish-review-visibility.md §2, Gap B): what a
// reviewer needs to see to adjudicate a HELD publication, resolved server-side the same way
// the moderation gate itself resolved it — `_artifactOutput` -> `allMediaUrls` — for ANY
// artifact kind, not just an `actum` generation run. previewHeldEdition/CrystalApi only reads
// `editiones` + `intellarum` (+ `actorum` for the actum branch), so a minimal deps cast is
// safe here (same convention as depositQuote.test.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CrystalApi, type CrystalApiDeps } from '../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../src/allocutio/api/errors.js'
import type { Editio, Editionum, ArtifactRef, Editiones, FeedFilter } from '../../../src/types/editio.js'
import type { Intella } from '../../../src/types/intelligendi.js'

const ADMIN = { animaId: 'platform' } // PLATFORM_ANIMA_ID default (unset in test env)
const AUTHOR = { animaId: 'anima-1' }

const HELD_INTELLA_EDITIO: Editio = {
  id: 'ed-held-intella',
  artifactRef: { kind: 'intella', id: 'lora-1' },
  destination: 'huggingface',
  visibility: 'unlisted',
  custody: 'ours',
  by: AUTHOR,
  status: 'pending',
  reviewOutcome: 'pending',
  natum: new Date(0),
  mutatum: new Date(0),
}

const APPROVED_EDITIO: Editio = { ...HELD_INTELLA_EDITIO, id: 'ed-approved', reviewOutcome: 'approved' }

const HELD_ACTUM_EDITIO: Editio = {
  ...HELD_INTELLA_EDITIO,
  id: 'ed-held-actum',
  artifactRef: { kind: 'actum', id: 'act-1' },
}

const LORA_1: Intella = {
  id: 'lora-1',
  nomen: 'My LoRA',
  genus: 'lora',
  sources: [{ provenance: 'miladystation', uri: 'https://x/lora.safetensors' }],
  samples: [
    { url: 'https://cdn/sample-0.jpg', prompt: 'a cat astronaut' },
    { url: 'https://cdn/sample-1.jpg' },
  ],
} as unknown as Intella

/** In-memory Editionum: only `find` is exercised by previewHeldEdition. */
function fakeEditiones(rows: Editio[]): Editionum {
  const store = new Map(rows.map((e) => [e.id, e]))
  return {
    async find(id: string) { return store.get(id) ?? null },
    async listByArtifact(_ref: ArtifactRef): Promise<Editiones> { return [] },
    async listByAuthor(_by: Editio['by']): Promise<Editiones> { return [] },
    async listFeed(_filter?: FeedFilter): Promise<Editiones> { return [] },
    async listHeld(): Promise<Editiones> { return [] },
    async create(): Promise<Editio> { throw new Error('not used') },
    async update(id: string, patch) { const e = { ...store.get(id)!, ...patch }; store.set(id, e); return e },
    async claimPending(): Promise<Editio | null> { return null },
  }
}

function api(rows: Editio[] = [HELD_INTELLA_EDITIO]): CrystalApi {
  const editiones = fakeEditiones(rows)
  const intellarum = { find: async (id: string) => (id === 'lora-1' ? LORA_1 : null) }
  const actorum = { findById: async (id: string) => (id === 'act-1' ? { id, status: 'completus', exitus: { image: 'https://cdn/act-1.png' } } : null) }
  return new CrystalApi({ editiones, intellarum, actorum } as unknown as CrystalApiDeps)
}

test('previewHeldEdition: a platform admin gets the media urls + sample prompts for a held intella editio', async () => {
  const preview = await api().previewHeldEdition(ADMIN, HELD_INTELLA_EDITIO.id)
  assert.deepEqual(preview.mediaUrls, ['https://cdn/sample-0.jpg', 'https://cdn/sample-1.jpg'])
  assert.deepEqual(preview.items, [
    { url: 'https://cdn/sample-0.jpg', prompt: 'a cat astronaut' },
    { url: 'https://cdn/sample-1.jpg' },
  ])
})

test('previewHeldEdition: kind-agnostic — an actum hold resolves via the same call, no intella special-casing', async () => {
  const preview = await api([HELD_ACTUM_EDITIO]).previewHeldEdition(ADMIN, HELD_ACTUM_EDITIO.id)
  assert.deepEqual(preview.mediaUrls, ['https://cdn/act-1.png'])
  assert.equal(preview.items, undefined, 'an actum exitus carries no per-item metadata to surface')
})

test('previewHeldEdition: a non-admin caller is refused, author included — never exposes preview urls', async () => {
  await assert.rejects(
    () => api().previewHeldEdition(AUTHOR, HELD_INTELLA_EDITIO.id),
    (e: unknown) => e instanceof ApiError && e.httpStatus === 403 && e.code === 'auth.forbidden',
  )
})

test('previewHeldEdition: a non-existent editio 404s for an admin caller', async () => {
  await assert.rejects(
    () => api().previewHeldEdition(ADMIN, 'does-not-exist'),
    (e: unknown) => e instanceof ApiError && e.httpStatus === 404 && e.code === 'not_found.edition',
  )
})

test('previewHeldEdition: an editio that is not currently held (already approved) 404s — same contract as approve/reject', async () => {
  await assert.rejects(
    () => api([APPROVED_EDITIO]).previewHeldEdition(ADMIN, APPROVED_EDITIO.id),
    (e: unknown) => e instanceof ApiError && e.httpStatus === 404 && e.code === 'not_found.edition',
  )
})
