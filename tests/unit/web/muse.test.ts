import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  admitPiece,
  applyRunResult,
  buildGarden,
  canFireOne,
  curatedFragments,
  flattenGarden,
  ignitionBlockReason,
  ignitionRequest,
  lineageOf,
  poolDatasetFragments,
  releasePending,
  rollCurated,
  streamColumns,
  streamPiece,
  t2iFlows,
  EMPTY_STREAM,
  EXPANDED_GESTURES,
  STREAM_MAX_COLUMNS,
  STREAM_MIN_COLUMNS,
  TILE_GESTURES,
  type StreamPiece,
} from '../../../src/platforms/web/app/src/lib/muse.js'
import {
  canFireDecompose,
  canOfferDecompose,
  decomposeCaptionsetId,
  decomposeRunRequest,
} from '../../../src/platforms/web/app/src/lib/training.js'
import {
  dismissFromStream,
  floorCounts,
  floorDisabledIndices,
  floorSheet,
  floorToggle,
  latestSession,
  manualAddError,
  manualAddRequest,
  mergedExclusions,
  pieceLineage,
  pieceRecord,
  reactionOf,
  savedOf,
  sessionFromView,
  steerWeight,
  weightWrites,
  MANUAL_CATEGORIES,
} from '../../../src/platforms/web/app/src/lib/muse.js'
import {
  impetusTotal,
  launchBlockReason,
  launchLabel,
  nextPieceDecision,
  rollAt,
  stopLabel,
  streamStatusLine,
  MAX_CONSECUTIVE_ERRORS,
  type LaunchState,
  type StreamConfig,
  type StreamDecisionInput,
} from '../../../src/platforms/web/app/src/lib/muse.js'
import { CATEGORIES, fragmentKey } from '../../../src/crystal/muse/taxonomy.js'
import { WEIGHT_MAX, WEIGHT_MIN } from '../../../src/crystal/muse/sampler.js'
import type {
  Fragment,
  DatasetMediaItem,
  FlowSummary,
  MuseFloorEntry,
  MusePiece,
  MuseSessionView,
} from '../../../src/platforms/web/app/src/lib/api.js'

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

// Non-vacuity 2 — the manual card's single fire

