import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bus } from '../../../src/lib/bus.js'
import { startAnalyticsListener } from '../../../src/analytics/analyticsListener.js'
import type { WideEvent } from '../../../src/lib/wide.js'
import type { WideEventStore } from '../../../src/analytics/WideEventStore.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWideEvent(overrides: Partial<WideEvent> = {}): WideEvent {
  return {
    event:         'actum.complete',
    ts:            new Date().toISOString(),
    actumId:       `actum-${Math.random().toString(36).slice(2)}`,
    modusId:       'test.flux-dev',
    modusVersiono: '1.0.0',
    byType:        'animaId',
    reservation:   '1000000000000000',
    impetus:       '800000000000000',
    refund:        '200000000000000',
    durationMs:    1234,
    coldStart:     false,
    status:        'completed',
    ...overrides,
  }
}

function makeMockStore(overrides: Partial<{ save: (w: WideEvent) => Promise<void> }> = {}): WideEventStore {
  return {
    save: overrides.save ?? (async (_w: WideEvent) => {}),
    query: async () => [],
    totals: async () => ({ revenue: 0n, count: 0, failed: 0 }),
  } as unknown as WideEventStore
}

/**
 * Remove all listeners for the given bus events so tests don't bleed into each other.
 */
function cleanupBus(): void {
  bus.removeAllListeners('actum.complete')
  bus.removeAllListeners('actum.fail')
}

// ---------------------------------------------------------------------------
// Test 1 — bus actum.complete triggers store.save
// ---------------------------------------------------------------------------

test('bus actum.complete event triggers store.save with the wide event', async () => {
  cleanupBus()
  const saved: WideEvent[] = []
  const store = makeMockStore({
    save: async (w) => { saved.push(w) },
  })

  startAnalyticsListener(store)

  const wide = makeWideEvent({ status: 'completed' })
  bus.emit('actum.complete', wide)

  // Allow the async save to settle
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(saved.length, 1)
  assert.equal(saved[0].actumId, wide.actumId)

  cleanupBus()
})

// ---------------------------------------------------------------------------
// Test 2 — bus actum.fail triggers store.save
// ---------------------------------------------------------------------------

test('bus actum.fail event triggers store.save with the wide event', async () => {
  cleanupBus()
  const saved: WideEvent[] = []
  const store = makeMockStore({
    save: async (w) => { saved.push(w) },
  })

  startAnalyticsListener(store)

  const wide = makeWideEvent({ status: 'failed', event: 'actum.fail' })
  bus.emit('actum.fail', wide)

  await new Promise(resolve => setImmediate(resolve))

  assert.equal(saved.length, 1)
  assert.equal(saved[0].actumId, wide.actumId)
  assert.equal(saved[0].status, 'failed')

  cleanupBus()
})

// ---------------------------------------------------------------------------
// Test 3 — store.save failure is caught and logged (does not throw)
// ---------------------------------------------------------------------------

test('store.save failure is caught and does not propagate', async () => {
  cleanupBus()
  const store = makeMockStore({
    save: async () => { throw new Error('DB unavailable') },
  })

  startAnalyticsListener(store)

  const wide = makeWideEvent()

  // Should not throw
  let threw = false
  try {
    bus.emit('actum.complete', wide)
    await new Promise(resolve => setImmediate(resolve))
  } catch {
    threw = true
  }

  assert.equal(threw, false, 'Error from store.save should be caught, not thrown')

  cleanupBus()
})

// ---------------------------------------------------------------------------
// Test 4 — Honeycomb forwarding is skipped when HONEYCOMB_API_KEY is not set
// ---------------------------------------------------------------------------

test('Honeycomb forwarding is skipped when HONEYCOMB_API_KEY is not set', async () => {
  cleanupBus()

  // Ensure env vars are unset
  const prevKey     = process.env.HONEYCOMB_API_KEY
  const prevDataset = process.env.HONEYCOMB_DATASET
  delete process.env.HONEYCOMB_API_KEY
  delete process.env.HONEYCOMB_DATASET

  let fetchCalled = false
  const origFetch = globalThis.fetch
  globalThis.fetch = async (..._args: Parameters<typeof fetch>) => {
    fetchCalled = true
    return new Response('ok', { status: 200 })
  }

  const saved: WideEvent[] = []
  const store = makeMockStore({ save: async (w) => { saved.push(w) } })

  startAnalyticsListener(store)

  const wide = makeWideEvent()
  bus.emit('actum.complete', wide)

  await new Promise(resolve => setImmediate(resolve))

  globalThis.fetch = origFetch

  // Restore env
  if (prevKey     !== undefined) process.env.HONEYCOMB_API_KEY = prevKey
  if (prevDataset !== undefined) process.env.HONEYCOMB_DATASET = prevDataset

  assert.equal(fetchCalled, false, 'fetch should not be called when HONEYCOMB_API_KEY is not set')
  assert.equal(saved.length, 1, 'store.save should still be called')

  cleanupBus()
})
