import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGarden,
  canFire,
  curatedFragments,
  flattenGarden,
  ignitionBlockReason,
  ignitionRequest,
  poolDatasetFragments,
  rollCurated,
  t2iFlows,
  type IgnitionQuote,
} from '../../../src/platforms/web/app/src/lib/muse.js'
import {
  canFireDecompose,
  canOfferDecompose,
  decomposeCaptionsetId,
  decomposeRunRequest,
} from '../../../src/platforms/web/app/src/lib/training.js'
import type { Fragment, DatasetMediaItem, FlowSummary } from '../../../src/platforms/web/app/src/lib/api.js'

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

// ---------------------------------------------------------------------------
// Muse P4 (noema-230) — ignition. Everything that decides whether, and against
// what, a mined prompt spends. Fixtures invented throughout (`flow-…`).
// ---------------------------------------------------------------------------

function flow(id: string, modusGenus: FlowSummary['modusGenus']): FlowSummary {
  return { id, nomen: id, versio: '1', modusGenus }
}

// Non-vacuity 1 — models are never attached implicitly from the moodboard

test('ignitionRequest: a mined trigger is never lifted into pinnedModels', () => {
  // A roll whose fragments carry trigger words — the shape that tempts an auto-attach.
  const rolled = rollCurated(
    [
      frag('subject', 'a fox', 'm-1', 'foxstyle'),
      frag('style', 'in ink wash', 'm-2', 'inkwash'),
    ],
    new Set(),
    1,
  )
  const roll = rolled.rolls[0]!
  assert.ok(roll.triggers.length > 0, 'the fixture actually carries triggers to lift')

  const req = ignitionRequest('flow-t2i', roll.prompt)

  assert.equal(req.pinnedModels, undefined, 'Muse fires with no pinnedModels, ever')
  assert.deepEqual(Object.keys(req).sort(), ['aditus', 'modusId'], 'the request carries the flow and the prompt and nothing else')
  assert.deepEqual(req.aditus, { prompt: roll.prompt })
  // and nothing smuggles the triggers in under another key
  assert.equal(JSON.stringify(req).includes('foxstyle'), roll.prompt.includes('foxstyle'))
})

// Non-vacuity 2 — the cost is shown before the run is created

test('canFire: the cost is shown before the run is created', () => {
  const prompt = 'a fox in a foggy harbor'

  assert.equal(canFire(null, 'flow-t2i', prompt, null), false, 'no quote → the fire button never arms')

  const quote: IgnitionQuote = { modusId: 'flow-t2i', prompt, impetus: '12' }
  assert.equal(canFire(quote, 'flow-t2i', prompt, null), true, 'quoted for this flow and this text → armed')

  // the quoted number must describe what is on screen now
  assert.equal(canFire(quote, 'flow-t2i', prompt + ', at dusk', null), false, 'an edit after the quote disarms it')
  assert.equal(canFire(quote, 'flow-other', prompt, null), false, 'a quote for another flow does not arm this one')
  assert.equal(canFire(quote, null, prompt, null), false, 'no flow chosen → never armed')
  assert.equal(canFire(quote, 'flow-t2i', prompt, 'needs an input image'), false, 'a refused flow never arms')
  assert.equal(canFire({ modusId: 'flow-t2i', prompt: '   ', impetus: '12' }, 'flow-t2i', '   ', null), false, 'an empty prompt never arms')
})

// Non-vacuity 3 — only t2i can be selected

test('t2iFlows: only a t2i (\'make\') flow can be selected for a mined prompt', () => {
  const flows = [
    flow('flow-t2i', 'make'),
    flow('flow-i2i', 'effect'),
    flow('flow-upscale', 'enhance'),
    flow('flow-video', 'animate'),
    flow('flow-t2i-b', 'make'),
    { id: 'flow-unknown' } as FlowSummary,
  ]
  assert.deepEqual(t2iFlows(flows).map((f) => f.id), ['flow-t2i', 'flow-t2i-b'])
})