test('canFireOne: a manual card fires only a real prompt at a flow that can take one', () => {
  const prompt = 'a fox in a foggy harbor'

  assert.equal(canFireOne('flow-t2i', prompt, null), true, 'a chosen flow and text → armed')
  assert.equal(canFireOne(null, prompt, null), false, 'no flow chosen → never armed')
  assert.equal(canFireOne('flow-t2i', '   ', null), false, 'an empty prompt never arms')
  assert.equal(canFireOne('flow-t2i', prompt, 'needs an input image'), false, 'a refused flow never arms')
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

// ---------------------------------------------------------------------------
// The stream (noema-238) — where a fired piece lands. Before this, ignition ended
// at a run id and a link to the run view, so seeing the piece meant leaving Muse.
// The screen itself stays typecheck-only (Trap #3); the rules the grid follows are
// pure functions and are gated here.
//
// Fixtures are invented throughout (`run-…`, `https://r2.example/…`).
// ---------------------------------------------------------------------------

function piece(runId: string, lineage: Fragment[] = [frag('subject', 'a fox')]): StreamPiece {
  return streamPiece(runId, 'a fox in a foggy harbor', lineage)
}

// Non-vacuity 1 — the piece comes home

test('applyRunResult: a fired piece appears in Muse without leaving the screen', () => {
  const fired = admitPiece(EMPTY_STREAM, piece('run-1'), false)
  assert.equal(fired.pieces.length, 1, 'firing puts the piece in the stream on this screen')
  assert.equal(fired.pieces[0]!.status, 'running')
  assert.equal(fired.pieces[0]!.media, null, 'nothing to show until the run returns')

  // the run finishes: its produced image is folded into the piece already on screen,
  // which is the whole result path — no navigation, no second surface.
  const done = applyRunResult(fired, 'run-1', {
    terminal: 'complete',
    exitus: { image: 'https://r2.example/piece-1.png' },
  })
  assert.equal(done.pieces[0]!.status, 'ready')
  assert.equal(done.pieces[0]!.media?.url, 'https://r2.example/piece-1.png')
  assert.equal(done.pieces[0]!.media?.kind, 'image')

  // a run that is not terminal yet changes nothing, and a failure is carried as a
  // failure rather than as an empty tile that never resolves
  assert.equal(applyRunResult(fired, 'run-1', { terminal: null }), fired)
  const failed = applyRunResult(fired, 'run-1', { terminal: 'failed', error: 'the pod went away' })
  assert.equal(failed.pieces[0]!.status, 'failed')
  assert.equal(failed.pieces[0]!.error, 'the pod went away')

  // and a result only ever lands on the piece whose run produced it
  const two = admitPiece(fired, piece('run-2'), false)
  const one = applyRunResult(two, 'run-2', { terminal: 'complete', exitus: { image: 'https://r2.example/piece-2.png' } })
  assert.equal(one.pieces.find((p) => p.runId === 'run-1')!.media, null)
  assert.equal(one.pieces.find((p) => p.runId === 'run-2')!.media?.url, 'https://r2.example/piece-2.png')
})

// Non-vacuity 2 — the stream is a grid, not a column

test('streamColumns: the stream lays out more than one piece per row', () => {
  // two columns on a ~322px phone (S14 phone-first, S15 tiles not one piece a page)
  assert.equal(streamColumns(322), 2)
  assert.ok(streamColumns(322) >= STREAM_MIN_COLUMNS)

  // the floor holds even when the measured width is nonsense or not yet known —
  // a stream that renders one tile per row leaves the user scrolling behind the output
  assert.equal(streamColumns(0), 2)
  assert.equal(streamColumns(100), 2)
  assert.equal(streamColumns(Number.NaN), 2)

  // and it widens with the viewport rather than growing the tiles without limit
  assert.ok(streamColumns(900) > streamColumns(322), 'a wider grid fits more tiles per row')
  assert.equal(streamColumns(10_000), STREAM_MAX_COLUMNS)
})

// Non-vacuity 3 — a piece arriving must never move the tile under a thumb

test('admitPiece: a piece arriving while the user is scrolled away does not move the tile under their thumb', () => {
  const seen = admitPiece(admitPiece(EMPTY_STREAM, piece('run-1'), false), piece('run-2'), false)
  assert.deepEqual(seen.pieces.map((p) => p.runId), ['run-2', 'run-1'], 'at the head, new pieces insert at the top')

  // scrolled away: the grid on screen is untouched and the new piece waits
  const held = admitPiece(seen, piece('run-3'), true)
  assert.deepEqual(held.pieces.map((p) => p.runId), ['run-2', 'run-1'], 'not one tile moved')
  assert.equal(held.pieces, seen.pieces, 'the rendered list is the same list, so nothing re-orders')
  assert.deepEqual(held.pending.map((p) => p.runId), ['run-3'])

  const held2 = admitPiece(held, piece('run-4'), true)
  assert.deepEqual(held2.pieces.map((p) => p.runId), ['run-2', 'run-1'])
  assert.equal(held2.pending.length, 2, 'the "N new" pill counts what is waiting')

  // the pill lets them through, newest first, and only when the user asks
  const released = releasePending(held2)
  assert.deepEqual(released.pieces.map((p) => p.runId), ['run-4', 'run-3', 'run-2', 'run-1'])
  assert.equal(released.pending.length, 0)
  assert.equal(releasePending(released), released, 'releasing nothing is a no-op')

  // a held piece still resolves — it is generating on a pod that is already paid for
  const heldDone = applyRunResult(held2, 'run-3', { terminal: 'complete', exitus: { image: 'https://r2.example/held.png' } })
  assert.equal(heldDone.pending.find((p) => p.runId === 'run-3')!.media?.url, 'https://r2.example/held.png')
})

// Non-vacuity 4 — the expanded view explains the piece

test('lineageOf: the expanded view names the fragments that produced the piece', () => {
  const p = piece('run-1', [
    frag('style', 'in ink wash', 'm-2', 'inkwash'),
    frag('subject', 'a fox', 'm-1'),
    frag('setting', 'a foggy harbor', 'm-1'),
    frag('subject', 'a fox', 'm-3'), // the same fragment drawn twice reads once
  ])

  const lineage = lineageOf(p)
  assert.deepEqual(lineage.map((f) => f.text), ['a fox', 'a foggy harbor', 'in ink wash'],
    'every producing fragment is named, de-duplicated, in category order')
  assert.deepEqual(lineage.map((f) => f.category), ['subject', 'setting', 'style'])
  assert.equal(lineage.find((f) => f.text === 'in ink wash')!.trigger, 'inkwash',
    'a fragment carrying a trigger word says so')

  // a piece fired from a roll carries that roll's fragments, not a later roll's
  const rolled = rollCurated([frag('subject', 'a fox'), frag('mood', 'wistful')], new Set(), 1)
  const fromRoll = streamPiece('run-2', rolled.rolls[0]!.prompt, rolled.rolls[0]!.fragments)
  assert.deepEqual(
    lineageOf(fromRoll).map((f) => f.text).sort(),
    rolled.rolls[0]!.fragments.map((f) => f.text).sort(),
  )
})

// The gestures a tile carries: the two steers plus declutter, and nothing more (V8a) —
// ~145px of tile fits about three targets legibly, and a mis-tap here writes a steer.

test('TILE_GESTURES: the tile carries exactly the three gestures made while scrolling', () => {
  assert.deepEqual(TILE_GESTURES.map((g) => g.key), ['up', 'down', 'dismiss'])
  // the considered acts live in the expanded view, on top of the tile's three
  assert.deepEqual(EXPANDED_GESTURES.map((g) => g.key), ['up', 'down', 'dismiss', 'laugh', 'save'])
  for (const g of EXPANDED_GESTURES) assert.ok(g.glyph.length > 0 && g.label.length > 0)
})

// ---------------------------------------------------------------------------
// The floor sheet and live reactions (noema-241) — the session the gestures write
// to. The floor lives on the server: the screen resumes into its most recent
// session off the dataset, every mutator returns the whole session back, and the
// sheet renders from that. The screen stays typecheck-only (Trap #3); the rules
// are pure functions here.
//
// Fixtures are invented throughout (`ses-…`, `run-…`, `ds-…`).
// ---------------------------------------------------------------------------

function entry(f: Fragment, patch: Partial<Omit<MuseFloorEntry, 'key'>> = {}): MuseFloorEntry {
  return { key: fragmentKey(f), enabled: true, weight: 1, ...patch }
}

function ledgerPiece(runId: string, fragments: Fragment[], patch: Partial<MusePiece> = {}): MusePiece {
  return { runId, rollIndex: 0, fragments, saved: false, dismissed: false, ...patch }
}

function session(
  fragments: Fragment[],
  opts: { id?: string; floor?: MuseFloorEntry[]; pieces?: MusePiece[]; mutatum?: string } = {},
): MuseSessionView {
  return {
    id: opts.id ?? 'ses-1',
    owner: 'anima-1',
    motherDatasetId: 'ds-1',
    fragments,
    floor: opts.floor ?? fragments.map((f) => entry(f)),
    pieces: opts.pieces ?? [],
    natum: '2026-01-01T00:00:00.000Z',
    mutatum: opts.mutatum ?? '2026-01-02T00:00:00.000Z',
  }
}

// Non-vacuity 1 — a heart moves the floor, through the piece's RECORDED lineage

test('weightWrites: hearting a piece weights every fragment in its lineage up', () => {
  const fox = frag('subject', 'a fox')
  const harbor = frag('setting', 'a foggy harbor')
  const unrelated = frag('mood', 'wistful')
  const s = session([fox, harbor, unrelated], { pieces: [ledgerPiece('run-1', [fox, harbor])] })

  const writes = weightWrites(s, 'run-1', 'up')
  assert.deepEqual(
    writes.map((w) => w.fragment),
    [{ category: 'subject', text: 'a fox' }, { category: 'setting', text: 'a foggy harbor' }],
    'every fragment of the lineage is written, named by identity',
  )
  for (const w of writes) assert.ok(w.weight > 1, 'and each one is weighted UP from where the floor had it')
  assert.ok(
    !writes.some((w) => w.fragment.text === 'wistful'),
    'a fragment that did not produce the piece is not touched',
  )

  // 😢 moves the same fragments the other way
  const down = weightWrites(s, 'run-1', 'down')
  assert.deepEqual(down.map((w) => w.fragment.text), ['a fox', 'a foggy harbor'])
  for (const w of down) assert.ok(w.weight < 1)

  // the lineage read is the SESSION's record: a run the ledger holds no entry for has
  // no lineage, so it weights nothing rather than guessing one
  assert.deepEqual(pieceLineage(s, 'run-elsewhere'), [])
  assert.deepEqual(weightWrites(s, 'run-elsewhere', 'up'), [])
  assert.deepEqual(weightWrites(session([fox], { pieces: [ledgerPiece('run-2', [])] }), 'run-2', 'up'), [])

  // each step starts from the weight the floor actually holds, and stays inside the
  // sampler's bounds in both directions
  const steered = session([fox], { floor: [entry(fox, { weight: WEIGHT_MAX })], pieces: [ledgerPiece('run-3', [fox])] })
  assert.equal(weightWrites(steered, 'run-3', 'up')[0]!.weight, WEIGHT_MAX, 'a weight already at the ceiling stays there')
  assert.equal(steerWeight(WEIGHT_MIN, 'down'), WEIGHT_MIN)
  assert.ok(steerWeight(1, 'up') > 1 && steerWeight(1, 'up') <= WEIGHT_MAX)

  // and the recorded piece carries no reaction at fire time — it is attached afterwards
  const record = pieceRecord('run-4', 2, [fox, harbor])
  assert.deepEqual(Object.keys(record).sort(), ['fragments', 'rollIndex', 'runId'])
  assert.deepEqual(record.fragments, [{ category: 'subject', text: 'a fox' }, { category: 'setting', text: 'a foggy harbor' }])
})

// Non-vacuity 2 — a disabled fragment is DARKENED, never removed (S8)

test('floorSheet: a disabled fragment is still shown, dark, and can be tapped back to live', () => {
  const fox = frag('subject', 'a fox')
  const cat = frag('subject', 'a cat')
  const harbor = frag('setting', 'a foggy harbor')
  const s = session([fox, cat, harbor], { floor: [entry(fox), entry(cat, { enabled: false }), entry(harbor, { weight: 4 })] })

  const rows = floorSheet(s)
  const subject = rows.find((r) => r.category === 'subject')!
  assert.deepEqual(subject.fragments.map((p) => p.text), ['a fox', 'a cat'],
    'the fragment a steer turned off is STILL on the sheet — hiding it is the silent destruction the floor view exists to prevent')

  const dark = subject.fragments.find((p) => p.text === 'a cat')!
  assert.equal(dark.enabled, false, 'and it is shown as off')
  assert.equal(subject.live, 1)
  assert.equal(subject.total, 2, 'the count says one of two is in the draw, not that one exists')
  assert.deepEqual(floorCounts(s), { live: 2, total: 3 })

  // reversibility: the tap on a dark pill is the tap that brings it back, and it is the
  // same call in both directions
  assert.deepEqual(floorToggle(dark), { fragment: { category: 'subject', text: 'a cat' }, enabled: true })
  assert.deepEqual(floorToggle(subject.fragments[0]!), { fragment: { category: 'subject', text: 'a fox' }, enabled: false })

  // a weighted fragment carries its weight so the sheet can show it
  assert.equal(rows.find((r) => r.category === 'setting')!.fragments[0]!.weight, 4)

  // out of the draw, not gone: a darkened fragment cannot be rolled
  const flat = [fox, cat, harbor]
  assert.deepEqual([...floorDisabledIndices(flat, s)], [1])
  assert.deepEqual([...mergedExclusions(new Set([2]), floorDisabledIndices(flat, s))].sort(), [1, 2])
  const report = rollCurated(flat, floorDisabledIndices(flat, s), 3)
  for (const roll of report.rolls) {
    assert.ok(!roll.fragments.some((f) => f.text === 'a cat'), 'a fragment the steer turned off is not drawn')
  }
  assert.deepEqual([...floorDisabledIndices(flat, null)], [], 'with no session nothing is off the floor')
})

// Non-vacuity 3 — the floor is server-held, so it is still there after a reload

test('latestSession: the floor sheet survives a reload', () => {
  const fox = frag('subject', 'a fox')
  const cat = frag('subject', 'a cat')

  // what a reload does: the route carries no session segment, so the screen looks its
  // sessions up by dataset and resumes into the most recent one rather than spawning a
  // new one. The steer made before the reload is in that session.
  const steered = session([fox, cat], {
    id: 'ses-steered',
    floor: [entry(fox), entry(cat, { enabled: false })],
    mutatum: '2026-01-05T00:00:00.000Z',
  })
  const older = session([fox, cat], { id: 'ses-older', mutatum: '2026-01-03T00:00:00.000Z' })

  const resumed = latestSession([older, steered])!
  assert.equal(resumed.id, 'ses-steered', 'the most recently changed session is the one resumed into')

  const subject = floorSheet(resumed).find((r) => r.category === 'subject')!
  assert.equal(subject.fragments.find((p) => p.text === 'a cat')!.enabled, false,
    'and the floor it renders is the floor the steer left behind')
  assert.equal(subject.live, 1)

  // a dataset with no session yet is the only case that spawns one
  assert.equal(latestSession([]), null)

  // the session read is also what the crystal lineage lookup runs against, floor and all
  const pure = sessionFromView(resumed)
  assert.equal(pure.motherDatasetId, 'ds-1')
  assert.equal(pure.floor.get(fragmentKey(cat))?.enabled, false, 'the floor entries come back as the sampler wants them')
})

// Non-vacuity 4 — 😂 is informational, and ✕ writes nothing to the floor (S4/V9, S12)

test('weightWrites: 😂 records a note and changes no weight', () => {
  const fox = frag('subject', 'a fox')
  const s = session([fox], { pieces: [ledgerPiece('run-1', [fox], { reaction: 'note' })] })

  assert.deepEqual(weightWrites(s, 'run-1', 'note'), [], 'a note never reaches the floor')
  assert.equal(reactionOf(s, 'run-1'), 'note', 'it is recorded on the piece all the same')
  // and the steer channel on the same piece and the same floor does write
  assert.equal(weightWrites(s, 'run-1', 'up').length, 1)

  // ✕ is declutter: the piece leaves the scroll and is counted, and nothing on the floor
  // moves. The count-to-proposal behaviour rides the consent sheet, which is a later rung.
  const stream = admitPiece(admitPiece(EMPTY_STREAM, piece('run-1'), false), piece('run-2'), false)
  const after = dismissFromStream(stream, 'run-2')
  assert.deepEqual(after.pieces.map((p) => p.runId), ['run-1'], 'the dismissed piece leaves the scroll')
  const dismissed = session([fox], { pieces: [ledgerPiece('run-1', [fox], { dismissed: true })] })
  assert.deepEqual(floorSheet(dismissed), floorSheet(session([fox])), 'and the floor is untouched by it')
})

// ---------------------------------------------------------------------------
// The manual add (noema-242) — the free way to widen a narrow floor
//
// A piece is composed from fragments already on the floor, so re-entering one
// reweights the floor without widening it. This form is the un-metered way a floor
// gets a phrase that was not already on it, and free-ness is a product rule, not an
// implementation accident: the metered, LLM-assisted add is a separate surface.
// ---------------------------------------------------------------------------

test('manualAddRequest: a manual add reaches no model and no key', () => {
  const request = manualAddRequest('mood', '  a wet street at dawn  ')

  // The whole payload. A flow id, an aditus, a pinned model or a key would each show
  // up here — compare `ignitionRequest`, which is the metered path and carries a
  // `modusId`. This assertion is what giving the add path a model call breaks.
  assert.deepEqual(Object.keys(request).sort(), ['category', 'text'])
  assert.deepEqual(request, { category: 'mood', text: 'a wet street at dawn' },
    'the request names the fragment and nothing else, at the identity it will be keyed by')

  // And the form offers exactly the taxonomy — no "let the model pick" option rides it.
  assert.deepEqual([...MANUAL_CATEGORIES], [...CATEGORIES])
})

test('manualAddError: a fragment cannot be added outside the taxonomy', () => {
  const fox = frag('subject', 'a fox')
  const s = session([fox])

  assert.ok(manualAddError(s, 'vibe', 'something ineffable'), 'an off-taxonomy category was accepted')
  assert.ok(manualAddError(s, '', 'a fox in a doorway'), 'a fragment with no category was accepted')
  // A category the taxonomy defines, with text, is the case that must be allowed —
  // otherwise the two assertions above would pass on a function that refuses everything.
  assert.equal(manualAddError(s, 'setting', 'a foggy harbor'), null)
  for (const category of CATEGORIES) assert.equal(manualAddError(s, category, 'a phrase not on this floor'), null)

  // A fragment needs text of its own before it can be added.
  assert.ok(manualAddError(s, 'setting', '   '), 'an empty fragment was accepted')
})

test('manualAddError: adding a fragment already on the floor does not duplicate it', () => {
  const fox = frag('subject', 'a fox')
  const cat = frag('subject', 'a cat')
  const s = session([fox, cat], { floor: [entry(fox), entry(cat, { enabled: false })] })

  // `fragmentKey` is the identity, and it trims and folds case: a retype that differs
  // only in spacing or case is the same fragment, not a second one. Two entries under
  // one identity would double that phrase's odds in every roll.
  assert.ok(manualAddError(s, 'subject', 'a fox'), 'a fragment already on the floor was offered as new')
  assert.ok(manualAddError(s, 'subject', '  A Fox  '), 'a retyped identity was offered as new')

  // The same fragment in a different category IS a different fragment.
  assert.equal(manualAddError(s, 'mood', 'a fox'), null)

  // A fragment a steer darkened is still one the floor holds — and the reason says so,
  // because retyping a fragment that was turned off is the case a user lands in most.
  const darkened = manualAddError(s, 'subject', 'a cat')
  assert.ok(darkened && /turned off|tap it/.test(darkened),
    'a darkened fragment was reported as absent rather than as turned off')
})

// ---------------------------------------------------------------------------
// Save-back (noema-245) — what the screen reads to know a piece is in the set

test('savedOf: a saved piece reads as saved off the session, not off the tile', () => {
  const fox = frag('subject', 'a fox');
  const before = session([fox], { pieces: [ledgerPiece('run-1', [fox])] });
  assert.equal(savedOf(before, 'run-1'), false, 'a recorded piece is not saved until it is saved');

  // The session the save returned is the whole session, and the screen re-renders from it —
  // so the flag is the server's record and survives a reload, which a tile-local flag
  // could not. A run the ledger holds no entry for reads as not saved rather than throwing.
  const after = session([fox], { pieces: [ledgerPiece('run-1', [fox], { saved: true })] });
  assert.equal(savedOf(after, 'run-1'), true);
  assert.equal(savedOf(after, 'run-never-rolled'), false);

  // A save says nothing about the floor: it reweights by re-entering the set, it does not
  // widen. The sheet the screen renders is identical before and after.
  assert.deepEqual(floorSheet(after), floorSheet(before), 'a save must not move the floor');
  assert.deepEqual(after.fragments, before.fragments, 'and it adds no fragment');
});

// ---------------------------------------------------------------------------
// The stream's front door (noema-244) — the launch refusal and the loop's decision.
//
// Everything below targets a pure function. That is deliberate: a stream that rides
// until the money runs out has exactly one ceiling, and a ceiling that is only asserted
// through a component is not asserted at all.

const CFG = (over: Partial<StreamConfig> = {}): StreamConfig =>
  ({ mode: 'batched', cap: 12, acknowledged: false, ...over });

const LAUNCH = (over: Partial<LaunchState> = {}): LaunchState => ({
  config: CFG(),
  modusId: 'flow-t2i',
  flowBlockReason: null,
  liveFragments: 9,
  quote: { modusId: 'flow-t2i', impetus: '40' },
  ...over,
});

const DEC = (over: Partial<StreamDecisionInput> = {}): StreamDecisionInput => ({
  mode: 'infinite',
  cap: 12,
  fired: 0,
  inFlight: false,
  balanceImpetus: '100000',
  perPieceImpetus: '40',
  stopRequested: false,
  consecutiveErrors: 0,
  ...over,
});

// ── Proof 1 (MONEY) — the balance is the only ceiling this design has ────────

test("a stream stops with reason 'funds' when the balance is below the next piece's quoted impetus", () => {
  // Comfortably funded: the stream fires.
  assert.deepEqual(nextPieceDecision(DEC({ balanceImpetus: '41', perPieceImpetus: '40' })), { fire: true });
  // Exactly one piece left is still one piece.
  assert.deepEqual(nextPieceDecision(DEC({ balanceImpetus: '40', perPieceImpetus: '40' })), { fire: true });
  // One short is the end of the stream, and it says why.
  assert.deepEqual(
    nextPieceDecision(DEC({ balanceImpetus: '39', perPieceImpetus: '40' })),
    { fire: false, stop: 'funds' },
    'a balance below the next piece stops the stream',
  );
  assert.deepEqual(nextPieceDecision(DEC({ balanceImpetus: '0', perPieceImpetus: '40' })), { fire: false, stop: 'funds' });

  // Impetus figures cross the wire as strings and are compared as integers, never as
  // numbers and never as text: '9' is not more than '100', and a figure past 2^53 is
  // still exact.
  assert.deepEqual(nextPieceDecision(DEC({ balanceImpetus: '9', perPieceImpetus: '100' })), { fire: false, stop: 'funds' });
  assert.deepEqual(
    nextPieceDecision(DEC({ balanceImpetus: '90071992547409930', perPieceImpetus: '90071992547409929' })),
    { fire: true },
  );

  // An unreadable or absent figure reads as zero, so it fails CLOSED — an unpriced
  // stream never fires.
  assert.deepEqual(nextPieceDecision(DEC({ perPieceImpetus: '' })), { fire: true }, 'a zero price is not a refusal');
  assert.deepEqual(
    nextPieceDecision(DEC({ balanceImpetus: 'not a number', perPieceImpetus: '40' })),
    { fire: false, stop: 'funds' },
    'a balance that cannot be read is not one we may spend against',
  );
});

// ── Proof 2 — a batch fires exactly what it was configured to fire ───────────

test("a batched stream of K fires exactly K pieces and then stops with reason 'cap'", () => {
  const K = 7;
  let fired = 0;
  const seen: string[] = [];
  // The loop the screen runs, with the awaits taken out: decide, fire, settle, decide.
  for (let guard = 0; guard < 500; guard++) {
    const d = nextPieceDecision(DEC({ mode: 'batched', cap: K, fired }));
    if (!d.fire) { seen.push(d.stop ?? 'none'); break; }
    fired += 1;
  }
  assert.equal(fired, K, 'a batch of K fires K pieces — not K-1, not K+1');
  assert.deepEqual(seen, ['cap'], 'and it ends because it reached its cap');

  // The cap belongs to batched mode alone: infinite has none, which is the entire
  // reason it needs an acknowledgement and a funds ceiling instead.
  assert.deepEqual(nextPieceDecision(DEC({ mode: 'infinite', cap: 7, fired: 700 })), { fire: true });
});

// ── Proof 3 (V5's disclosure obligation) — the warning is a gate ─────────────

test('infinite mode cannot launch until the runs-until-you-stop-it warning is acknowledged', () => {
  const unacknowledged = LAUNCH({ config: CFG({ mode: 'infinite', acknowledged: false }) });
  assert.notEqual(launchBlockReason(unacknowledged), null, 'infinite launch is refused until it is acknowledged');
  assert.match(String(launchBlockReason(unacknowledged)), /stop it/, 'and the refusal says what is being acknowledged');

  assert.equal(
    launchBlockReason(LAUNCH({ config: CFG({ mode: 'infinite', acknowledged: true }) })),
    null,
    'acknowledged → the control arms',
  );

  // Batched mode carries its own ceiling — the count — so it asks for nothing.
  assert.equal(launchBlockReason(LAUNCH({ config: CFG({ mode: 'batched', acknowledged: false }) })), null);
});

// ── Proof 4 (V7's refusal half) — an empty floor has nothing to make ─────────

test('launch is refused when zero fragments are live on the floor', () => {
  assert.notEqual(launchBlockReason(LAUNCH({ liveFragments: 0 })), null, 'an empty floor refuses launch');
  assert.match(String(launchBlockReason(LAUNCH({ liveFragments: 0 }))), /draw/);

  // A THIN floor is allowed to run. The refusal is emptiness, never thinness.
  assert.equal(launchBlockReason(LAUNCH({ liveFragments: 1 })), null, 'one live fragment is allowed to run');

  // The other three refusals, so the empty-floor assertion is not the only thing holding
  // this function up.
  assert.notEqual(launchBlockReason(LAUNCH({ modusId: null })), null, 'no nozzle chosen → refused');
  assert.equal(
    launchBlockReason(LAUNCH({ flowBlockReason: 'this workflow also needs image — run it from its own card' })),
    'this workflow also needs image — run it from its own card',
    'a flow needing more than a prompt still refuses, and says the same thing it always did',
  );
  assert.notEqual(launchBlockReason(LAUNCH({ quote: null })), null, 'an unpriced stream has no ceiling and cannot launch');
  assert.notEqual(
    launchBlockReason(LAUNCH({ quote: { modusId: 'flow-other', impetus: '40' } })),
    null,
    'a price quoted for another flow does not price this one',
  );
});

// ── Proof 5 — one piece in flight at a time ─────────────────────────────────

test('no second piece is requested while one is still in flight', () => {
  assert.deepEqual(
    nextPieceDecision(DEC({ inFlight: true })),
    { fire: false, stop: null },
    'in flight → do not fire, and the stream is NOT over',
  );
  // Not a stop: the same input with the piece settled fires.
  assert.deepEqual(nextPieceDecision(DEC({ inFlight: false })), { fire: true });

  // A stop pressed mid-piece still wins — the loop finishes the piece already paid for
  // and then ends, rather than ignoring the press until settlement.
  assert.deepEqual(nextPieceDecision(DEC({ inFlight: true, stopRequested: true })), { fire: false, stop: 'user' });
});

// ── The other two ways a stream ends ────────────────────────────────────────

test('a stream stops on a stop press, and on repeated failures', () => {
  assert.deepEqual(nextPieceDecision(DEC({ stopRequested: true })), { fire: false, stop: 'user' });
  // A stop press wins over every other reason, including a cap already reached.
  assert.deepEqual(
    nextPieceDecision(DEC({ mode: 'batched', cap: 3, fired: 3, stopRequested: true })),
    { fire: false, stop: 'user' },
  );

  assert.deepEqual(nextPieceDecision(DEC({ consecutiveErrors: MAX_CONSECUTIVE_ERRORS - 1 })), { fire: true });
  assert.deepEqual(
    nextPieceDecision(DEC({ consecutiveErrors: MAX_CONSECUTIVE_ERRORS })),
    { fire: false, stop: 'errors' },
    'a loop that retried a hard failure forever would spend with no hand on it',
  );
});

// ── The draw: consecutive pieces are different prompts ──────────────────────

test('consecutive stream draws are different rolls', () => {
  const garden = flattenGarden(buildGarden([
    frag('subject', 'a fox'), frag('subject', 'a heron'), frag('subject', 'a stag'),
    frag('setting', 'a foggy harbor'), frag('setting', 'a salt flat'), frag('setting', 'a rope bridge'),
    frag('light', 'low sun'), frag('light', 'overcast noon'), frag('light', 'sodium streetlight'),
  ]).garden);

  const draws = [0, 1, 2, 3].map((i) => rollAt(garden, new Set<number>(), i));
  // The sampler is deterministic by index — which is what makes a recorded rollIndex
  // replayable — so a stream drawing at a fixed index would pay for the same prompt over
  // and over. The index advances, and the prompts differ.
  assert.equal(new Set(draws.map((r) => r.prompt)).size > 1, true, 'an advancing index yields different prompts');
  // And the index is still deterministic: the same index reproduces the same roll.
  assert.deepEqual(rollAt(garden, new Set<number>(), 2).prompt, draws[2]!.prompt);

  // A fragment turned off between pieces is out of the draw for the very next one —
  // this is what makes the floor the steering wheel while a stream is riding.
  const offIdx = garden.findIndex((f) => f.text === 'a fox');
  const steered = [0, 1, 2, 3].map((i) => rollAt(garden, new Set([offIdx]), i));
  assert.equal(steered.some((r) => r.fragments.some((f) => f.text === 'a fox')), false);
});

// ── The readouts: every stop reason renders as words ────────────────────────

test('every stop reason renders as words, including the one nobody chose', () => {
  assert.match(stopLabel('user', 4, 12), /you stopped it/);
  assert.match(stopLabel('funds', 4, 12), /out of funds/);
  assert.match(stopLabel('cap', 12, 12), /12 of 12/);
  assert.match(stopLabel('errors', 2, 12), /failed/);
  // D1's cost, stated: the loop lives in the page, so a page that goes away ends the
  // stream. The readout says so; it never renders a dead stream as a live one.
  assert.match(stopLabel('lost', 4, 12), /the page lost the stream/);

  const cfg = CFG({ mode: 'infinite' });
  const quote = { modusId: 'flow-t2i', impetus: '40' };
  assert.equal(streamStatusLine('idle', null, 0, cfg, quote), 'idle');
  // Infinite mode has no total and no progress bar, so the money is watchable here or
  // nowhere: the pieces fired and the impetus spent ride on every phase.
  assert.match(streamStatusLine('running', null, 3, cfg, quote), /running · 3 pieces · ~120 impetus this stream/);
  assert.match(streamStatusLine('stopping', null, 3, cfg, quote), /stopping after this piece/);
  assert.match(streamStatusLine('stopped', 'funds', 3, cfg, quote), /out of funds · 3 pieces · ~120 impetus/);
  assert.match(streamStatusLine('running', null, 3, CFG({ mode: 'batched', cap: 12 }), quote), /3 of 12/);
});

test('the launch control carries the price, labelled as an estimate', () => {
  const quote = { modusId: 'flow-t2i', impetus: '40' };
  assert.equal(launchLabel(CFG({ mode: 'batched', cap: 12 }), quote), 'launch 12 · ~40 impetus each · ~480 total');
  assert.equal(launchLabel(CFG({ mode: 'infinite' }), quote), 'launch · ~40 impetus each · rides until you stop it');
  // Every figure is a `~`: the quoted number is a reservation the server settles
  // against, and it never becomes the charge.
  assert.equal(launchLabel(CFG({ mode: 'batched', cap: 12 }), quote).includes('~'), true);
  assert.equal(launchLabel(CFG(), null), 'launch', 'an unpriced control shows no number at all');
  assert.equal(impetusTotal('40', 12), '480');
  assert.equal(impetusTotal('40', 0), '0');
});
