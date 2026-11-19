import { test } from 'node:test'
import assert from 'node:assert/strict'
import { StatusView } from '../../../../src/allocutio/lexicon/status/StatusView.js'
import type { StatusSnapshot } from '../../../../src/allocutio/lexicon/status/types.js'

const NOW = new Date('2026-05-24T12:00:00Z')
const ALICE = { animaId: 'anima-alice' }

const empty: StatusSnapshot = {
  auctorKey: ALICE,
  balanceImpetus: 0n, balanceUsd: 0,
  gens: [], studios: [], joinable: [],
  takenAt: NOW,
}

const cb = (kb: ReturnType<typeof StatusView.render>['keyboard']) => kb.flat().map(b => b.data)

test('signed-in zero-state: only Balance + footer', () => {
  const { text, keyboard } = StatusView.render(empty)
  assert.match(text, /Balance: 0 impetus \(\$0\.00\)/)
  assert.ok(!text.includes('YOUR GENS'), 'no empty section header')
  assert.ok(!text.includes('YOUR STUDIOS'))
  assert.ok(!text.includes('JOINABLE'))
  assert.deepEqual(cb(keyboard), ['stat:refresh'], 'only buttons that do something')
})

test('not signed in: prompts to connect; only footer affordances', () => {
  const { text, keyboard } = StatusView.render({ ...empty, auctorKey: null })
  assert.match(text, /Not signed in/)
  assert.deepEqual(cb(keyboard), ['stat:refresh'])
})

test('balance: formats with thousands separator + USD', () => {
  const { text } = StatusView.render({ ...empty, balanceImpetus: 1_240n, balanceUsd: 0.418 })
  assert.match(text, /Balance: 1,240 impetus \(\$0\.42\)/)
})

test('balance: sub-cent USD reads as "<$0.01"', () => {
  const { text } = StatusView.render({ ...empty, balanceImpetus: 5n, balanceUsd: 0.001685 })
  assert.match(text, /Balance: 5 impetus \(<\$0\.01\)/)
})

