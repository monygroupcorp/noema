// =============================================================================
// compileTabula — hermetic unit test
// =============================================================================
//
// Pure crystal-only logic (no I/O) — a fixture Tabula + a canned Modus resolver.
// Covers: basic Gradus/ligamina wiring, the make-upscale parity target (spec
// acceptance: "publishing the seeded make-upscale shape by hand produces a
// Modus equivalent to COMPOSITUS_MAKE_UPSCALE"), cycle rejection, and
// port-type-mismatch rejection.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { compileTabula, TabulaCompileError, type ModusResolver } from '../../../../src/crystal/compileTabula.js'
import { COMPOSITUS_MAKE_UPSCALE } from '../../../../src/crystal/seeds/compositi.js'
import { ESSENTIA_RUNMAKE_SD15, ESSENTIA_UPSCALE } from '../../../../src/crystal/seeds/essentiae.js'
import type { Tabula, TabulaNodus, TabulaVinculum } from '../../../../src/types/tabula.js'
import type { Modus } from '../../../../src/types/modus.js'

const auctor = { animaId: 'anima-1' }

function nodus(over: Partial<TabulaNodus> & { id: string; modusId: string }): TabulaNodus {
  return { x: 0, y: 0, aditus: {}, ...over }
}
function vinculum(over: Partial<TabulaVinculum> & Pick<TabulaVinculum, 'id' | 'fonteNodusId' | 'fontePorta' | 'scopusNodusId' | 'scopusPorta'>): TabulaVinculum {
  return { discordantia: false, ...over }
}
function tabula(over: Partial<Tabula> = {}): Tabula {
  return {
    id: 't1', nomen: 'Test', auctor, nodi: [], vincula: [],
    status: 'draft', visibilitas: 'privata',
    natum: new Date('2026-01-01'), mutatum: new Date('2026-01-01'),
    ...over,
  }
}

const modusRegistry: Record<string, Modus> = {
  'sd1-5': ESSENTIA_RUNMAKE_SD15,
  upscale: ESSENTIA_UPSCALE,
}
const resolve: ModusResolver = async (id) => modusRegistry[id] ?? null

test('make-upscale shape compiles to a Modus equivalent to COMPOSITUS_MAKE_UPSCALE', async () => {
  const t = tabula({
    nodi: [
      nodus({ id: 'n0', modusId: 'sd1-5' }),
      nodus({ id: 'n1', modusId: 'upscale' }),
    ],
    vincula: [
      vinculum({ id: 'v1', fonteNodusId: 'n0', fontePorta: 'image', scopusNodusId: 'n1', scopusPorta: 'image' }),
    ],
  })
  const compiled = await compileTabula(t, resolve)

  // aditus: only the unwired required `prompt` port bubbles up.
  assert.deepEqual(Object.keys(compiled.aditus), Object.keys(COMPOSITUS_MAKE_UPSCALE.aditus))
  assert.equal(compiled.aditus.prompt.type, COMPOSITUS_MAKE_UPSCALE.aditus.prompt.type)
  assert.equal(compiled.aditus.prompt.required, COMPOSITUS_MAKE_UPSCALE.aditus.prompt.required)

  // exitus: the final step's (upscale) exitus schema, type-equivalent.
  assert.deepEqual(Object.keys(compiled.exitus), Object.keys(COMPOSITUS_MAKE_UPSCALE.exitus))
  assert.equal(compiled.exitus.image.type, COMPOSITUS_MAKE_UPSCALE.exitus.image.type)

  // gradus: two steps, ordine 0/1, the one cross-step wire on step 1.
  assert.equal(compiled.gradus.length, COMPOSITUS_MAKE_UPSCALE.gradus!.length)
  assert.equal(compiled.gradus[0].ordine, 0)
  assert.equal(compiled.gradus[0].modusId, 'sd1-5')
  assert.equal(compiled.gradus[0].ligamina, undefined)
  assert.equal(compiled.gradus[1].ordine, 1)
  assert.equal(compiled.gradus[1].modusId, 'upscale')
  assert.deepEqual(compiled.gradus[1].ligamina, { image: { gradus: 0, exitus: 'image' } })
})

