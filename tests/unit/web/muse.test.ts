import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGarden,
  curatedFragments,
  flattenGarden,
  poolDatasetFragments,
  rollCurated,
} from '../../../src/platforms/web/app/src/lib/muse.js'
import type { Fragment, DatasetMediaItem } from '../../../src/platforms/web/app/src/lib/api.js'

// ---------------------------------------------------------------------------
// Muse P3 (noema-229) — the pure module Muse.tsx calls: dataset-wide pooling,
// curation, and rolling. The screen itself is typecheck-only (Trap #3); the
// correctness-worth-having lives here.
//
// Fixtures are invented throughout (`m-…`, `moodboard-…`).
// ---------------------------------------------------------------------------

function frag(category: Fragment['category'], text: string, source = 'moodboard-1', trigger = ''): Fragment {
  return { category, text, source, trigger }
}

function item(id: string, fragments: Fragment[] = []): DatasetMediaItem {
  return { id, url: `https://r2.example/${id}.png`, source: 'upload', addedAt: '2026-01-01T00:00:00.000Z', fragments }
}

// ---------------------------------------------------------------------------
// Non-vacuity 1 — an unchecked chip cannot appear in a subsequent roll
// ---------------------------------------------------------------------------

test('rollCurated: an unchecked chip cannot appear in a subsequent roll', () => {
  const fragments = [
    frag('subject', 'a fox', 'm-1'),
    frag('setting', 'a foggy harbor', 'm-1'),
  ]
  const report = rollCurated(fragments, new Set([0]), 3)

  assert.ok(report.rolls.length > 0, 'rolling produced rolls')
  for (const roll of report.rolls) {
    assert.ok(
      !roll.fragments.some((f) => f.text === 'a fox'),
      'the excluded fragment never appears in a rolled fragment set',
    )
  }
})

// ---------------------------------------------------------------------------
// Non-vacuity 2 — the garden pools fragments across every media item in the dataset
// ---------------------------------------------------------------------------

test('poolDatasetFragments + buildGarden: the garden pools fragments across every media item in the dataset', () => {
  const media = [
    item('m-1', [frag('subject', 'a fox', 'm-1')]),
    item('m-2', [frag('setting', 'a foggy harbor', 'm-2')]),
    item('m-3', [frag('mood', 'wistful', 'm-3')]),
  ]

  const pooled = poolDatasetFragments(media)
  assert.equal(pooled.length, 3, 'every item\'s fragments are in the pool, not just one item\'s')

  const { garden, kept } = buildGarden(pooled)
  assert.equal(kept, 3)
  assert.equal(garden.subject?.[0]?.text, 'a fox')
  assert.equal(garden.setting?.[0]?.text, 'a foggy harbor')
  assert.equal(garden.mood?.[0]?.text, 'wistful')

  // per-item pooling (the regression this guards against) would build a garden from
  // one item alone — confirm the flattened garden actually reflects all three sources.
  const sources = flattenGarden(garden).map((f) => f.source).sort()
  assert.deepEqual(sources, ['m-1', 'm-2', 'm-3'])
})

// ---------------------------------------------------------------------------
// Non-vacuity 3 — a dataset with no decomposed items shows the run-a-decompose call
// to action, not an error and not an empty roll
// ---------------------------------------------------------------------------

test('buildGarden: a dataset with no decomposed items yields an empty garden (the CTA branch), not a throw', () => {
  const media = [item('m-1'), item('m-2', [])]
  const pooled = poolDatasetFragments(media)
  assert.equal(pooled.length, 0)

  const { garden, kept } = buildGarden(pooled)
  assert.equal(kept, 0, 'nothing is pooled — this is the signal Muse.tsx branches the empty-state CTA on')
  assert.deepEqual(flattenGarden(garden), [], 'an empty garden never produces a roll to render')
})

// ---------------------------------------------------------------------------
// curatedFragments — shared with Dataset.tsx (noema-221); re-tested here against the
// dataset-wide pool it now also serves.
// ---------------------------------------------------------------------------

test('curatedFragments: excludes exactly the indices passed, nothing more or less', () => {
  const fragments = [frag('subject', 'a fox'), frag('hair', 'braided'), frag('mood', 'wistful')]
  assert.deepEqual(curatedFragments(fragments, new Set()), fragments)
  assert.deepEqual(curatedFragments(fragments, new Set([1])), [fragments[0], fragments[2]])
  assert.deepEqual(curatedFragments(fragments, new Set([0, 1, 2])), [])
})