test('YOUR GENS section: one row + per-gen Cancel button', () => {
  const { text, keyboard } = StatusView.render({
    ...empty,
    gens: [{
      actumId: 'act-1',
      modusLabel: 'Flux Schnell',
      studio: { id: 'mat-1', hostLabel: '@bob', isOwn: false },
      status: 'agens',
      elapsedMs: 12_000,
    }],
  })
  assert.match(text, /YOUR GENS \(1\)/)
  assert.match(text, /Flux Schnell — running on @bob's studio — 12s elapsed/)
  assert.ok(cb(keyboard).includes('stat:cancel:act-1'), 'per-row cancel affordance')
})

test('YOUR GENS: queued gen with ETA', () => {
  const { text } = StatusView.render({
    ...empty,
    gens: [{
      actumId: 'act-q',
      modusLabel: 'Chat',
      studio: { id: 'mat-2', hostLabel: '@carol', isOwn: false },
      status: 'nascens',
      etaMs: 30_000,
    }],
  })
  assert.match(text, /Chat — queued on @carol's studio — ETA 30s/)
})

test('YOUR STUDIOS: idle studio with warm window + bulletin link', () => {
  const { text, keyboard } = StatusView.render({
    ...empty,
    studios: [{
      studioId: 'mat-1',
      materiaId: 'mat-1',
      label: 'flux-v1 on H100',
      status: 'idle',
      warmRemainingMs: 38_000,
      guestsToday: 2,
      netImpetus: 148n,
      netUsd: 0.0499,
    }],
  })
  assert.match(text, /YOUR STUDIOS \(1\)/)
  assert.match(text, /flux-v1 on H100 — idle — 38s warm — 2 guests today — \+148 \(\+\$0\.05\)/)
  assert.ok(cb(keyboard).includes('stat:bulletin:mat-1'), 'per-studio bulletin link')
})

test('YOUR STUDIOS: draining status renders explicitly', () => {
  const { text } = StatusView.render({
    ...empty,
    studios: [{
      studioId: 'mat-1', materiaId: 'mat-1', label: 'flux-v1 on H100', status: 'draining',
      guestsToday: 0, netImpetus: -200n, netUsd: -0.0674,
    }],
  })
  assert.match(text, /draining \(balance depleted\)/)
})

test('YOUR STUDIOS: terminated studios are counted, not enumerated', () => {
  const makeTerminated = (i: number) => ({
    studioId: `mat-dead-${i}`, materiaId: `mat-dead-${i}`, label: 'pytorch on RTX 4090',
    status: 'terminated' as const, guestsToday: 0, netImpetus: -10n, netUsd: -0.003,
  })
  const { text, keyboard } = StatusView.render({
    ...empty,
    studios: [
      { studioId: 'mat-live', materiaId: 'mat-live', label: 'flux-v1 on H100', status: 'idle', guestsToday: 0, netImpetus: 0n, netUsd: 0 },
      ...Array.from({ length: 52 }, (_, i) => makeTerminated(i)),
    ],
  })
  assert.match(text, /YOUR STUDIOS \(1\)/, 'header counts live studios only')
  assert.match(text, /flux-v1 on H100 — idle/, 'the live studio still gets its row')
  assert.ok(!text.includes('terminated —'), 'no per-row terminated line')
  assert.match(text, /\(\+52 terminated\)/, 'one terse count line for the rest')
  assert.equal(text.split('\n').filter(l => l.includes('pytorch on RTX 4090')).length, 0,
    'the dead studios never print their own line')
  assert.ok(cb(keyboard).includes('stat:bulletin:mat-live'), 'the live studio keeps its bulletin button')
  assert.ok(!cb(keyboard).some(d => d.startsWith('stat:bulletin:mat-dead')),
    'terminated studios get no bulletin button — nothing to jump to')
})

test('YOUR STUDIOS: all studios terminated still surfaces the count', () => {
  const { text } = StatusView.render({
    ...empty,
    studios: [{
      studioId: 'mat-1', materiaId: 'mat-1', label: 'flux-v1 on H100', status: 'terminated',
      guestsToday: 0, netImpetus: 0n, netUsd: 0,
    }],
  })
  assert.match(text, /\(\+1 terminated\)/)
})

test('JOINABLE: open vs queue depth', () => {
  const { text, keyboard } = StatusView.render({
    ...empty,
    joinable: [
      { studioId: 'mat-3', label: 'sdxl on A100', hostLabel: '@dave', queueDepth: 0 },
      { studioId: 'mat-4', label: 'flux-v1 on H100', hostLabel: '@eve', queueDepth: 4 },
    ],
  })
  assert.match(text, /JOINABLE \(2\)/)
  assert.match(text, /@dave's sdxl on A100 — open/)
  assert.match(text, /@eve's flux-v1 on H100 — 4 in queue/)
  assert.ok(cb(keyboard).includes('stat:join:mat-3'))
  assert.ok(cb(keyboard).includes('stat:join:mat-4'))
})

test('full snapshot: section ordering balance → gens → studios → joinable → footer', () => {
  const { text } = StatusView.render({
    ...empty,
    balanceImpetus: 500n, balanceUsd: 0.17,
    gens: [{ actumId: 'a', modusLabel: 'X', studio: null, status: 'nascens' }],
    studios: [{ studioId: 's', materiaId: 's', label: 'l', status: 'idle', guestsToday: 0, netImpetus: 0n, netUsd: 0 }],
    joinable: [{ studioId: 'j', label: 'k', hostLabel: '@z', queueDepth: 0 }],
  })
  const idxBalance = text.indexOf('Balance:')
  const idxGens    = text.indexOf('YOUR GENS')
  const idxStudios = text.indexOf('YOUR STUDIOS')
  const idxJoin    = text.indexOf('JOINABLE')
  assert.ok(idxBalance < idxGens && idxGens < idxStudios && idxStudios < idxJoin, 'sections in spec order')
})