// A flow needing more than a prompt is refused before the metered call, not after it

test('ignitionBlockReason: a flow requiring more than a prompt is refused before the run', () => {
  assert.equal(ignitionBlockReason({ input: { type: 'object', required: ['prompt'] } }), null)
  assert.equal(ignitionBlockReason({ input: { type: 'object' } }), null, 'no required inputs is runnable on a prompt alone')

  const reason = ignitionBlockReason({ input: { type: 'object', required: ['prompt', 'image'] } })
  assert.ok(reason && reason.includes('image'), 'the refusal names the input that is missing')
})

// ---------------------------------------------------------------------------
// The decompose rung (noema-235) — the step that fills the garden the tests
// above roll from. The screens (Muse's empty state, Dataset's captionset panel)
// are thin over these; the rules are here.
//
// Fixtures are invented throughout (`ds-…`, `cs-…`).
// ---------------------------------------------------------------------------

function sets(...ids: string[]): { captionsets: Array<{ id: string }> } {
  return { captionsets: ids.map((id) => ({ id })) }
}

// Non-vacuity 1 — the run carries both required ports of the modus

test('decomposeRunRequest: a decompose fires modus.dataset-decompose carrying both dataset and captionset', () => {
  const req = decomposeRunRequest({ datasetId: 'ds-1', captionsetId: 'cs-2' })

  assert.equal(req.modusId, 'modus.dataset-decompose')
  assert.equal(req.aditus.dataset, 'ds-1', 'the dataset port is populated')
  assert.equal(req.aditus.captionset, 'cs-2', 'the captionset port is populated')
  // Both are required on the modus, so a request missing either is refused server-side
  // before any work happens — a rejection the user cannot act on.
  assert.ok(!('trigger' in req.aditus), 'an absent trigger is omitted rather than sent empty')

  const withTrigger = decomposeRunRequest({ datasetId: 'ds-1', captionsetId: 'cs-2', trigger: '  sks  ' })
  assert.equal(withTrigger.aditus.trigger, 'sks', 'a trigger is trimmed and carried')
})

// Non-vacuity 2 — the pass runs over the captionset the user selected

test('decomposeCaptionsetId: a decompose carries the captionset the user actually selected', () => {
  const d = sets('cs-1', 'cs-2', 'cs-3')

  // Neither the first nor the newest — the selected one.
  assert.equal(decomposeCaptionsetId(d, 'cs-2'), 'cs-2')
  assert.equal(decomposeRunRequest({ datasetId: 'ds-1', captionsetId: decomposeCaptionsetId(d, 'cs-2')! }).aditus.captionset, 'cs-2')

  // A selection this dataset does not carry is not fired blind.
  assert.equal(decomposeCaptionsetId(d, 'cs-elsewhere'), 'cs-3', 'an unknown selection falls back to the newest set')
  assert.equal(decomposeCaptionsetId(d, null), 'cs-3', 'with nothing selected the newest set is offered')
})

// Non-vacuity 3 — the action is not offered when there is nothing to decompose

test('canOfferDecompose: the decompose action is not offered on a dataset with zero captionsets', () => {
  assert.equal(canOfferDecompose(sets()), false)
  assert.equal(canOfferDecompose(sets('cs-1')), true)
  assert.equal(decomposeCaptionsetId(sets(), 'cs-1'), null, 'and there is no captionset to fire at')
})

// Non-vacuity 4 — a second pass cannot start while one is in flight (every fire spends)

test('canFireDecompose: a second decompose cannot be fired while one is in flight', () => {
  assert.equal(canFireDecompose({ captionsetId: 'cs-1', inFlight: false }), true)
  assert.equal(canFireDecompose({ captionsetId: 'cs-1', inFlight: true }), false)
  assert.equal(canFireDecompose({ captionsetId: null, inFlight: false }), false)
})