test('a per-node aditus override becomes the bubbled Porta.default', async () => {
  const t = tabula({
    nodi: [nodus({ id: 'n0', modusId: 'sd1-5', aditus: { prompt: 'a cat' } })],
  })
  const compiled = await compileTabula(t, resolve)
  assert.equal(compiled.aditus.prompt.default, 'a cat')
  assert.equal(compiled.aditus.prompt.required, true)
})

test('a wired port does not bubble up to compositus aditus', async () => {
  const t = tabula({
    nodi: [nodus({ id: 'n0', modusId: 'upscale' })],
  })
  const compiled = await compileTabula(t, resolve)
  // upscale's only aditus (`image`, required) is unwired here → it DOES bubble.
  assert.ok('image' in compiled.aditus)

  const wired = tabula({
    nodi: [
      nodus({ id: 'n0', modusId: 'sd1-5' }),
      nodus({ id: 'n1', modusId: 'upscale' }),
    ],
    vincula: [vinculum({ id: 'v1', fonteNodusId: 'n0', fontePorta: 'image', scopusNodusId: 'n1', scopusPorta: 'image' })],
  })
  const compiledWired = await compileTabula(wired, resolve)
  assert.ok(!('image' in compiledWired.aditus))
})

test('a cycle is rejected, naming the offending vinculum', async () => {
  const t = tabula({
    nodi: [
      nodus({ id: 'n0', modusId: 'sd1-5' }),
      nodus({ id: 'n1', modusId: 'upscale' }),
    ],
    vincula: [
      vinculum({ id: 'v1', fonteNodusId: 'n0', fontePorta: 'image', scopusNodusId: 'n1', scopusPorta: 'image' }),
      vinculum({ id: 'v2', fonteNodusId: 'n1', fontePorta: 'image', scopusNodusId: 'n0', scopusPorta: 'prompt' }),
    ],
  })
  await assert.rejects(
    () => compileTabula(t, resolve),
    (err: unknown) => {
      assert.ok(err instanceof TabulaCompileError)
      assert.equal(err.code, 'cycle')
      assert.ok(err.vinculumId === 'v1' || err.vinculumId === 'v2')
      return true
    },
  )
})

test('a port-type mismatch is rejected 400-shaped, naming the offending vinculum', async () => {
  const t = tabula({
    nodi: [
      nodus({ id: 'n0', modusId: 'sd1-5' }),
      nodus({ id: 'n1', modusId: 'upscale' }),
    ],
    // wires sd1-5's text `prompt` OUTPUT... wait sd1-5 has no text exitus port; use a
    // deliberately mismatched wire: sd1-5.image (image) → upscale.image but rename the
    // scopus port to a made-up int port to force a type clash via a fabricated resolver.
    vincula: [
      vinculum({ id: 'v-bad', fonteNodusId: 'n0', fontePorta: 'image', scopusNodusId: 'n1', scopusPorta: 'image' }),
    ],
  })
  const mismatchResolve: ModusResolver = async (id) => {
    if (id === 'upscale') return { ...ESSENTIA_UPSCALE, aditus: { image: { type: 'video', required: true } } }
    return modusRegistry[id] ?? null
  }
  await assert.rejects(
    () => compileTabula(t, mismatchResolve),
    (err: unknown) => {
      assert.ok(err instanceof TabulaCompileError)
      assert.equal(err.code, 'port_mismatch')
      assert.equal(err.vinculumId, 'v-bad')
      return true
    },
  )
})

test('an empty graph is rejected', async () => {
  await assert.rejects(
    () => compileTabula(tabula(), resolve),
    (err: unknown) => {
      assert.ok(err instanceof TabulaCompileError)
      assert.equal(err.code, 'empty')
      return true
    },
  )
})

test('a node referencing an unknown modus is rejected', async () => {
  const t = tabula({ nodi: [nodus({ id: 'n0', modusId: 'ghost' })] })
  await assert.rejects(
    () => compileTabula(t, resolve),
    (err: unknown) => {
      assert.ok(err instanceof TabulaCompileError)
      assert.equal(err.code, 'missing_modus')
      return true
    },
  )
})
