// =============================================================================
// invokeFlow — insufficient-funds mapping (core error → API error)
// =============================================================================
//
// A payer who cannot cover a run's reservation is a request outcome, not a server
// fault. The core throws a typed `InsufficientFundsError`; the API layer must
// translate it into `402 economy.insufficient_signa`, NOT advertise it as
// retryable, and leave every other error alone. Hermetic: no pod, no Mongo — the
// deps ring is faked down to what `invokeFlow` reads, so this proves the mapping
// and nothing about a live route beyond the shape of its error.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CrystalApi, type CrystalApiDeps } from '../../../../src/allocutio/api/CrystalApi.js'
import { ApiError } from '../../../../src/allocutio/api/errors.js'
import { InsufficientFundsError } from '../../../../src/execution/ActumInceptor.js'
import { InsufficientBursaCreditsError } from '../../../../src/types/bursa.js'
import type { Modus } from '../../../../src/types/modus.js'
import type { Cursor } from '../../../../src/types/cursus.js'
import type { AuctorKey } from '../../../../src/flow/types.js'

const auctor: AuctorKey = { animaId: 'anima-1' }

const modus: Modus = {
  id: 'mod-1',
  nomen: 'mod-1',
  genus: 'atomicus',
  versio: '1.0.0',
  contentHash: 'sha256:mod-1',
  aditus: { prompt: { type: 'text', required: true } },
  exitus: { image: { type: 'image' } },
  ministerium: 'fake',
  canonica: true,
  natum: new Date('2026-01-01T00:00:00Z'),
  mutatum: new Date('2026-01-01T00:00:00Z'),
}

const cursor: Cursor = {
  reserve: async () => 5n,
  run: async () => ({ kind: 'sync', exitus: { exitus: { image: 'x' }, impetus: 5n } }),
}

/** Deps ring whose `inceptor.initiate` always throws `initiateThrows`. */
function makeDeps(initiateThrows: unknown): CrystalApiDeps {
  return ({
    inceptor: { initiate: async () => { throw initiateThrows } },
    modorum: {
      find: async (id: string) => (id === modus.id ? modus : null),
      register: async () => {},
      list: async () => [modus],
      update: async () => { throw new Error('unused') },
    },
    cursorum: { register: () => {}, resolve: () => cursor },
    completor: {
      complete: async (a: unknown) => a,
      fail: async (a: unknown) => a,
    },
  } as unknown) as CrystalApiDeps
}

/** Run `invokeFlow` and return whatever it rejected with. */
async function rejection(deps: CrystalApiDeps): Promise<unknown> {
  const api = new CrystalApi(deps)
  return api.invokeFlow(auctor, { modusId: modus.id }, { prompt: 'hi' }).then(
    () => { throw new Error('expected invokeFlow to reject') },
    (err: unknown) => err,
  )
}

test('an underfunded run surfaces as 402 economy.insufficient_signa', async () => {
  const err = await rejection(makeDeps(new InsufficientFundsError(50n, 1000n)))

  assert.ok(err instanceof ApiError, `expected an ApiError, got ${String(err)}`)
  assert.equal(err.code, 'economy.insufficient_signa')
  assert.equal(err.httpStatus, 402)
  // The caller's own figures, carried as data rather than parsed out of a message.
  assert.deepEqual(err.toBody().details, { available: '50', required: '1000' })
})

test('an underfunded run is NOT advertised as retryable', async () => {
  const err = await rejection(makeDeps(new InsufficientFundsError(50n, 1000n)))

  assert.ok(err instanceof ApiError)
  // A retry cannot succeed until the balance changes, so `retryable` must never
  // be true here — neither set outright nor inherited from a generic error path.
  assert.notEqual(err.toBody().retryable, true)
})

test('an unrelated core error is not swallowed by the mapping', async () => {
  const unrelated = new Error('cursor exploded')
  const err = await rejection(makeDeps(unrelated))

  // Untouched: it escapes as-is, so the router's generic 500 handling still owns it.
  assert.equal(err, unrelated)
  assert.ok(!(err instanceof ApiError), 'an unrelated failure must not become a 402')
})

// ── Bursa rail ────────────────────────────────────────────────────────────────
//
// The purse rail carries its own shortfall type (purse credits, a sibling of the
// impetus-denominated one) and must reach the client through the same 402 — while a
// bursa failure that is NOT a shortfall keeps its own handling, so the mapping is
// narrow rather than a catch-all for the rail.

test('a bursa shortfall surfaces as 402, not 500', async () => {
  const err = await rejection(makeDeps(new InsufficientBursaCreditsError(50n, 1000n)))

  assert.ok(err instanceof ApiError, `expected an ApiError, got ${String(err)}`)
  assert.equal(err.code, 'economy.insufficient_signa')
  assert.equal(err.httpStatus, 402)
  assert.deepEqual(err.toBody().details, { available: '50', required: '1000' })
})

test('a bursa shortfall is NOT advertised as retryable', async () => {
  const err = await rejection(makeDeps(new InsufficientBursaCreditsError(50n, 1000n)))

  assert.ok(err instanceof ApiError)
  assert.notEqual(err.toBody().retryable, true)
})

test('an unrelated bursa failure does not become a 402', async () => {
  // A bad token is a different condition from an empty purse and wants its own status.
  const unknownPurse = new Error('Bursa not found')
  const err = await rejection(makeDeps(unknownPurse))

  assert.equal(err, unknownPurse)
  assert.ok(!(err instanceof ApiError), 'a non-shortfall bursa failure must not become a 402')
})
