import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  admitPiece,
  announceTerminal,
  applyRunResult,
  settlePieceResult,
  buildGarden,
  canFireOne,
  chipStates,
  chipToggle,
  curatedFragments,
  flattenGarden,
  ignitionBlockReason,
  ignitionRequest,
  lineageOf,
  poolDatasetFragments,
  promoteBlockReason,
  promoteLabel,
  promotedCollectionPath,
  recordedPiece,
  rehydrateStream,
  releasePending,
  resumePhase,
  rollCurated,
  pieceReadout,
  pieceStageline,
  streamColumns,
  streamPiece,
  STAGE_LABELS,
  TILE_READOUT_MAX,
  t2iFlows,
  terminalOf,
  EMPTY_STREAM,
  EXPANDED_GESTURES,
  REHYDRATE_LIMIT,
  REHYDRATE_ROWS,
  STREAM_MAX_COLUMNS,
  STREAM_MIN_COLUMNS,
  TILE_GESTURES,
  type PieceProgress,
  type RunResult,
  type StreamPiece,
  type StreamState,
  type TerminalPatch,
  type TerminalRun,
} from '../../../src/platforms/web/app/src/lib/muse.js'
import {
  BASE_MODELS,
  DECOMPOSE_IN_FLIGHT_CODE,
  DECOMPOSE_NOTHING_TO_DO_CODE,
  buildTrainingAffinesPayload,
  canFireDecompose,
  canOfferDecompose,
  decomposeCaptionsetId,
  decomposeFailureNote,
  decomposePlanNote,
  decomposeRunRequest,
  decomposeWorkload,
  hydrateTrainingAffines,
} from '../../../src/platforms/web/app/src/lib/training.js'
import {
  appendFailureNote,
  appendMediaRequest,
  captionCoverageLine,
  captionPassLabel,
  captionPassNote,
  captionRunParam,
  withCaptionRunParam,
  decomposeGateReason,
  dismissFromStream,
  floorCounts,
  floorDisabledIndices,
  floorHolds,
  floorSheet,
  floorToggle,
  gestureBlock,
  gestureBlockLine,
  gestureTitle,
  latestSession,
  lineageBlockReason,
  manualAddError,
  manualAddRequest,
  mergedExclusions,
  pieceLineage,
  pieceRecord,
  reactionOf,
  savedOf,
  replaceDataset,
  sessionFromView,
  steerWeight,
  uncaptionedCount,
  weightWrites,
  MANUAL_CATEGORIES,
} from '../../../src/platforms/web/app/src/lib/muse.js'
import {
  ARCHIVE_MEANING,
  ARCHIVE_UNDO_WINDOW_MS,
  archiveStep,
  isArchived,
  liveRecords,
  undoOffer,
  type ArchiveTarget,
} from '../../../src/platforms/web/app/src/lib/muse.js'
import {
  confirmOutcomeNote,
  dismissalOffer,
  droppedNote,
  instructionRemaining,
  proposalPills,
  recordDismissal,
  recordFloorChange,
  steerBlockReason,
  steerFloor,
  steerQuoteRequest,
  writeLabel,
  writesForConfirm,
  DISMISSALS_BEFORE_OFFER,
  MAX_FLOOR_FRAGMENTS,
  MAX_INSTRUCTION_CHARS,
  NO_DISMISSALS,
} from '../../../src/platforms/web/app/src/lib/muse.js'
import {
  impetusTotal,
  launchBlockReason,
  launchLabel,
  nextPieceDecision,
  rollAt,
  stopLabel,
  collapsedControls,
  configSummaryLine,
  runBanner,
  nozzleFoldLine,
  landedPieces,
  ESTIMATE_NOTE,
  nozzleSummaryLine,
  setControlHand,
  steerDockSummaryLine,
  streamStatusLine,
  MAX_CONSECUTIVE_ERRORS,
  type LaunchState,
  type StreamConfig,
  type StreamDecisionInput,
} from '../../../src/platforms/web/app/src/lib/muse.js'
import {
  chooseLora,
  holdLabel,
  isHold,
  loraCatalog,
  loraCatalogReason,
  loraChoiceLine,
  loraChoiceOf,
  loraWarmupNote,
  DEEP_STACK_WARMUP_THRESHOLD,
  loraWeight,
  pinnedModelsFor,
  promptWithTrigger,
  promptWithAffix,
  affixSummaryLine,
  firedRunRequest,
  triggerToken,
  loraStack,
  setLoraWeight,
  nozzleChanged,
  nozzleTriggerLabel,
  LORA_WEIGHT_MAX,
  LORA_WEIGHT_MIN,
  hydrateSetup,
  missingNozzleNote,
  resolveNozzle,
  setupOf,
  DEFAULT_STREAM_CONFIG,
  type LoraChoice,
  type AffixInput,
} from '../../../src/platforms/web/app/src/lib/muse.js'
import {
  entryStampsSession,
  filterSessionHistory,
  matchesSessionQuery,
  sessionCountLine,
  sessionEntry,
  sessionHistory,
  sessionHistoryHref,
  sessionHref,
  keepBlocked,
  keptCount,
  keptRollRequest,
  keptRollsOf,
  sessionRow,
  sessionSearchEmptyNote,
  unreadableRun,
  SESSION_PARAM,
} from '../../../src/platforms/web/app/src/lib/muse.js'
import {
  activityBadgeCount,
  activityDoorHref,
  activityDoorLabel,
  activityKindLabel,
  activityRowLabel,
  partitionActivity,
  partitionHomeActivity,
  AWAITING_YOU_MAX,
} from '../../../src/platforms/web/app/src/lib/muse.js'
import { CATEGORIES, fragmentKey } from '../../../src/crystal/muse/taxonomy.js'
import { WEIGHT_MAX, WEIGHT_MIN } from '../../../src/crystal/muse/sampler.js'
import type {
  ActivityRow,
  Fragment,
  DatasetMediaItem,
  FlowSummary,
  ModelCard,
  MuseFloorEntry,
  MuseKeptRoll,
  MusePiece,
  MuseSessionView,
  MuseSetup,
  MuseSteerProposal,
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

// `inFlight` above is one tab's memory of the pass IT launched — a reload, a second tab, or a
// phone that slept all arm the control again while the first pass is still running. The server
// is what refuses that second pass; these pin how the screen reads the refusal.

test('a refused second pass reads as a running first pass, not as a failure', () => {
  const note = decomposeFailureNote(`409 {"error":{"code":"${DECOMPOSE_IN_FLIGHT_CODE}","message":"..."}}`)
  assert.match(note, /already running on this dataset/)
  assert.doesNotMatch(note, /couldn't decompose/, 'the press was reasonable — this is the status that was missing')
})

test('every other launch failure is still surfaced as a failure, and trimmed', () => {
  assert.match(decomposeFailureNote('502 upstream said no'), /couldn't decompose: 502 upstream said no/)
  assert.ok(decomposeFailureNote('x'.repeat(500)).length < 200)
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
  opts: {
    id?: string; floor?: MuseFloorEntry[]; pieces?: MusePiece[]; mutatum?: string;
    keptRolls?: MuseKeptRoll[];
  } = {},
): MuseSessionView {
  return {
    id: opts.id ?? 'ses-1',
    owner: 'anima-1',
    motherDatasetId: 'ds-1',
    fragments,
    floor: opts.floor ?? fragments.map((f) => entry(f)),
    pieces: opts.pieces ?? [],
    keptRolls: opts.keptRolls ?? [],
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

// noema-320 — the garden chip is a floor write, and its checked-ness is read back off
// the floor. One curation channel: what a chip does, a pill can undo, a promotion carries.

test('chipToggle: unchecking a garden chip writes the floor, and the write names the fragment', () => {
  const fox = frag('subject', 'a fox')
  const cat = frag('subject', 'a cat')
  const harbor = frag('setting', 'a foggy harbor')
  const flat = [fox, cat, harbor]
  const s = session(flat, { floor: [entry(fox), entry(cat, { enabled: false }), entry(harbor)] })

  // an enabled chip's tap turns the fragment OFF, by identity and not by position
  assert.deepEqual(chipToggle(flat, 0, s), { fragment: { category: 'subject', text: 'a fox' }, enabled: false })
  // and it is the same call in both directions — a dark chip's tap brings it back (S8)
  assert.deepEqual(chipToggle(flat, 1, s), { fragment: { category: 'subject', text: 'a cat' }, enabled: true })

  // nothing to write when there is no session yet, or off the end of the garden
  assert.equal(chipToggle(flat, 0, null), null, 'the screen spawns a session before a chip can write one')
  assert.equal(chipToggle(flat, 9, s), null)
})

test('chipStates: chip checked-ness is DERIVED from the session floor, not held beside it', () => {
  const fox = frag('subject', 'a fox')
  const cat = frag('subject', 'a cat')
  const flat = [fox, cat]
  const s = session(flat, { floor: [entry(fox), entry(cat, { enabled: false })] })

  assert.deepEqual(chipStates(flat, s), [true, false],
    'the chip a steer, a pill or another visit darkened comes back dark — the screen holds no second answer')
  assert.deepEqual(chipStates(flat, session(flat)), [true, true])
  assert.deepEqual(chipStates(flat, null), [true, true], 'with no session nothing is out of the draw yet')

  // and the same floor is what a roll draws against, so chip and roll can never disagree
  assert.deepEqual([...floorDisabledIndices(flat, s)], [1])
})

test('chipToggle: one fragment pooled from several media items is one floor key, so its chips move together', () => {
  // the garden pools EVERY item's fragments, so the same phrase can occupy several
  // positions; the floor is keyed by `category:text`, so all of them are one fact
  const foxA = frag('subject', 'a fox', 'moodboard-1')
  const foxB = frag('subject', 'a fox', 'moodboard-2')
  const cat = frag('subject', 'a cat')
  const flat = [foxA, cat, foxB]
  const s = session([foxA, cat], { floor: [entry(foxA), entry(cat)] })

  const write = chipToggle(flat, 0, s)!
  assert.deepEqual(write, { fragment: { category: 'subject', text: 'a fox' }, enabled: false })

  const after = session([foxA, cat], { floor: [entry(foxA, { enabled: false }), entry(cat)] })
  assert.deepEqual(chipStates(flat, after), [false, true, false],
    'both positions of the same fragment are dark — darkening IS the curation, and it is per fragment')
})

test('floorHolds: a chip whose key the floor does not carry is detected rather than lost', () => {
  const fox = frag('subject', 'a fox')
  const newcomer = frag('style', 'chiaroscuro')
  const s = session([fox], { floor: [entry(fox)] })

  assert.equal(floorHolds(s, fox), true)
  assert.equal(floorHolds(s, newcomer), false,
    'a write against a key the floor does not hold leaves the session unchanged, so the caller re-reads and retries')
  assert.equal(floorHolds(null, fox), false)

  // the key is normalized the way the floor writes it, so case and padding still match
  assert.equal(floorHolds(s, { category: 'subject', text: '  A Fox ' }), true)

  // after the reconciling re-read the fragment is on the floor and the write lands
  const reconciled = session([fox, newcomer], { floor: [entry(fox), entry(newcomer)] })
  assert.equal(floorHolds(reconciled, newcomer), true)
  assert.deepEqual(chipToggle([fox, newcomer], 1, reconciled),
    { fragment: { category: 'style', text: 'chiaroscuro' }, enabled: false })
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
    if (!d.fire) { seen.push(('stop' in d ? d.stop : null) ?? 'none'); break; }
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
    frag('lighting', 'low sun'), frag('lighting', 'overcast noon'), frag('lighting', 'sodium streetlight'),
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

// ---------------------------------------------------------------------------
// Adding images to the moodboard (noema-260) — V7's second exit.
//
// The four proofs below are the money-facing half of that chain: what the user is
// told a caption pass will cover BEFORE they spend, when a decompose is refused,
// that an empty selection reaches no route, and that the screen rebuilds from the
// dataset the append returned rather than from the copy it already had.
//
// Fixtures are invented throughout (`m-…`, `moodboard-…`).
// ---------------------------------------------------------------------------

/** A dataset as these readouts need it: media ids and the caption passes over them. */
function set(mediaIds: string[], captionsets: Array<{ id: string; coverage?: string; captions?: Record<string, string> }> = []) {
  return { media: mediaIds.map((id) => ({ id })), captionsets }
}

// ── Non-vacuity 1 — the count the user is shown before spending ─────────────

test('a dataset with 2 media absent from the chosen captionset reports 2 uncaptioned', () => {
  const d = set(['m-1', 'm-2', 'm-3', 'm-4'], [
    { id: 'cs-1', coverage: '2/4', captions: { 'm-1': 'a fox on a rope bridge', 'm-2': 'a heron in fog' } },
  ])

  assert.equal(uncaptionedCount(d, 'cs-1'), 2, 'the two media absent from the pass are the two uncaptioned')
  // The count is over the pass' caption MAP, not over a stored coverage string and not
  // over the media count — a pass whose coverage string disagrees does not move it.
  assert.equal(uncaptionedCount(set(['m-1', 'm-2'], [{ id: 'cs-1', coverage: '9/9', captions: { 'm-1': 'a fox' } }]), 'cs-1'), 1)
  // An empty caption is no caption: it produces no fragment when decomposed.
  assert.equal(uncaptionedCount(set(['m-1'], [{ id: 'cs-1', captions: { 'm-1': '   ' } }]), 'cs-1'), 1)
  // With no pass selected there is nothing to be covered by.
  assert.equal(uncaptionedCount(d, null), 4)

  // And it is rendered as words, with both figures in it, because this is the line the
  // spend is judged against.
  assert.match(captionCoverageLine(d, 'cs-1'), /2 of 4 images have no caption in this pass/)
  assert.match(captionCoverageLine(set(['m-1'], [{ id: 'cs-1', captions: { 'm-1': 'a fox' } }]), 'cs-1'), /all 1 image is captioned/)
})

// ── Non-vacuity 2 — the gate under the readout ─────────────────────────────

test('the decompose control is refused while any appended image is still uncaptioned', () => {
  // Two images appended to a set whose only pass was written before they existed.
  const appended = set(['m-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7', 'm-8', 'm-9'], [
    {
      id: 'cs-1',
      coverage: '7/9',
      captions: Object.fromEntries(['m-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7'].map((id) => [id, `a caption for ${id}`])),
    },
  ])

  const reason = decomposeGateReason(appended, 'cs-1')
  assert.ok(reason, 'a pass that does not cover the appended images refuses the decompose')
  assert.match(reason!, /2 of 9/)
  // The refusal is what the screen arms the button on: a decompose over this pass would
  // mine the older images only, spend a chat call per caption doing it, and return green.
  const armed = canFireDecompose({ captionsetId: 'cs-1', inFlight: false }) && !decomposeGateReason(appended, 'cs-1')
  assert.equal(armed, false)

  // A pass that covers everything is not refused.
  const covered = set(['m-1', 'm-2'], [{ id: 'cs-1', captions: { 'm-1': 'a fox', 'm-2': 'a heron' } }])
  assert.equal(decomposeGateReason(covered, 'cs-1'), null)
  assert.equal(canFireDecompose({ captionsetId: 'cs-1', inFlight: false }) && !decomposeGateReason(covered, 'cs-1'), true)

  // A pass that does not carry its caption map is not refused either: its coverage is
  // not knowable from here, and refusing on an unknown takes a path away rather than
  // preventing a spend.
  assert.equal(decomposeGateReason(set(['m-1', 'm-2'], [{ id: 'cs-1', coverage: '2/2' }]), 'cs-1'), null)
})

// ── Non-vacuity 3 — an empty selection reaches no route ────────────────────

test('appending with no files chosen fires no request', () => {
  assert.equal(appendMediaRequest([]), null, 'no files chosen is no request at all')
  // Whitespace is not a URL: a blank entry must not become an append either. An append
  // of nothing still mints a dataset version and recomputes every pass' coverage
  // denominator over an unchanged set.
  assert.equal(appendMediaRequest(['', '   ']), null)

  assert.deepEqual(
    appendMediaRequest(['https://r2.example/moodboard-8.png', 'https://r2.example/moodboard-9.png']),
    { source: 'upload', mediaUrls: ['https://r2.example/moodboard-8.png', 'https://r2.example/moodboard-9.png'] },
  )
  // A partial batch appends what landed and names what did not.
  assert.deepEqual(appendMediaRequest(['https://r2.example/moodboard-8.png', '']), {
    source: 'upload', mediaUrls: ['https://r2.example/moodboard-8.png'],
  })
  assert.equal(appendFailureNote([]), null)
  assert.match(appendFailureNote(['moodboard-9.png'])!, /moodboard-9\.png/)
})

// ── Non-vacuity 4 — the screen rebuilds from what the append returned ──────

test('the floor is rebuilt from the dataset the append returned, not from the pre-append copy', () => {
  const before = {
    id: 'moodboard-1',
    media: [item('m-1', [frag('subject', 'a fox', 'm-1')])],
    captionsets: [{ id: 'cs-1', coverage: '1/1', captions: { 'm-1': 'a fox' } }],
  }
  const other: typeof before = { id: 'moodboard-2', media: [], captionsets: [] }
  // What the append returned: one version newer, the appended media in it, and the
  // pass' coverage denominator recomputed over the larger set.
  const returned = {
    id: 'moodboard-1',
    media: [...before.media, item('m-2', [frag('setting', 'a foggy harbor', 'm-2')])],
    captionsets: [{ id: 'cs-1', coverage: '1/2', captions: { 'm-1': 'a fox' } }],
  }

  const next = replaceDataset([other, before], returned)
  const entry = next.find((d) => d.id === 'moodboard-1')!
  assert.equal(next.length, 2, 'the other sets in the list are untouched')

  // The garden — and so the floor pooled from it — is built from the RETURNED media.
  const { kept } = buildGarden(poolDatasetFragments(entry.media))
  assert.equal(kept, 2, 'the appended item is in the pooled garden')
  assert.deepEqual(flattenGarden(buildGarden(poolDatasetFragments(entry.media)).garden).map((f) => f.source).sort(), ['m-1', 'm-2'])

  // And the recomputed coverage came back with it — the readout the next decompose is
  // judged against is the server's, not a patched copy of what was on screen.
  assert.equal(uncaptionedCount(entry, 'cs-1'), 1)
  assert.match(captionCoverageLine(entry, 'cs-1'), /1 of 2 images have no caption/)
  assert.ok(decomposeGateReason(entry, 'cs-1'), 'the appended image gates the next decompose')

  // A dataset the list has never seen is added rather than dropped.
  assert.equal(replaceDataset([], returned).length, 1)
  assert.equal(replaceDataset(null, returned)[0]!.id, 'moodboard-1')
})

// ---------------------------------------------------------------------------
// Adding images from the DATASET screen (noema-265).
//
// The panel is one component rendered on two surfaces, so the three rules below are the
// ones that have to hold wherever it is rendered rather than only where it was first
// built. They are proved here, over the pure functions in `lib/muse.ts`, because the
// hermetic web tests run from the repo root and cannot import a `.tsx` file.
//
// Fixtures are invented throughout (`m-…`, `set-…`).
// ---------------------------------------------------------------------------

// ── Non-vacuity 1 — the coverage the append recomputes, and the gate under it ──

test('appending media to a captioned set drops its caption coverage and the decompose control is refused until a caption pass runs', () => {
  // A fully captioned set of seven, and the two images an append added to it. What the
  // append RETURNED is what the screen rebuilds from: the larger media list and the same
  // pass with its coverage denominator recomputed over it.
  const captions = Object.fromEntries(
    ['m-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7'].map((id) => [id, `a caption for ${id}`]),
  )
  const before = { id: 'set-1', media: ['m-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7'].map((id) => ({ id })), captionsets: [{ id: 'cs-1', coverage: '7/7', captions }] }
  const returned = { id: 'set-1', media: [...before.media, { id: 'm-8' }, { id: 'm-9' }], captionsets: [{ id: 'cs-1', coverage: '7/9', captions }] }

  // Before the append the pass covers everything and the decompose is armed.
  assert.equal(uncaptionedCount(before, 'cs-1'), 0)
  assert.equal(decomposeGateReason(before, 'cs-1'), null)
  assert.equal(canFireDecompose({ captionsetId: 'cs-1', inFlight: false }) && !decomposeGateReason(before, 'cs-1'), true)

  // The screen re-reads from the returned dataset, so the coverage it shows moved with the set.
  const entry = replaceDataset([before], returned).find((x) => x.id === 'set-1')!
  assert.equal(uncaptionedCount(entry, 'cs-1'), 2, 'the two appended images are uncaptioned in the existing pass')
  assert.match(captionCoverageLine(entry, 'cs-1'), /2 of 9 images have no caption in this pass/)

  // And the decompose is refused until a pass covers them: over this pass it would mine the
  // seven older captions, spend a chat call each doing it, and come back green.
  const reason = decomposeGateReason(entry, 'cs-1')
  assert.ok(reason, 'a pass written before the appended images refuses the decompose')
  assert.match(reason!, /2 of 9/)
  assert.equal(canFireDecompose({ captionsetId: 'cs-1', inFlight: false }) && !decomposeGateReason(entry, 'cs-1'), false)

  // A pass that does cover the appended images arms it again — the refusal is the gap, not the append.
  const recaptioned = {
    ...entry,
    captionsets: [{ id: 'cs-1', coverage: '9/9', captions: Object.fromEntries(entry.media.map((m) => [m.id, `a caption for ${m.id}`])) }],
  }
  assert.equal(decomposeGateReason(recaptioned, 'cs-1'), null)
  assert.match(captionCoverageLine(recaptioned, 'cs-1'), /all 9 images are captioned/)
})

// ── Non-vacuity 2 — the caption control quotes the set, not the append ────────

test('the caption control quotes the WHOLE set after an append, not the delta', () => {
  const seven = { media: ['m-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7'].map((id) => ({ id })) }
  const nine = { media: [...seven.media, { id: 'm-8' }, { id: 'm-9' }] }

  // Seven captioned images plus two appended is a NINE-image pass. A pass reads the whole
  // set, so quoting the two just added would understate what is about to be billed.
  assert.equal(captionPassLabel(nine), 'Caption all 9 images →')
  assert.match(captionPassNote(nine), /every image in the set, not only the ones just added/)
  assert.match(captionPassNote(nine), /9 images/)
  assert.equal(/\b2 images\b/.test(captionPassLabel(nine) + ' ' + captionPassNote(nine)), false, 'the appended count is never the quoted count')

  // The figure follows the set it is handed, and it is the set AFTER the append.
  assert.equal(captionPassLabel(seven), 'Caption all 7 images →')
  assert.equal(captionPassLabel({ media: [{ id: 'm-1' }] }), 'Caption all 1 image →')
  assert.match(captionPassNote({ media: [{ id: 'm-1' }] }), /1 image ·/)
  assert.match(captionPassNote(nine), /billed like any other run/)
})

// ── noema-321 — the caption run rides the URL ─────────────────────────────────

test('captionRunParam reads a run id off ?run=, and null off anything else', () => {
  assert.equal(captionRunParam(new URLSearchParams('run=run-abc')), 'run-abc')
  assert.equal(captionRunParam(new URLSearchParams('')), null, 'no ?run= at all is no run')
  assert.equal(captionRunParam(new URLSearchParams('run=')), null, 'a bare ?run= with nothing after it is no run')
  assert.equal(captionRunParam(new URLSearchParams('captionset=cs-1')), null, 'a different param is not a run id')
})

// NON-VACUITY 3 — a launch must write the id into the URL. Reverting the write
// (stop calling withCaptionRunParam on launch, or drop it from the writer) must fail.
test('withCaptionRunParam sets ?run= to the id, alongside whatever else was already there', () => {
  const next = withCaptionRunParam(new URLSearchParams('captionset=cs-1'), 'run-xyz')
  assert.equal(next.get('run'), 'run-xyz')
  assert.equal(next.get('captionset'), 'cs-1', 'writing the run id does not disturb an unrelated param')
})

// NON-VACUITY 4 — a mount that reads no run must not invent one, and a clear must
// actually remove the param rather than writing it blank.
test('withCaptionRunParam(…, null) removes ?run= rather than leaving it blank', () => {
  const next = withCaptionRunParam(new URLSearchParams('run=stale-run&captionset=cs-1'), null)
  assert.equal(next.has('run'), false)
  assert.equal(captionRunParam(next), null)
  assert.equal(next.get('captionset'), 'cs-1')
})

test('the write and the read round-trip: what a launch writes, a mount reads back', () => {
  const written = withCaptionRunParam(new URLSearchParams(''), 'run-123')
  assert.equal(captionRunParam(written), 'run-123')
})

// ── Non-vacuity 3 — a partial batch keeps what landed ────────────────────────

test('a batch where some uploads fail appends the ones that succeeded and names the ones that did not', () => {
  // Three files chosen, one of them failed to upload. What landed is still appended.
  const uploaded = ['https://r2.example/set-8.png', 'https://r2.example/set-9.png']
  const failed = ['set-10.png']

  const request = appendMediaRequest(uploaded)
  assert.deepEqual(request, { source: 'upload', mediaUrls: uploaded }, 'the two that landed are appended')
  const note = appendFailureNote(failed)
  assert.ok(note, 'the one that did not is named')
  assert.match(note!, /set-10\.png/)
  assert.match(note!, /1 did not upload/)

  // Several failures are named together, and the plural is right.
  assert.match(appendFailureNote(['set-10.png', 'set-11.png'])!, /2 did not upload and were not added: set-10\.png, set-11\.png/)

  // A batch where NOTHING landed appends nothing at all — there is no request to fire, and
  // the failure is still named rather than swallowed.
  assert.equal(appendMediaRequest([]), null)
  assert.ok(appendFailureNote(['set-8.png', 'set-9.png', 'set-10.png']))
  // And a batch where everything landed has nothing to report.
  assert.equal(appendFailureNote([]), null)
})

// ═══════════════════════════════════════════════════════════════════════════
// The steer keyboard and the consent sheet (noema-261)
//
// Six properties, each of them a ruling rather than a preference, and each held
// by a pure function in `lib/muse.ts` rather than by the screen.
// ═══════════════════════════════════════════════════════════════════════════

const fox = frag('subject', 'a fox')
const harbor = frag('setting', 'a foggy harbor')
const neon = frag('palette', 'neon pink')
const dusk = frag('lighting', 'low dusk light')

/** A proposal as the steer route returns it: eliminations naming fragments the floor
 *  holds, additions naming fragments it does not, and the count of what was dropped. */
function proposal(
  eliminations: Fragment[],
  additions: Fragment[],
  dropped = 0,
): MuseSteerProposal {
  return {
    eliminations: eliminations.map((f) => ({ category: f.category, text: f.text })),
    additions,
    dropped,
  }
}

// ── Non-vacuity 1 — a vetoed pill produces no write ────────────────────────
// The central property of the whole sheet: a veto that still wrote would be silent
// destruction. The user said no and the floor moved anyway.

test('a vetoed pill produces no write', () => {
  const p = proposal([neon, harbor], [dusk])
  const all = writesForConfirm(p, new Set(), 'confirmed')
  assert.equal(all.length, 3, 'with nothing vetoed, every surviving pill is a write')

  // Veto the elimination.
  const vetoElimination = writesForConfirm(p, new Set([fragmentKey(neon)]), 'confirmed')
  assert.equal(vetoElimination.length, 2)
  assert.ok(
    !vetoElimination.some((w) => w.fragment.text === neon.text),
    'a vetoed elimination writes NOTHING — not a disable, not anything else',
  )

  // Veto the addition.
  const vetoAddition = writesForConfirm(p, new Set([fragmentKey(dusk)]), 'confirmed')
  assert.equal(vetoAddition.length, 2)
  assert.ok(!vetoAddition.some((w) => w.fragment.text === dusk.text), 'and a vetoed addition writes nothing either')

  // Veto everything: a sheet rejected pill by pill is a sheet that writes nothing at all,
  // which must be indistinguishable at the floor from Cancel.
  const vetoAll = writesForConfirm(p, new Set([neon, harbor, dusk].map((f) => fragmentKey(f))), 'confirmed')
  assert.deepEqual(vetoAll, [], 'rejecting every pill reaches the floor exactly as Cancel does')
})

// ── Non-vacuity 2 — an elimination is one disable, and never an add ────────

test('a confirmed elimination produces exactly one enabled:false write for that fragment identity, and no fragment-add write', () => {
  const writes = writesForConfirm(proposal([neon], []), new Set(), 'confirmed')
  assert.equal(writes.length, 1, 'one pill, one call')
  assert.deepEqual(writes[0], {
    kind: 'disable',
    fragment: { category: 'palette', text: 'neon pink' },
  })
  assert.ok(!writes.some((w) => w.kind === 'add'), 'an elimination never puts the phrase ON the floor')

  // And the identity is the whole of what the call names — a fragment is named in the
  // BODY by `{category, text}`, never by a key and never in a path.
  assert.deepEqual(Object.keys(writes[0]!.fragment).sort(), ['category', 'text'])

  // The other side is the mirror of it: an addition is exactly one add and no disable.
  const added = writesForConfirm(proposal([], [dusk]), new Set(), 'confirmed')
  assert.deepEqual(added, [{ kind: 'add', fragment: { category: 'lighting', text: 'low dusk light' } }])

  assert.equal(writeLabel(writes[0]!), 'off · palette: neon pink')
})

// ── Non-vacuity 3 — confirm is the cut line ────────────────────────────────
// V2 stated as code. The stream is never paused to read a sheet; what makes that safe is
// that the floor cannot move until the person reading it rules.

test('no floor write is produced before confirm', () => {
  const p = proposal([neon, harbor], [dusk])
  assert.deepEqual(
    writesForConfirm(p, new Set(), 'reviewing'),
    [],
    'a sheet under review writes nothing, however many pills survive its vetoes',
  )
  assert.equal(writesForConfirm(p, new Set(), 'confirmed').length, 3, 'and the same sheet, confirmed, writes them')

  // No proposal is no writes in either phase — there is nothing to have consented to.
  assert.deepEqual(writesForConfirm(null, new Set(), 'confirmed'), [])
  assert.deepEqual(writesForConfirm(null, new Set(), 'reviewing'), [])

  // The pills exist for review either way: rendering a proposal is not applying it.
  assert.equal(proposalPills(p).length, 3)
  assert.deepEqual(proposalPills(p).map((pill) => pill.kind), ['elimination', 'elimination', 'addition'])
  assert.deepEqual(proposalPills(null), [])
})

// ── Non-vacuity 4 — the dropped count is said, never swallowed ─────────────

test('the sheet reports how many suggestions the server dropped', () => {
  assert.equal(droppedNote(0), null, 'nothing dropped is nothing said')
  assert.equal(droppedNote(1), "1 suggestion didn't fit your floor and was dropped")
  assert.match(droppedNote(3)!, /^3 suggestions didn't fit your floor and were dropped$/)

  // The count travels with the proposal and is independent of how many pills survived:
  // a user shown two pills out of five proposed changes must be told about the three.
  const p = proposal([neon], [dusk], 3)
  assert.equal(proposalPills(p).length, 2)
  assert.equal(droppedNote(p.dropped), '3 suggestions didn\'t fit your floor and were dropped')
})

// ── Non-vacuity 5 — the offer is earned again after every floor change ─────

test('the offer does not return until three more dismissals happen after a floor change', () => {
  let state = NO_DISMISSALS
  assert.equal(DISMISSALS_BEFORE_OFFER, 3)

  for (let i = 1; i < DISMISSALS_BEFORE_OFFER; i++) {
    state = recordDismissal(state)
    assert.equal(dismissalOffer(state), null, `${i} dismissals is taste, not a pattern`)
  }
  state = recordDismissal(state)
  assert.ok(dismissalOffer(state), 'three in a row with no floor change between them earns the offer')

  // A floor change — an enable, a weight, an add, a confirmed sheet — resets the count.
  state = recordFloorChange(state)
  assert.equal(dismissalOffer(state), null, 'the floor moved, so the offer is spent')

  // And it has to be earned from zero rather than from one more dismissal.
  state = recordDismissal(state)
  assert.equal(dismissalOffer(state), null)
  state = recordDismissal(state)
  assert.equal(dismissalOffer(state), null)
  state = recordDismissal(state)
  assert.ok(dismissalOffer(state), 'three MORE dismissals, after the floor change')

  // A floor change with no dismissals behind it changes nothing.
  assert.equal(recordFloorChange(NO_DISMISSALS).sinceFloorChange, 0)
})

// ── Non-vacuity 6 — the offer is an offer, and can reach no model ──────────
// V3 forbids the automatic path by name: a metered call that fires as a side effect of
// scrolling past three pieces is a spend nobody chose.

test('the dismissal offer yields an OFFER, never a steer request', () => {
  const offer = dismissalOffer({ sinceFloorChange: DISMISSALS_BEFORE_OFFER })!
  assert.equal(offer.kind, 'offer')
  assert.deepEqual(Object.keys(offer).sort(), ['instruction', 'kind', 'line'])
  assert.ok(offer.line.length > 0, 'it renders as a line the user can ignore')
  assert.ok(offer.instruction.length > 0, 'and it pre-fills the instruction box')

  // Nothing on it can be dispatched: no flow, no aditus, no key, no run request. Compare
  // `steerQuoteRequest` below, which is the metered path and carries a `modusId`.
  for (const forbidden of ['modusId', 'verb', 'aditus', 'maxImpetus', 'pinnedModels']) {
    assert.ok(!(forbidden in offer), `the offer carries no '${forbidden}' — it cannot be sent`)
  }

  // The metered path, for contrast: it is the thing that names a flow, and it is only
  // ever built from an instruction the user wrote and pressed send on.
  const quote = steerQuoteRequest('lose the neon', [{ category: 'palette', text: 'neon pink' }])
  assert.equal(quote.modusId, 'modus.muse-steer')
  assert.deepEqual(quote.aditus.floor, [{ category: 'palette', text: 'neon pink' }])
  assert.equal(quote.aditus.instruction, 'lose the neon')
})

// ── The keyboard's mirrored bounds ─────────────────────────────────────────

test('the keyboard mirrors the server bounds rather than becoming them', () => {
  const s = session([fox, harbor, neon])

  // The floor a steer reads is the floor IN THE DRAW — the same set the route resolves.
  assert.equal(steerFloor(s).length, 3)
  const darkened = session([fox, harbor, neon], {
    floor: [entry(fox), entry(harbor), entry(neon, { enabled: false })],
  })
  assert.deepEqual(steerFloor(darkened).map((f) => f.text), ['a fox', 'a foggy harbor'])
  assert.deepEqual(steerFloor(null), [])

  // An empty box is refused on the form; so is an oversized one, at the server's bound.
  assert.equal(steerBlockReason({ view: s, instruction: '   ', inFlight: false }), 'write what you want changed first')
  assert.match(
    steerBlockReason({ view: s, instruction: 'x'.repeat(MAX_INSTRUCTION_CHARS + 1), inFlight: false })!,
    new RegExp(String(MAX_INSTRUCTION_CHARS)),
  )
  assert.equal(steerBlockReason({ view: s, instruction: 'lose the neon', inFlight: false }), null)
  assert.equal(steerBlockReason({ view: s, instruction: 'lose the neon', inFlight: true }), 'a steer is already running')
  assert.equal(steerBlockReason({ view: null, instruction: 'lose the neon', inFlight: false }), 'no session yet')

  // A floor with nothing in the draw, and a floor above the per-steer cap, are both said
  // on the keyboard rather than discovered as a 400 after a sentence was written.
  const allOff = session([fox], { floor: [entry(fox, { enabled: false })] })
  assert.equal(steerBlockReason({ view: allOff, instruction: 'lose the neon', inFlight: false }), 'nothing is in the draw to steer')
  const huge = session(
    Array.from({ length: MAX_FLOOR_FRAGMENTS + 1 }, (_, i) => frag('mood', `mood ${i}`)),
  )
  assert.match(steerBlockReason({ view: huge, instruction: 'lose the neon', inFlight: false })!, /above the 300/)

  assert.equal(instructionRemaining(''), MAX_INSTRUCTION_CHARS)
  assert.equal(instructionRemaining('  lose the neon  '), MAX_INSTRUCTION_CHARS - 'lose the neon'.length)
  assert.ok(instructionRemaining('x'.repeat(MAX_INSTRUCTION_CHARS + 5)) < 0, 'over the bound reads as negative')
})

// ── A confirm that fails part-way keeps what landed and names the rest ─────

test('a partly-applied sheet says which changes did not land', () => {
  assert.equal(confirmOutcomeNote(3, []), '3 changes applied to the floor.')
  assert.equal(confirmOutcomeNote(1, []), '1 change applied to the floor.')
  const note = confirmOutcomeNote(2, ['off · palette: neon pink (network error)'])
  assert.match(note, /^2 changes applied to the floor/, 'what landed stays landed and is counted')
  assert.match(note, /neon pink/, 'and what did not is named rather than dropped silently')
})

// ---------------------------------------------------------------------------
// The nozzle and the holding state (noema-246) — S5 and S6.
//
// The distinction every test below turns on: A FLOOR CHANGE NEVER STOPS THE STREAM, A
// NOZZLE CHANGE ALWAYS DOES. A floor edit only changes which fragments the next draw may
// pull, so pieces arriving meanwhile are still pieces the user asked for. A model change
// changes what makes them: pieces fired while a model is being chosen come out of the old
// nozzle, cost full price, and are exactly the ones the user was about to stop wanting.
//
// Fixtures are invented throughout (`sample-lora`, `trigword`).
// ---------------------------------------------------------------------------

function card(over: Partial<ModelCard> = {}): ModelCard {
  return {
    intellaId: 'lora-1',
    nomen: 'sample-lora',
    genus: 'lora',
    basis: 'base-a',
    trigger: 'trigword',
    access: 'public',
    ...over,
  }
}

const CHOICE = (over: Partial<LoraChoice> = {}): LoraChoice => ({
  intellaId: 'lora-1', nomen: 'sample-lora', trigger: 'trigword', weight: null, ...over,
})

// ── Proof — a nozzle change holds the stream ────────────────────────────────

test('an uncommitted nozzle change holds the stream instead of firing the next piece', () => {
  const held = nextPieceDecision(DEC({ hold: { reason: 'picking' } }))
  assert.deepEqual(held, { fire: false, hold: { reason: 'picking' } })
  assert.equal(isHold(held), true)
  assert.equal(held.fire, false, 'nothing is fired under a nozzle nobody has finished choosing')

  // The same input with nothing being chosen fires — so the hold is what refused it, and
  // not one of the other refusals standing in.
  assert.deepEqual(nextPieceDecision(DEC()), { fire: true })
  assert.deepEqual(nextPieceDecision(DEC({ hold: null })), { fire: true })

  // Committing is what releases it, and a commit that is still taking up the weights is
  // still a hold: the loop may not fire under a nozzle that is only half applied.
  const loading = nextPieceDecision(DEC({ hold: { reason: 'loading', trigger: 'trigword' } }))
  assert.equal(isHold(loading), true)
  assert.match(holdLabel({ reason: 'loading', trigger: 'trigword' }), /loading trigword/)
  assert.match(holdLabel({ reason: 'picking' }), /choosing a model/)
})

// ── Proof — a hold is not a stop, and this is the one most likely to rot ────
//
// A hold implemented as a stop looks identical on screen for the first second and is a
// different product by the second one: the fired count restarts, the cap is spent, and
// "resume" becomes "launch again".

test('a hold is NOT a stop: the fired count, the cap and the run mode all survive it, and the stream resumes without a relaunch', () => {
  const mid = DEC({ mode: 'batched', cap: 12, fired: 7, hold: { reason: 'picking' } })
  const held = nextPieceDecision(mid)

  // It is not a stop, in the shape of the value itself: no `stop` at all, so a loop that
  // reads `decision.stop` finds nothing terminal to break on.
  assert.equal(isHold(held), true)
  assert.equal('stop' in held, false, 'a hold carries no stop reason, because it is not an ending')

  // Everything the stream was carrying is still what it is carrying: releasing the hold —
  // and changing NOTHING else — fires the eighth piece of the same batch of twelve.
  const resumed = nextPieceDecision({ ...mid, hold: null })
  assert.deepEqual(resumed, { fire: true }, 'the stream resumes rather than relaunching')
  const stillBatched = nextPieceDecision({ ...mid, hold: null, fired: 12 })
  assert.deepEqual(stillBatched, { fire: false, stop: 'cap' }, 'the cap and the run mode came through the hold intact')

  // The hold sits ABOVE the error, cap and funds checks, so a nozzle change can never be
  // converted into a terminal stop on the way past one of them.
  assert.equal(isHold(nextPieceDecision({ ...mid, fired: 12 })), true, 'a hold at the cap is still a hold')
  assert.equal(isHold(nextPieceDecision({ ...mid, balanceImpetus: '0' })), true)
  assert.equal(isHold(nextPieceDecision({ ...mid, consecutiveErrors: MAX_CONSECUTIVE_ERRORS })), true)

  // A stop pressed DURING a hold is still a stop — the user outranks the nozzle.
  assert.deepEqual(
    nextPieceDecision({ ...mid, stopRequested: true }),
    { fire: false, stop: 'user' },
  )

  // And the readout says a wait, never an ending: the count and the spend are shown
  // unchanged, which is precisely what a stop would have reset.
  const line = streamStatusLine('holding', null, 7, CFG({ mode: 'batched', cap: 12 }), { modusId: 'flow-t2i', impetus: '40' }, { reason: 'picking' })
  assert.match(line, /holding — choosing a model/)
  assert.match(line, /7 pieces/, 'the fired count survives the hold and is shown')
  assert.match(line, /~280 impetus this stream/, 'so does the spend')
  assert.equal(/stopped/.test(line), false, 'a hold is never presented as a stop')
  assert.match(
    streamStatusLine('holding', null, 2, CFG(), null, { reason: 'loading', trigger: 'trigword' }),
    /holding — loading trigword/,
  )
})

// ── Proof — the trigger word rides the prompt (without it: full price, no effect) ──

test('a piece fired under a LoRA carries that LoRA\'s trigger word in its prompt', () => {
  const drawn = 'a fox, a foggy harbor, low sun'
  const withLora = promptWithTrigger(drawn, CHOICE())
  assert.match(withLora, /trigword/, 'the trigger is in the prompt the resolver reads')
  assert.match(withLora, /a foggy harbor/, 'and the drawn prompt is still all there')
  assert.equal(promptWithTrigger(drawn, null), drawn, 'no model chosen, no change to the prompt')

  // The request fired for a stream piece carries it too — this is the string that reaches
  // `loraResolver`, and without the trigger in it the pinned weights are downloaded and
  // never applied.
  const request = firedRunRequest('flow-t2i', drawn, CHOICE())
  assert.match(String(request.aditus.prompt), /trigword/)

  // The two forms this emits are the resolver's own: a bare trigger fires at the LoRA's
  // `defaultWeight`, and `trigger:N` is an explicit override. Nothing else is generated —
  // the `!`/`.` modifiers and the `<lora:…>` tag form stay the resolver's.
  assert.equal(triggerToken(CHOICE()), 'trigword')
  assert.equal(triggerToken(CHOICE({ weight: 0.8 })), 'trigword:0.8')
  assert.equal(loraWeight(null), null)
  assert.equal(loraWeight(9), LORA_WEIGHT_MAX)
  assert.equal(loraWeight(0), LORA_WEIGHT_MIN, 'the control never emits the weight that silences a pinned LoRA')

  // AND IT IS NOT A FLOOR FRAGMENT. The trigger goes into the prompt string only: it is
  // not in the lineage a piece records, so a ♡ can never reweight the nozzle.
  const lineage = [frag('subject', 'a fox'), frag('setting', 'a foggy harbor')]
  const record = pieceRecord('run-1', 3, lineage)
  assert.equal(record.fragments.some((f) => f.text.includes('trigword')), false)
  assert.equal(lineageOf({ lineage }).some((e) => e.text.includes('trigword')), false)
})

// ── Proof — the weights are pinned (without them: a trigger naming nothing) ──

test('a piece fired under a LoRA names it in pinnedModels', () => {
  const request = firedRunRequest('flow-t2i', 'a fox', CHOICE())
  assert.deepEqual(request.pinnedModels, ['lora-1'], 'pinned by intellaId — the unambiguous half of the field')
  assert.equal(request.modusId, 'flow-t2i')
  assert.deepEqual(pinnedModelsFor(null), [])

  // No model chosen, nothing pinned — and a mined fragment's own trigger is STILL never
  // lifted into `pinnedModels`. Only what the user picked on the control is pinned.
  assert.equal('pinnedModels' in firedRunRequest('flow-t2i', 'a fox', null), false)
  assert.equal('pinnedModels' in ignitionRequest('flow-t2i', 'a fox'), false)

  // Both halves or neither: the pinned run is also the one carrying the trigger.
  assert.match(String(request.aditus.prompt), /trigword/)
})

// ═══════════════════════════════════════════════════════════════════════════
// THE STANDING AFFIX (noema-284) — set once, riding blanket like the model, until
// changed. Not a steer: no floor write, no quote, and gone on reload.
// ═══════════════════════════════════════════════════════════════════════════

const AFFIX = (over: Partial<AffixInput> = {}): AffixInput => ({
  prefix: 'a photograph of',
  suffix: 'shot on film',
  ...over,
})

// Non-vacuity 1/2 — both paths carry it

test('a fired piece carries the standing prefix and suffix', () => {
  const drawn = 'a fox, a foggy harbor'
  const affix = AFFIX()

  // The STREAM path fires through `firedRunRequest` (`Muse.tsx`'s stream loop).
  const streamed = firedRunRequest('flow-t2i', drawn, CHOICE(), affix)
  assert.match(String(streamed.aditus.prompt), /a photograph of/, 'stream: the prefix rides')
  assert.match(String(streamed.aditus.prompt), /shot on film/, 'stream: the suffix rides')

  // The MANUAL path fires through the same `firedRunRequest` (`Muse.tsx#doFire`), and
  // still carries the affix when nothing is on the nozzle.
  const manualFired = firedRunRequest('flow-t2i', drawn, null, affix)
  assert.match(String(manualFired.aditus.prompt), /a photograph of/, 'manual: the prefix rides')
  assert.match(String(manualFired.aditus.prompt), /shot on film/, 'manual: the suffix rides')
})

// Non-vacuity 3 — the trigger-token invariant survives an affix riding alongside it

test('every LoRA trigger token is still present, exactly once, and still leads the prompt, with an affix riding', () => {
  const stack = stacked(card(), SECOND)
  const affix = AFFIX()
  const composed = promptWithAffix('a fox', stack, affix)

  assert.match(composed, /^trigword, othertrig/, 'the trigger tokens still lead the prompt, ahead of the affix')
  assert.match(composed, /a photograph of/, 'the prefix rides too, right after the tokens')
  assert.match(composed, /shot on film$/, 'the suffix trails everything')
  assert.equal((composed.match(/trigword/g) ?? []).length, 1, 'the trigger appears exactly once')
  assert.equal((composed.match(/othertrig/g) ?? []).length, 1)

  // Both halves still reach the actual run request — pinning is untouched by the affix.
  const request = firedRunRequest('flow-t2i', 'a fox', stack, affix)
  assert.deepEqual(request.pinnedModels, ['lora-1', 'lora-2'])
  assert.match(String(request.aditus.prompt), /^trigword, othertrig/)
})

// Non-vacuity 4 — empty means untouched

test('an empty prefix and suffix leave the prompt byte-identical', () => {
  const drawn = ' a fox,  a foggy harbor '
  assert.equal(promptWithAffix(drawn, null, undefined), drawn, 'no affix object at all: byte-identical to the input')
  assert.equal(promptWithAffix(drawn, null, {}), promptWithTrigger(drawn, null))
  assert.equal(
    promptWithAffix(drawn, null, { prefix: '  ', suffix: '' }),
    drawn,
    'whitespace-only fields count as empty',
  )

  // With a nozzle chosen, an empty affix matches the pre-existing trigger-only
  // composition exactly — not one stray comma or space added.
  const stack = CHOICE()
  assert.equal(promptWithAffix('a fox', stack, {}), promptWithTrigger('a fox', stack))
  assert.equal('pinnedModels' in firedRunRequest('flow-t2i', 'a fox', stack, {}), true)
  assert.deepEqual(firedRunRequest('flow-t2i', 'a fox', stack, {}), firedRunRequest('flow-t2i', 'a fox', stack))

  // The collapsed nozzle line says nothing extra when nothing is set.
  assert.equal(affixSummaryLine(undefined), undefined)
  assert.equal(affixSummaryLine({}), undefined)
  assert.equal(affixSummaryLine({ prefix: '  ', suffix: '  ' }), undefined)
})

test('the collapsed nozzle line names the standing affix when one is set', () => {
  const stack = CHOICE()
  const affix = AFFIX()
  const line = nozzleSummaryLine(stack, affix)
  assert.match(line, /trigword/, 'the model is still named')
  assert.match(line, /prefix/i)
  assert.match(line, /a photograph of/)
  assert.match(line, /suffix/i)
  assert.match(line, /shot on film/)

  // No affix at all: the line reads exactly as it did before this item.
  assert.equal(nozzleSummaryLine(stack), nozzleSummaryLine(stack, {}))
  assert.equal(nozzleSummaryLine(stack, undefined), nozzleSummaryLine(stack))

  // A long field is abbreviated on the collapsed line, not dumped in full.
  const long = AFFIX({ prefix: 'x'.repeat(80) })
  const longLine = nozzleSummaryLine(stack, long)
  assert.ok(longLine.length < 200, 'the affix clause is abbreviated, not dumped in full')
  assert.match(longLine, /…/)
})

// ═══════════════════════════════════════════════════════════════════════════
// THE NOZZLE TAKES A STACK (noema-276)
//
// `pinnedModels` is a list and the compiler resolves every ref in it, so more than one
// model per stream is a path the platform already runs. The five proofs below are the
// ones that fail if any half of the stack is dropped — and a half-applied stack is not a
// degraded feature, it is a paid run that does something other than what the screen says.
// ═══════════════════════════════════════════════════════════════════════════

const SECOND = card({ intellaId: 'lora-2', nomen: 'other-lora', trigger: 'othertrig' })
const THIRD = card({ intellaId: 'lora-3', nomen: 'third-lora', trigger: 'thirdtrig' })
const FOURTH = card({ intellaId: 'lora-4', nomen: 'fourth-lora', trigger: 'fourthtrig' })

/** The stack the picker would build from a run of choices, all on the same base. */
function stacked(...cards: ModelCard[]): LoraChoice[] {
  let s: LoraChoice[] = []
  for (const c of cards) s = chooseLora(s, c, 'base-a')
  return s
}

// Non-vacuity 1 — both models are actually given to the run

test('a piece fired under two LoRAs names BOTH in pinnedModels', () => {
  const stack = stacked(card(), SECOND)
  assert.deepEqual(stack.map((c) => c.intellaId), ['lora-1', 'lora-2'], 'the second stacks ON, it does not replace')

  const request = firedRunRequest('flow-t2i', 'a fox', stack)
  assert.deepEqual(request.pinnedModels, ['lora-1', 'lora-2'], 'both sets of weights are given to the run')
  assert.deepEqual(pinnedModelsFor(stacked(card(), SECOND, THIRD)), ['lora-1', 'lora-2', 'lora-3'])

  // Order is the order they were stacked, and it is the order they are pinned in.
  assert.deepEqual(pinnedModelsFor(stacked(SECOND, card())), ['lora-2', 'lora-1'])

  // A single choice is a stack of one — the one-model call sites are unchanged, not a
  // second code path beside this one.
  assert.deepEqual(pinnedModelsFor(CHOICE()), ['lora-1'])
  assert.deepEqual(pinnedModelsFor([]), [])
  assert.equal('pinnedModels' in firedRunRequest('flow-t2i', 'a fox', []), false)
})

// Non-vacuity 2 — every stacked trigger reaches the prompt
//
// A pinned model whose trigger never appears is a paid run with no effect — the exact
// refusal `loraChoiceOf` already encodes for one card. Lifting one trigger off a stack of
// three reproduces it twice, per piece.

test("the prompt carries every stacked LoRA's trigger word", () => {
  const stack = stacked(card(), SECOND, THIRD)
  const prompt = promptWithTrigger('a fox, a foggy harbor', stack)
  assert.match(prompt, /trigword/)
  assert.match(prompt, /othertrig/)
  assert.match(prompt, /thirdtrig/)
  assert.match(prompt, /a foggy harbor/, 'and the drawn prompt is still all there')

  // Every pinned model has its trigger in the prompt that is fired — the two halves ride
  // together for the whole stack, not just for its first entry.
  const request = firedRunRequest('flow-t2i', 'a fox', stack)
  for (const entry of stack) {
    assert.ok(request.pinnedModels!.includes(entry.intellaId))
    assert.match(String(request.aditus.prompt), new RegExp(entry.trigger))
  }

  // Each token is still one of the resolver's own two forms, per entry.
  const weighted = setLoraWeight(stack, 'lora-2', 0.8)
  assert.match(promptWithTrigger('a fox', weighted), /othertrig:0\.8/)
  assert.match(promptWithTrigger('a fox', weighted), /trigword,/, 'an unweighted entry stays a bare trigger')
})

// Non-vacuity 3 — one weight per entry, and an unset one stays unset

test("each stacked LoRA carries its own weight, and an unset weight stays unset rather than inheriting its neighbour's", () => {
  const stack = stacked(card(), SECOND, THIRD)
  const one = setLoraWeight(stack, 'lora-2', 0.8)

  assert.equal(one.find((c) => c.intellaId === 'lora-2')!.weight, 0.8)
  assert.equal(one.find((c) => c.intellaId === 'lora-1')!.weight, null, 'a neighbour is not moved')
  assert.equal(one.find((c) => c.intellaId === 'lora-3')!.weight, null)

  // Two entries hold two different weights at once.
  const two = setLoraWeight(one, 'lora-3', 1.5)
  assert.deepEqual(two.map((c) => c.weight), [null, 0.8, 1.5])

  // And the unset one is written as a bare trigger — the LoRA's own default — while its
  // neighbours carry their explicit overrides in the same prompt.
  const prompt = promptWithTrigger('a fox', two)
  assert.match(prompt, /othertrig:0\.8/)
  assert.match(prompt, /thirdtrig:1\.5/)
  assert.equal(/trigword:/.test(prompt), false, 'an unset weight does not inherit a number from anywhere')

  // The band still bounds every entry, and clearing one returns it to the default.
  assert.equal(setLoraWeight(two, 'lora-1', 9).find((c) => c.intellaId === 'lora-1')!.weight, LORA_WEIGHT_MAX)
  assert.equal(setLoraWeight(two, 'lora-2', null).find((c) => c.intellaId === 'lora-2')!.weight, null)

  // A weight change is a nozzle change, which is what holds the stream.
  assert.equal(nozzleChanged(stack, one), true)
  assert.equal(nozzleChanged(stack, stacked(card(), SECOND, THIRD)), false)
  assert.equal(nozzleChanged(stack, stacked(card(), SECOND)), true, 'removing an entry is a nozzle change')
  assert.equal(nozzleChanged(stacked(card(), SECOND), stacked(SECOND, card())), true, 'so is reordering')
})

// Non-vacuity 4 — the familia scope survives the stack
//
// A LoRA trained on another base is a paid run that cannot work. The rule holds today for
// the single choice, and it has to hold for EVERY entry: a stack is only as usable as its
// worst member.

test("a LoRA outside the flow's familia cannot enter the stack", () => {
  const stack = stacked(card(), SECOND)
  const foreign = card({ intellaId: 'wrong-base', nomen: 'other-base-lora', trigger: 'wrongtrig', basis: 'base-b' })

  assert.deepEqual(chooseLora(stack, foreign, 'base-a'), stack, 'nothing from another base enters the stack')
  assert.equal(pinnedModelsFor(chooseLora(stack, foreign, 'base-a')).includes('wrong-base'), false)

  // With no familia in hand there is no scope to check against, so nothing can be
  // stacked — the same answer the catalog gives to the same question.
  assert.deepEqual(chooseLora([], card(), null), [])
  assert.deepEqual(chooseLora([], card(), undefined), [])
  assert.deepEqual(loraCatalog([], [card(), foreign], 'base-a').map((m) => m.intellaId), ['lora-1'])

  // A card with no trigger word cannot enter either: it could be pinned, but nothing
  // would ever apply it — full price, no effect.
  assert.equal(loraChoiceOf(card({ trigger: '' })), null)
  assert.deepEqual(chooseLora(stack, card({ intellaId: 'lora-9', trigger: '' }), 'base-a'), stack)
})

// Non-vacuity 5 — a model cannot be stacked onto itself

test('the same LoRA cannot be stacked onto itself', () => {
  const stack = stacked(card(), SECOND)

  // The same control both stacks and unstacks: choosing what is already on it takes it
  // off, which is the only way the picker has to remove one.
  assert.deepEqual(chooseLora(stack, card(), 'base-a').map((c) => c.intellaId), ['lora-2'])
  assert.deepEqual(chooseLora(chooseLora(stack, card(), 'base-a'), card(), 'base-a').map((c) => c.intellaId), ['lora-2', 'lora-1'])

  // And a duplicate that arrives any other way is dropped rather than pinned twice: the
  // compiler de-dupes a repeated ref, so a stack carrying it twice would be describing a
  // run that does not exist.
  const doubled = [CHOICE(), CHOICE({ nomen: 'same-lora-again' })]
  assert.deepEqual(loraStack(doubled).map((c) => c.intellaId), ['lora-1'])
  assert.deepEqual(pinnedModelsFor(doubled), ['lora-1'], 'one model, pinned once')
  assert.equal(promptWithTrigger('a fox', doubled), promptWithTrigger('a fox', CHOICE()))
})

// The readouts name the stack, and the hold names what it is loading

test('the readouts name every model on the nozzle rather than counting them', () => {
  const stack = setLoraWeight(stacked(card(), SECOND), 'lora-2', 0.8)

  for (const line of [loraChoiceLine(stack), nozzleSummaryLine(stack)]) {
    assert.match(line, /sample-lora/)
    assert.match(line, /other-lora/, 'a second model is NAMED, never summed into a count')
    assert.match(line, /trigword/)
    assert.match(line, /othertrig/)
    assert.equal(/2 models/.test(line), false, 'a count carries none of what the line exists to say')
  }
  assert.match(nozzleSummaryLine(stack), /own default weight/, 'the unweighted entry still says which weight it fires at')
  assert.match(nozzleSummaryLine(stack), /weight 0\.8/)

  // The warm-up note matters MORE with a stack: the pod fetches every set of weights
  // before the first piece, so it says how many are coming down.
  assert.match(loraWarmupNote(stack)!, /may be slow/)
  assert.match(loraWarmupNote(stack)!, /sample-lora/)
  assert.match(loraWarmupNote(stack)!, /other-lora/)
  assert.equal(loraWarmupNote([]), null)

  // The hold names the triggers it is loading, all of them.
  assert.equal(nozzleTriggerLabel(stack), 'trigword + othertrig')
  assert.equal(nozzleTriggerLabel([]), undefined)
})

// ── Proof — a deep stack's warm-up note names the cold start (rth's rider, noema-281) ──
//
// noema-276 shipped the stack with no cap, which is rth's ruling: nothing here bounds how
// many LoRAs a run may carry, and this note does not change that. It only names the wait
// more plainly once the stack is deep enough for the wait to be worth naming twice.

test("a stack of four names the cold start; a stack of three doesn't, and the stack still fires either way", () => {
  const three = stacked(card(), SECOND, THIRD)
  const four = stacked(card(), SECOND, THIRD, FOURTH)
  assert.equal(three.length, DEEP_STACK_WARMUP_THRESHOLD - 1)
  assert.equal(four.length, DEEP_STACK_WARMUP_THRESHOLD)

  // Non-vacuity 1 — the threshold itself: four warns of the cold start, three does not.
  assert.match(loraWarmupNote(four)!, /cold start/, 'a stack this deep names the cold start explicitly')
  assert.equal(/cold start/.test(loraWarmupNote(three)!), false, 'three is not a deep stack yet')
  // Three still gets the plain multi-model note — it is not silent, only not escalated.
  assert.match(loraWarmupNote(three)!, /may be slow/)

  // Non-vacuity 2 — the subject is the wait, never quality or a limit.
  assert.match(loraWarmupNote(four)!, /may be slow/)
  assert.equal(/quality/i.test(loraWarmupNote(four)!), false, 'this is not a claim about output quality')
  assert.equal(/limit|cap|refus/i.test(loraWarmupNote(four)!), false, 'a warning that reads as a cap is a cap wearing a warning\'s clothes')

  // Non-vacuity 3 — a warned stack still fires: nothing about the note touches the run
  // request, and every pinned model still reaches it, cold-start warning or not.
  const request = firedRunRequest('flow-t2i', 'a fox', four)
  assert.deepEqual(request.pinnedModels, ['lora-1', 'lora-2', 'lora-3', 'lora-4'], 'a warned stack still fires, in full')
})

// ── Proof — the catalog is scoped to the flow's base-model family ───────────
//
// A LoRA from another base model is a paid run that cannot work. Refusing it in the
// picker costs nothing; discovering it costs a piece.

test("the catalog offered is scoped to the selected modus's familia", () => {
  const own = [card({ intellaId: 'mine-1', nomen: 'my-lora', access: 'private' })]
  const shared = [
    card({ intellaId: 'lora-1' }),
    card({ intellaId: 'wrong-base', basis: 'base-b' }),
    card({ intellaId: 'a-checkpoint', genus: 'model' }),
    card({ intellaId: 'no-trigger', trigger: '' }),
    card({ intellaId: 'mine-1', nomen: 'my-lora' }),
  ]

  const offered = loraCatalog(own, shared, 'base-a')
  assert.deepEqual(offered.map((m) => m.intellaId), ['mine-1', 'lora-1'])
  assert.equal(offered.some((m) => m.basis !== 'base-a'), false, 'nothing from another base is offerable')
  assert.equal(offered.some((m) => m.genus !== 'lora'), false)
  assert.equal(offered.some((m) => !m.trigger), false)

  // No familia in hand is an EMPTY catalog, never an unscoped one — an unscoped list is
  // exactly the list that contains the run that cannot work.
  assert.deepEqual(loraCatalog(own, shared, null), [])
  assert.deepEqual(loraCatalog(own, shared, undefined), [])

  // And the emptiness is explained rather than rendered as a blank list, because "no
  // workflow chosen" and "this base has no LoRAs" are different facts.
  assert.match(loraCatalogReason(null, null, 0)!, /choose a workflow first/)
  assert.match(loraCatalogReason('flow-t2i', null, 0)!, /base model/)
  assert.match(loraCatalogReason('flow-t2i', 'base-a', 0)!, /base-a/)
  assert.equal(loraCatalogReason('flow-t2i', 'base-a', 2), null)
})

// ── The readouts around the nozzle ──────────────────────────────────────────

test('the chosen nozzle is named with its trigger word, and a cold one says it may be slow', () => {
  // S5 asks for the trigger on the CHOSEN model too, not only in the picker: it is the
  // part a user has to be able to see to trust that the model is reaching the prompt.
  assert.match(loraChoiceLine(CHOICE()), /sample-lora/)
  assert.match(loraChoiceLine(CHOICE()), /trigword/)
  assert.match(loraChoiceLine(CHOICE({ weight: 0.8 })), /0\.8/)
  assert.match(loraChoiceLine(null), /no model/)

  // The pod fetches the weights before it can make anything with them, so the first piece
  // under a new LoRA can be slow. Said, rather than left to read as a stall.
  assert.match(loraWarmupNote(CHOICE())!, /may be slow/)
  assert.equal(loraWarmupNote(null), null)
})

// ---------------------------------------------------------------------------
// The piece shows its image (noema-262) — the terminal a tile receives has to carry
// the run's outputs, because a tile stops watching its run the moment that run is
// terminal. The four gates below are the ones that fail if any part of that is undone.
//
// Fixtures are invented throughout (`run-…`, `https://r2.example/…`).
// ---------------------------------------------------------------------------

/** A subscriber to one run: it holds the patched state, and it stops listening at the
 *  first terminal it is told about — which is what the grid does, since a tile mounts
 *  its watcher only while the piece is running. */
function watcher(runId: string, start: StreamState) {
  const held: { stream: StreamState; listening: boolean; order: string[]; released: RunResult[] } = {
    stream: start, listening: true, order: [], released: [],
  }
  const emit = (patch: TerminalPatch) => {
    if (!held.listening) return
    held.listening = false
    settlePieceResult(
      runId,
      { terminal: patch.terminal, exitus: patch.exitus, error: patch.error },
      (id, r) => { held.order.push('fold'); held.stream = applyRunResult(held.stream, id, r) },
      (r) => { held.order.push('release'); held.released.push(r) },
    )
  }
  return { held, emit }
}

// Non-vacuity 1 — the media reaches the tile

test("a completed piece's media reaches the tile even though the piece stops being 'running' the moment it completes", async () => {
  const { held, emit } = watcher('run-1', admitPiece(EMPTY_STREAM, piece('run-1'), false))

  await announceTerminal(
    'complete',
    'run-1',
    async () => ({ run: { exitus: { image: 'https://r2.example/piece-1.png' } } }),
    emit,
  )

  const done = held.stream.pieces[0]!
  assert.equal(done.status, 'ready', 'the run finished and the tile has its piece')
  assert.equal(
    done.media?.url,
    'https://r2.example/piece-1.png',
    'the outputs are in hand BEFORE the terminal is announced, so the one announcement carries them',
  )
  assert.equal(held.listening, false, 'and that announcement is the last thing the tile hears')
})

// Non-vacuity 2 — a terminal with nothing in it is not a finished piece

test('a terminal with no output does not mark a piece ready-with-no-media', () => {
  const fired = admitPiece(EMPTY_STREAM, piece('run-1'), false)
  const empties: Array<Record<string, unknown> | null | undefined> = [
    null,
    undefined,
    {},
    { text: 'a caption, which is not something a tile can show' },
  ]

  for (const exitus of empties) {
    const done = applyRunResult(fired, 'run-1', { terminal: 'complete', exitus })
    const p = done.pieces[0]!
    assert.notEqual(p.status, 'ready', 'ready with no media renders as the waiting state, forever')
    assert.equal(p.media, null)
    assert.equal(p.status, 'failed')
    assert.ok(p.error, 'the tile says what happened instead of sitting on "generating…"')
  }

  // and a terminal that DOES carry media is still the ordinary finished piece
  const shown = applyRunResult(fired, 'run-1', { terminal: 'complete', exitus: { image: 'https://r2.example/p.png' } })
  assert.equal(shown.pieces[0]!.status, 'ready')
})

// Non-vacuity 3 — the loop is released behind the fold, never ahead of it

test("the stream loop is released only after the finished piece's media has been folded in", () => {
  let stream = admitPiece(EMPTY_STREAM, piece('run-1'), false)
  const order: string[] = []

  settlePieceResult(
    'run-1',
    { terminal: 'complete', exitus: { image: 'https://r2.example/piece-1.png' } },
    (id, r) => { order.push('fold'); stream = applyRunResult(stream, id, r) },
    () => {
      order.push('release')
      // the next piece is requested on release, so the finished one is on screen by now
      assert.equal(stream.pieces[0]!.media?.url, 'https://r2.example/piece-1.png')
      assert.equal(stream.pieces[0]!.status, 'ready')
    },
  )

  assert.deepEqual(order, ['fold', 'release'])

  // a run nothing is parked on settles the same way — the fold is not conditional on
  // there being a loop to release
  const alone: string[] = []
  settlePieceResult('run-1', { terminal: 'complete', exitus: {} }, () => { alone.push('fold') })
  assert.deepEqual(alone, ['fold'])
})

// Non-vacuity 4 — a failure never buys images at the price of a stuck stream

test('a failed run still marks its piece failed and still releases the loop', async () => {
  const { held, emit } = watcher('run-1', admitPiece(EMPTY_STREAM, piece('run-1'), false))

  // the run record never comes back: nothing on the failure path may be parked on it
  const never = new Promise<{ run: TerminalRun }>(() => {})
  void announceTerminal('failed', 'run-1', () => never, emit)
  await Promise.resolve()

  assert.equal(held.stream.pieces[0]!.status, 'failed')
  assert.equal(held.released.length, 1, 'the loop is released, so the stream does not hang on an error')
  assert.equal(held.released[0]!.terminal, 'failed', 'and it is released with the failure, which the loop counts')
  assert.deepEqual(held.order, ['fold', 'release'])
})

// ---------------------------------------------------------------------------
// Coming back to a session (noema-263) — the stream is state the screen holds, so a
// mount starts it empty while the session's ledger still holds every piece it fired.
// The five gates below are the ones that fail if any part of the rebuild is undone.
//
// Fixtures are invented throughout (`ses-…`, `run-…`, `https://r2.example/…`).
// ---------------------------------------------------------------------------

// Non-vacuity 1 — the pieces come back

test('returning to a session rebuilds its recorded pieces as tiles', () => {
  const fox = frag('subject', 'a fox')
  const harbor = frag('setting', 'a foggy harbor')
  const s = session([fox, harbor], {
    pieces: [ledgerPiece('run-1', [fox]), ledgerPiece('run-2', [fox, harbor])],
  })

  const rebuilt = rehydrateStream(s)
  assert.equal(rebuilt.pieces.length, 2, 'a session with a ledger does not come back as an empty stream')
  assert.deepEqual(
    rebuilt.pieces.map((p) => p.runId),
    ['run-2', 'run-1'],
    'newest first, the order the grid already lays pieces out in',
  )
  assert.deepEqual(rebuilt.pending, [], 'nothing is held back: there is no scroll position to protect on mount')

  // the lineage rides back with each tile, so the expanded view works on a rebuilt tile
  // without a second call
  assert.deepEqual(
    lineageOf(rebuilt.pieces[0]!).map((e) => e.text),
    ['a fox', 'a foggy harbor'],
  )
  // and the prompt is recomposed from that lineage rather than left blank
  assert.match(rebuilt.pieces[0]!.prompt, /a fox/)

  // a session that has fired nothing has nothing to rebuild
  assert.deepEqual(rehydrateStream(session([fox])).pieces, [])
})

// Non-vacuity 2 — a rebuild does not un-do what the session already recorded

test('a rebuilt tile keeps the reaction, the dismissal and the saved flag the session recorded', () => {
  const fox = frag('subject', 'a fox')
  const s = session([fox], {
    pieces: [
      ledgerPiece('run-kept', [fox], { reaction: 'up', saved: true }),
      ledgerPiece('run-gone', [fox], { dismissed: true }),
    ],
  })

  const rebuilt = rehydrateStream(s)
  assert.deepEqual(
    rebuilt.pieces.map((p) => p.runId),
    ['run-kept'],
    'a piece the session recorded as dismissed stays off the scroll — ✕ is a decision the ledger holds',
  )

  // the reaction and the saved flag are read off the SESSION wherever a tile is rendered,
  // which is what the rebuilt tile is handed: a rebuild is not a second copy of the ledger
  const tile = rebuilt.pieces[0]!
  assert.equal(reactionOf(s, tile.runId), 'up', 'a ♡ given before the reload is still on the tile after it')
  assert.equal(savedOf(s, tile.runId), true, 'and a piece already in the set still reads as saved')
  assert.equal(recordedPiece(s, tile.runId)?.dismissed, false)
})

// Non-vacuity 3 — the rebuild is bounded

test('rehydrate asks for no more than the newest N pieces', () => {
  const fox = frag('subject', 'a fox')
  const many = Array.from({ length: REHYDRATE_LIMIT * 5 }, (_, i) => ledgerPiece(`run-${i}`, [fox]))
  const s = session([fox], { pieces: many })

  const rebuilt = rehydrateStream(s)
  assert.equal(
    rebuilt.pieces.length,
    REHYDRATE_LIMIT,
    'an infinite stream can hold hundreds of pieces, and each rebuilt tile costs one run read',
  )
  assert.equal(rebuilt.pieces[0]!.runId, `run-${many.length - 1}`, 'and the ones it takes are the newest')
  assert.equal(REHYDRATE_LIMIT, STREAM_MAX_COLUMNS * REHYDRATE_ROWS, 'the bound is a screenful of the widest grid')

  // the bound is honoured whatever it is set to, and a session shorter than it is not padded
  assert.equal(rehydrateStream(s, 3).pieces.length, 3)
  assert.equal(rehydrateStream(s, 0).pieces.length, 0)
  assert.equal(rehydrateStream(session([fox], { pieces: many.slice(0, 2) })).pieces.length, 2)
})

// Non-vacuity 4 — a resumed session says it is resumable

test('a resumed session that is not streaming reads as resumable rather than as a fresh configuration', () => {
  const fox = frag('subject', 'a fox')
  const s = session([fox], { pieces: [ledgerPiece('run-1', [fox])] })

  const phase = resumePhase(rehydrateStream(s))
  assert.equal(phase, 'resumed')

  const line = streamStatusLine(phase, null, 0, CFG({ mode: 'infinite' }), null)
  assert.notEqual(line, 'idle', 'idle renders the screen as though nothing had been made here')
  assert.match(line, /resumable/)
  assert.match(line, /launch/, 'resuming spends nothing — the launch control is still what fires a piece')

  // a session with nothing in its ledger IS a fresh configuration, and still reads as one
  assert.equal(resumePhase(rehydrateStream(session([fox]))), 'idle')
  assert.equal(streamStatusLine('idle', null, 0, CFG({ mode: 'infinite' }), null), 'idle')
})

// Non-vacuity 5 — a piece that was in flight when the page went away is asked, not assumed

test('a piece whose run has not reached terminal comes back as still generating and is watched again', async () => {
  const fox = frag('subject', 'a fox')
  const s = session([fox], {
    pieces: [ledgerPiece('run-open', [fox]), ledgerPiece('run-done', [fox])],
  })

  let stream = rehydrateStream(s)
  // every rebuilt tile starts as `running`, which is what mounts the tile's watcher
  assert.deepEqual(stream.pieces.map((p) => p.status), ['running', 'running'])
  assert.deepEqual(stream.pieces.map((p) => p.media), [null, null])

  // the run is what decides, and a run that has not finished decides nothing yet
  assert.equal(terminalOf('running'), null)
  assert.equal(terminalOf('pending'), null)
  assert.equal(terminalOf(undefined), null)
  assert.equal(terminalOf('complete'), 'complete')
  assert.equal(terminalOf('failed'), 'failed')

  // the run that DID finish while the page was away comes back with its media, through the
  // same terminal path a live piece takes
  const finished: TerminalRun = { exitus: { image: 'https://r2.example/rebuilt.png' } }
  await announceTerminal('complete', 'run-done', async () => ({ run: finished }), (patch) => {
    stream = applyRunResult(stream, 'run-done', { terminal: patch.terminal, exitus: patch.exitus, error: patch.error })
  })

  const done = stream.pieces.find((p) => p.runId === 'run-done')!
  assert.equal(done.status, 'ready')
  assert.equal(done.media?.url, 'https://r2.example/rebuilt.png')

  // and the one still on the pod is left saying exactly that, with its watcher mounted
  const open = stream.pieces.find((p) => p.runId === 'run-open')!
  assert.equal(open.status, 'running', 'a run still going is not folded in as finished, and is not folded in as failed')
  assert.equal(open.media, null)
})

// ── The controls get out of the way, on the user's hand, at any time (noema-264, noema-282) ──
//
// The rule lives in `lib/muse.ts` and not in `Muse.tsx` because that is the only place
// it can be gated: these tests run from the repo root under `tsx --test`, which has no
// react. The CSS half of this item is NOT gated by anything here.

const COLLAPSE = (over: Partial<Parameters<typeof collapsedControls>[0]> = {}) =>
  collapsedControls({ phase: 'running', pieces: 4, hand: {}, ...over })

// Non-vacuity 1 — the collapse happens at all

test('a stream with pieces on it collapses the configuration, the nozzle and the steer dock to their summary lines', () => {
  const collapsed = COLLAPSE()
  assert.equal(collapsed.configuration, true)
  assert.equal(collapsed.nozzle, true, 'the grid is what the user scrolled here to see')
  assert.equal(collapsed.steer, true)

  // a stream that has stopped still has its pieces on it, and they are still the reason
  // the controls are not the screen
  assert.deepEqual(COLLAPSE({ phase: 'stopped' }), { configuration: true, nozzle: true, steer: true })
  assert.deepEqual(COLLAPSE({ phase: 'resumed' }), { configuration: true, nozzle: true, steer: true })

  // and a loop riding toward its first piece has already begun, whatever has landed yet
  assert.deepEqual(COLLAPSE({ phase: 'running', pieces: 0 }), { configuration: true, nozzle: true, steer: true })
  assert.deepEqual(COLLAPSE({ phase: 'holding', pieces: 0 }), { configuration: true, nozzle: true, steer: true })
})

// Non-vacuity 2 — an empty screen keeps the control that starts something

test('a session with nothing on it opens with every control expanded', () => {
  const fresh = COLLAPSE({ phase: 'idle', pieces: 0 })
  assert.equal(fresh.configuration, false, 'collapsing an empty screen hides the only control that starts anything')
  assert.equal(fresh.nozzle, false, 'and the model is chosen before the first piece, not after it')
  assert.equal(fresh.steer, false)

  // the same is true of a session reopened with nothing in its ledger
  assert.deepEqual(COLLAPSE({ phase: 'stopped', pieces: 0 }), { configuration: false, nozzle: false, steer: false })
})

// Non-vacuity 3 — the pin overrides the auto rule, in either direction, at any phase

test('pinning a control open keeps it expanded while the stream rides', () => {
  const opened = COLLAPSE({ hand: { nozzle: 'open' } })
  assert.equal(opened.nozzle, false, 'nothing re-collapses a control under the user\'s hand')
  assert.equal(opened.configuration, true, 'and opening one says nothing about the other')

  // it stays open across every phase the stream moves through afterwards
  for (const phase of ['running', 'holding', 'stopping', 'stopped'] as const) {
    assert.equal(collapsedControls({ phase, pieces: 9, hand: { nozzle: 'open' } }).nozzle, false)
  }

  // the user's hand is also the only thing that closes it again
  assert.deepEqual(setControlHand({}, 'configuration', false), { configuration: 'closed' })
  assert.deepEqual(setControlHand({ configuration: 'closed' }, 'configuration', true), { configuration: 'open' })
  assert.deepEqual(setControlHand({ nozzle: 'open' }, 'configuration', false), { nozzle: 'open', configuration: 'closed' })
  assert.equal(COLLAPSE({ hand: setControlHand({ nozzle: 'open' }, 'nozzle', false) }).nozzle, true)
})

// Non-vacuity 3b — the pin runs the other way too, before the stream has begun

test('a control can be collapsed by hand with zero pieces fired', () => {
  // this is the whole complaint: configuring a run is exactly when the banner is
  // tallest, and exactly when a hand could not fold it before this item
  const closedEarly = COLLAPSE({ phase: 'idle', pieces: 0, hand: { configuration: 'closed' } })
  assert.equal(closedEarly.configuration, true, 'the user\'s hand can fold a control the stream has not touched yet')
  assert.equal(closedEarly.nozzle, false, 'and closing one says nothing about the other')

  // it stays closed across every phase, exactly as an open pin stays open
  for (const phase of ['idle', 'running', 'stopped'] as const) {
    assert.equal(collapsedControls({ phase, pieces: 0, hand: { steer: 'closed' } }).steer, true)
  }
})

// Non-vacuity 2b — the steer dock collapses and re-opens, both directions

test('the steer dock collapses and re-opens', () => {
  assert.equal(COLLAPSE({ phase: 'running', pieces: 4, hand: {} }).steer, true, 'a running stream folds the steer dock like the others')
  assert.equal(COLLAPSE({ phase: 'running', pieces: 4, hand: { steer: 'open' } }).steer, false, 'and the user\'s hand brings it back')
  assert.equal(COLLAPSE({ phase: 'idle', pieces: 0, hand: { steer: 'closed' } }).steer, true, 'a control that collapses and cannot be re-opened is worse than one that never collapses')
})

// Non-vacuity 4 — collapsed stays legible

test('a collapsed nozzle still names the model that is loaded and its weight', () => {
  const line = nozzleSummaryLine(CHOICE({ weight: 0.8 }))
  assert.match(line, /sample-lora/, 'which model is loaded is exactly what a collapsed row exists to answer')
  assert.match(line, /trigword/)
  assert.match(line, /0\.8/, 'the user is mid-stream and spending against this weight')

  // an unset weight is a weight, and the line says which one it is rather than omitting it
  assert.match(nozzleSummaryLine(CHOICE()), /own default/)
  assert.match(nozzleSummaryLine(null), /no model/)

  // the configuration's own line names the run mode and, when the mode has one, the cap
  assert.match(configSummaryLine(CFG({ mode: 'batched', cap: 12 }), 'a workflow'), /batched/)
  assert.match(configSummaryLine(CFG({ mode: 'batched', cap: 12 }), 'a workflow'), /12/)
  assert.match(configSummaryLine(CFG({ mode: 'infinite' }), 'a workflow'), /infinite/)
  assert.match(configSummaryLine(CFG({ mode: 'infinite' }), 'a workflow'), /a workflow/)
  assert.match(configSummaryLine(CFG(), null), /no workflow/)
})

// Non-vacuity 4b — a collapsed steer dock still says a steer failed

test('a collapsed steer dock still names the floor, and a failure over it', () => {
  assert.equal(
    steerDockSummaryLine({ floorLine: 'floor 3/5 in the draw', failure: null }),
    'floor 3/5 in the draw',
    'with nothing wrong, the collapsed row is the same line the expanded dock shows',
  )
  assert.match(
    steerDockSummaryLine({ floorLine: 'floor 3/5 in the draw', failure: 'the server refused it' }),
    /the server refused it/,
    'a user mid-stream is spending against a steer they cannot see failed if this is silent',
  )
})

// ── The banner is ONE line while a stream is live (noema-286) ──────────────
//
// Three summary lines, a floor readout, a launch row, a cold-start note and an estimate
// footnote is a banner the grid has to be scrolled past. The unit these assert in is
// LINES, deliberately: the defect is HEIGHT, and a test that asserted the presence of a
// string would pass on every one of the shapes this item exists to rule out.

const STACK3 = [
  CHOICE({ intellaId: 'lora-1', nomen: 'first-lora', trigger: 'firstword', weight: 0.8 }),
  CHOICE({ intellaId: 'lora-2', nomen: 'second-lora', trigger: 'secondword' }),
  CHOICE({ intellaId: 'lora-3', nomen: 'third-lora', trigger: 'thirdword', weight: 0.5 }),
]

const BANNER = (over: Partial<Parameters<typeof runBanner>[0]> = {}) =>
  runBanner({
    phase: 'running',
    pieces: 1,
    hand: {},
    detail: false,
    config: CFG({ mode: 'batched', cap: 10 }),
    workflow: 'a workflow',
    nozzle: STACK3,
    status: 'running · 1 of 10 pieces · ~120 impetus this stream',
    floorLine: 'floor 3/5 in the draw',
    warmup: STACK3,
    landed: 1,
    quoted: true,
    ...over,
  })

// Non-vacuity 1 — the fold happens at all, and it is measured in lines

test('a running stream renders ONE banner line, not one per control', () => {
  const folded = BANNER()
  assert.equal(folded.folded, true)
  assert.equal(folded.lines.length, 1, 'the pieces are what should fill the screen, not the controls above them')
  assert.equal(folded.lines[0].id, 'run')

  // and that one line answers all three questions it is allowed to answer
  const line = folded.lines[0].text
  assert.match(line, /1 of 10 pieces/, 'how far along')
  assert.match(line, /impetus/, 'what it is costing')
  assert.match(line, /a workflow/, 'what is running')

  // nothing else is on the screen
  for (const id of ['configuration', 'nozzle', 'floor', 'estimate'] as const) {
    assert.equal(folded.lines.some((l) => l.id === id), false, `${id} is behind the press while a stream rides`)
  }

  // a hold and a stop-in-flight are live streams too
  assert.equal(BANNER({ phase: 'holding' }).lines.length, 1)
  assert.equal(BANNER({ phase: 'stopping' }).lines.length, 1)

  // an idle screen is NOT folded: hiding the only control that starts anything is the
  // one thing a fresh screen must not do
  const fresh = BANNER({ phase: 'idle', pieces: 0, landed: 0 })
  assert.equal(fresh.folded, false)
  assert.equal(fresh.press, null, 'there is nothing to unfold from a screen that has launched nothing')
})

test('one press brings the whole banner back', () => {
  assert.equal(BANNER().press, 'more')
  const opened = BANNER({ detail: true })
  assert.equal(opened.press, 'less', 'and the same press folds it again')
  assert.deepEqual(
    opened.lines.map((l) => l.id),
    ['run', 'configuration', 'nozzle', 'floor', 'estimate'],
    'one press, never two, and never behind a scroll',
  )
  assert.equal(opened.lines.find((l) => l.id === 'estimate')!.text, ESTIMATE_NOTE)
  assert.equal(opened.lines.find((l) => l.id === 'floor')!.text, 'floor 3/5 in the draw')

  // a control the user pinned open is expanded, not a summary line, so it is not here
  const pinned = BANNER({ detail: true, hand: { nozzle: 'open' } })
  assert.equal(pinned.lines.some((l) => l.id === 'nozzle'), false, 'a hand that opened a control still keeps it open')
  assert.equal(pinned.lines.some((l) => l.id === 'configuration'), true)
})

// Non-vacuity 2 — the stack folds to a count, and the names are ONE press away

test('a three-model stack folds without naming all three', () => {
  const line = BANNER().lines[0].text
  for (const choice of STACK3) {
    assert.equal(line.includes(choice.nomen), false, 'a stack of three named in full is the paragraph this item removes')
  }
  assert.match(line, /3 models/, 'the count is what a folded line can carry')
  assert.match(nozzleFoldLine(STACK3), /^3 models/)

  // the rule this reverses is right at one model, and is kept there
  assert.match(nozzleFoldLine(CHOICE()), /sample-lora/, 'one model is a clause, and is still named')
  assert.match(nozzleFoldLine(CHOICE()), /trigword/)
  assert.match(nozzleFoldLine(null), /base only/)
})

// ── the noema-284 × noema-286 seam, resolved in seat 2026-08-22 ─────────────
// The two items were built in parallel against the same three files: 284 put the standing
// affix into `nozzleSummaryLine`, 286 took ownership of the banner's text away from that
// call site. Resolving the conflict by taking 286's side alone would have silently dropped
// the affix from the banner — a standing instruction riding every prompt with nothing on
// screen admitting it. These two tests are what stop that regressing.

test('a standing affix is admitted on the folded banner', () => {
  const affix = { prefix: 'in the style of a woodcut', suffix: 'muted palette' }
  const bare = BANNER().lines.find((l) => l.id === 'run')!.text
  const withAffix = BANNER({ affix }).lines.find((l) => l.id === 'run')!.text

  assert.equal(bare.includes('standing text'), false, 'no affix, nothing to admit')
  assert.match(withAffix, /standing text/, 'the fold may hide the WORDS; it may not hide that they exist')
  // and it is still one line — admitting the affix must not undo the fold this item is for
  assert.equal(BANNER({ affix }).lines.filter((l) => l.id !== 'warmup').length, 1)
})

test('the opened banner quotes the standing affix, not just the models', () => {
  const affix = { prefix: 'in the style of a woodcut', suffix: 'muted palette' }
  const named = BANNER({ detail: true, affix }).lines.find((l) => l.id === 'nozzle')!
  assert.match(named.text, /woodcut/, 'one press away, the standing text is quoted in full')
  assert.match(named.text, /muted palette/)
  for (const choice of STACK3) {
    assert.match(named.text, new RegExp(choice.nomen), 'and the models are still named beside it')
  }
})

test('one press names all three with their weights', () => {
  const named = BANNER({ detail: true }).lines.find((l) => l.id === 'nozzle')!
  for (const choice of STACK3) {
    assert.match(named.text, new RegExp(choice.nomen), 'a user mid-stream is spending against whatever this names')
    assert.match(named.text, new RegExp(choice.trigger))
  }
  assert.match(named.text, /0\.8/)
  assert.match(named.text, /0\.5/)
  assert.match(named.text, /own default weight/, 'an unset weight is a weight, and the line says which one')
})

// Non-vacuity 3 — the cold-start note is a claim about the FIRST piece

test('the cold-start note is gone once a piece has landed', () => {
  const cold = BANNER({ landed: 0 })
  assert.equal(cold.lines.some((l) => l.id === 'warmup'), true, 'the warning is not folded during the wait it explains')
  assert.match(cold.lines.find((l) => l.id === 'warmup')!.text, /may be slow/)

  const warm = BANNER({ landed: 1 })
  assert.equal(warm.lines.some((l) => l.id === 'warmup'), false, 'after the first piece it is furniture')
  assert.equal(warm.lines.length, 1, 'and the banner is one line again the moment it retires')

  // it is a claim about a piece that has COME BACK, not one that has been fired
  const fired = streamPiece('run-1', 'a prompt', [])
  assert.equal(landedPieces({ pieces: [fired], pending: [] }), 0)
  assert.equal(landedPieces({ pieces: [{ ...fired, status: 'ready' }], pending: [] }), 1)
  assert.equal(landedPieces({ pieces: [{ ...fired, status: 'failed' }], pending: [] }), 1, 'a piece that failed came back')
  assert.equal(landedPieces({ pieces: [], pending: [{ ...fired, status: 'ready' }] }), 1, 'a frozen grid is still a landed piece')
})

// Non-vacuity 4 — nothing folds away the control that ends the spend

test('stop is rendered while the banner is folded', () => {
  for (const phase of ['running', 'holding', 'stopping'] as const) {
    const b = BANNER({ phase })
    assert.equal(b.folded, true)
    assert.equal(b.stop, true, 'the control that ends the spend can never be behind a press')
  }
  // the live readout rides the folded line with it, and leads it: the elision falls on
  // the configuration tail, which is one press away, and never on the price, which is not
  assert.match(BANNER().lines[0].text, /^running · 1 of 10 pieces · ~120 impetus/)

  // a stream that is over has nothing to stop
  assert.equal(BANNER({ phase: 'stopped' }).stop, false)
  assert.equal(BANNER({ phase: 'idle', pieces: 0 }).stop, false)
})

// ═══════════════════════════════════════════════════════════════════════════
// THE FIRE PRE-FLIGHT (noema-272)
//
// A fire spends before it records: `createRun` reserves and settles, and the ledger
// entry is written after it returns. A lineage the session's floor cannot resolve is
// rejected at that record call, by which point the piece has been paid for and can
// never be reacted to, saved or dismissed. The screen holds both halves already — the
// floor on the session, the lineage on the draw — so the refusal belongs before the run.
// ═══════════════════════════════════════════════════════════════════════════

test('a piece whose lineage the floor does not hold is refused before it is fired', () => {
  const fox = frag('subject', 'a fox')
  const harbor = frag('setting', 'a foggy harbor')
  const stranger = frag('palette', 'neon pink')

  const s = session([fox, harbor])
  assert.equal(lineageBlockReason(s, [fox, harbor]), null, 'a lineage the floor holds fires')

  const refusal = lineageBlockReason(s, [fox, stranger])
  assert.ok(refusal, 'a lineage citing a fragment the floor does not hold does not')
  assert.match(refusal!, /neon pink/, 'and the refusal names the fragment that is missing')

  // A darkened fragment is still a fragment the floor HOLDS — a piece rolled before it
  // was taken out of the draw is a real piece with a resolvable lineage.
  const darkened = session([fox, harbor], { floor: [entry(fox, { enabled: false }), entry(harbor)] })
  assert.equal(lineageBlockReason(darkened, [fox]), null, 'darkened is not absent')

  // No session open means no ledger entry is attempted, so there is nothing to refuse.
  assert.equal(lineageBlockReason(null, [stranger]), null)
})

// ---------------------------------------------------------------------------
// The live run readout (noema-273) — a piece that is being made on a live pod says
// what the pod is doing. Every branch below is one of the item's mandated proofs.
// ---------------------------------------------------------------------------

function live(stageIdx: number, progressus?: PieceProgress['progressus']): PieceProgress {
  return { stageIdx, progressus }
}

test('pieceReadout: a running piece reads its live phase, not \'generating…\'', () => {
  const running = piece('run-1')

  const setup = pieceReadout(running, live(1, { phase: 'pulling', message: 'pulling image' }))
  assert.match(setup, new RegExp(STAGE_LABELS[1]!), 'the coarse stage the run is in is named')
  assert.match(setup, /pulling image/, "the runner's own words for what it is doing are shown")
  assert.equal(/generating…/.test(setup), false, 'a live run is never described by a static status')

  // the typed measurement is read when the runner sends no words
  assert.match(
    pieceReadout(running, live(1, { phase: 'downloading', progress: { done: 3, total: 9, unit: 'files' } })),
    /3 \/ 9 files/,
  )
  // and the phase itself when it sends neither
  assert.match(pieceReadout(running, live(2, { phase: 'executing' })), /executing/)

  // one tile line, so a long sub-line is trimmed rather than pushed off the tile
  const long = pieceReadout(running, live(1, { phase: 'downloading', message: 'x'.repeat(200) }))
  assert.ok(long.length <= TILE_READOUT_MAX, `the tile line stays within ${TILE_READOUT_MAX}`)
  assert.match(long, new RegExp(STAGE_LABELS[1]!), 'trimming never costs the stage name')
})

test('pieceReadout: a piece with no frame yet still reads as admitted rather than blank', () => {
  const running = piece('run-1')
  assert.equal(pieceReadout(running, undefined), STAGE_LABELS[0])
  assert.equal(pieceReadout(running, live(0)), STAGE_LABELS[0], 'a snapshot with no progress frame reads the same')
  assert.ok(pieceReadout(running, undefined).length > 0, 'silence is the state this replaces')
})

test('pieceReadout: a piece that has landed stops reporting a phase', () => {
  const landed: StreamPiece = { ...piece('run-1'), status: 'ready', media: { kind: 'image', url: 'https://r2.example/p.png' } }
  // a stale frame is still held by the caller when the run completes; a finished piece
  // reading 'executing' is the same untruth as a running one reading 'generating…'
  const stale = live(2, { phase: 'executing', message: 'sampling' })
  assert.equal(pieceReadout(landed, stale), '')
  assert.equal(/executing|sampling/.test(pieceReadout(landed, stale)), false)
  assert.equal(pieceStageline(landed, stale).terminal, 'complete')
})

test('pieceReadout: a failed piece shows its error, not a phase', () => {
  const failed: StreamPiece = { ...piece('run-1'), status: 'failed', error: 'the pod went away' }
  const stale = live(2, { phase: 'executing', message: 'sampling' })
  assert.equal(pieceReadout(failed, stale), 'the pod went away', 'failure outranks progress')
  assert.equal(/executing|sampling/.test(pieceReadout(failed, stale)), false)
  assert.equal(pieceStageline(failed, stale).terminal, 'failed')
  // a failure with no message still says something
  assert.ok(pieceReadout({ ...failed, error: undefined }, stale).length > 0)
})

test('pieceStageline: the expanded piece draws the stage its own subscription reports', () => {
  const running = piece('run-1')
  const drawn = pieceStageline(running, live(3, { phase: 'uploading' }))
  assert.equal(drawn.terminal, null)
  assert.equal(drawn.stageIdx, 3)
  assert.equal(drawn.progressus?.phase, 'uploading')
  // an out-of-range stage never points past the stages the timeline actually draws
  assert.ok(pieceStageline(running, live(99)).stageIdx < STAGE_LABELS.length)
  assert.ok(pieceReadout(running, live(99)).length > 0)
})

// ---------------------------------------------------------------------------
// Why a gesture is refused (noema-277) — the rail says which of four states it is in.
//
// Four different situations render the same disabled control. `gestureBlock` names
// which one, `gestureBlockLine` gives the words, and `gestureTitle` puts the reason on
// the button in place of its label. The gating is NOT changed by any of it: the tests
// below assert that a refusal gains words and never gains permission.

const OPEN = { hasSession: true, recorded: true, writing: false }

test('a piece the ledger never took says so, and says it in the product’s own words', () => {
  const block = gestureBlock({ ...OPEN, recorded: false })
  assert.equal(block, 'not-recorded')

  // The sentence names what happened — the piece was not written to the session — and
  // therefore why there is nothing to react against.
  const line = gestureBlockLine('not-recorded')
  assert.match(line, /not written to the session/)
  assert.match(line, /nothing to react against/)

  // It must NOT promise a retry: a piece that was never recorded does not become
  // recorded by waiting or by tapping again, and this item adds no retry affordance.
  assert.doesNotMatch(line, /try again|retry|refresh/i)

  // And the button carries the reason instead of its own label.
  const gesture = TILE_GESTURES[0]!
  assert.equal(gestureTitle(block, gesture.label), line)
  assert.notEqual(gestureTitle(block, gesture.label), gesture.label)
})

test('a gesture already being written reads as in flight, not as unavailable', () => {
  const block = gestureBlock({ ...OPEN, writing: true })
  assert.equal(block, 'in-flight')

  // This is the only one of the four that resolves by waiting, so it must not be worded
  // as the not-recorded refusal — the two render identically without a reason.
  const line = gestureBlockLine('in-flight')
  assert.match(line, /writing/i)
  assert.notEqual(line, gestureBlockLine('not-recorded'))
  assert.notEqual(line, gestureBlockLine('no-session'))

  // A piece being written is still a recorded piece: the ledger is not the reason here.
  assert.doesNotMatch(line, /not written to the session/)
})

test('a piece already in the set still says it is saved', () => {
  const fox = frag('subject', 'a fox')
  const view = session([fox], { pieces: [ledgerPiece('run-1', [fox], { saved: true })] })
  const saved = savedOf(view, 'run-1')
  assert.equal(saved, true)

  const block = gestureBlock({ ...OPEN, saved })
  assert.equal(block, 'saved')
  assert.match(gestureBlockLine('saved'), /saved/)
  assert.match(gestureBlockLine('saved'), /in the set/)

  // `saved` is read LAST: a saved piece in a session that never recorded it is refused
  // for the ledger, which is the more fundamental reason of the two.
  assert.equal(gestureBlock({ ...OPEN, recorded: false, saved: true }), 'not-recorded')

  // A piece NOT in the set keeps its own label rather than borrowing a reason.
  const save = EXPANDED_GESTURES[EXPANDED_GESTURES.length - 1]!
  assert.equal(save.key, 'save')
  assert.equal(gestureTitle(gestureBlock({ ...OPEN, saved: false }), save.label), save.label)
})

test('with no session open the rail says the session is not ready rather than nothing', () => {
  const block = gestureBlock({ hasSession: false, recorded: false, writing: false })
  assert.equal(block, 'no-session')

  const line = gestureBlockLine('no-session')
  assert.match(line, /session/)
  assert.notEqual(line, gestureBlockLine('not-recorded'))

  // Every gesture on both rails carries it — none of them falls back to a bare glyph.
  for (const g of [...TILE_GESTURES, ...EXPANDED_GESTURES]) {
    assert.equal(gestureTitle(block, g.label), line)
  }
})

test('the tile does not carry save, and says that rather than reading as unavailable', () => {
  // The tile passes no save handler (V8a): the gesture is not offered there, which is a
  // different statement from the piece being ungestureable.
  const block = gestureBlock({ ...OPEN, offered: false })
  assert.equal(block, 'not-offered')
  assert.match(gestureBlockLine('not-offered'), /open the piece/i)
  assert.equal(TILE_GESTURES.some((g) => g.key === 'save'), false)
})

test('adding a reason never turns a refusal into permission', () => {
  // The gating rule is unchanged: a gesture is permitted in exactly the case the screen
  // permitted it before — a session open, the piece in its ledger, nothing in flight.
  assert.equal(gestureBlock(OPEN), null)
  assert.equal(gestureTitle(null, 'more like this'), 'more like this')

  for (const gate of [
    { ...OPEN, hasSession: false },
    { ...OPEN, recorded: false },
    { ...OPEN, writing: true },
    { ...OPEN, saved: true },
    { ...OPEN, offered: false },
  ]) {
    assert.notEqual(gestureBlock(gate), null, 'a refused gesture stays refused')
    assert.ok(gestureBlockLine(gestureBlock(gate)!).length > 0, 'and it is refused out loud')
  }

  // Every state has words, and no two states share them — the whole point is that the
  // four are distinguishable to a reader.
  const lines = (['no-session', 'not-recorded', 'in-flight', 'saved', 'not-offered'] as const)
    .map((b) => gestureBlockLine(b))
  assert.equal(new Set(lines).size, lines.length)
})

// ── what a decompose has left to do (noema-278) ──────────────────────────────
//
// A decompose spends one model call per item it runs, and an item that already carries
// fragments has been through the extractor. The control must therefore quote the work that is
// actually left rather than the size of the pass, must not fire at all when there is none, and
// must make the rebuild-everything path an explicit ask that says what it covers.

/** A dataset with a caption pass over three images, `decomposed` of which carry fragments. */
function decomposeSet(captioned: string[], decomposed: string[]) {
  const frag = [{ category: 'subject' as const, text: 'a woman', source: 'set', trigger: '' }]
  return {
    captionsets: [{
      id: 'cs-1',
      captions: Object.fromEntries(captioned.map((id) => [id, `caption for ${id}`])),
    }],
    media: ['m-1', 'm-2', 'm-3'].map((id) => ({
      id,
      ...(decomposed.includes(id) ? { fragments: frag } : {}),
    })),
  }
}

test('the control counts only the items a decompose would actually run', () => {
  const partly = decomposeSet(['m-1', 'm-2', 'm-3'], ['m-1', 'm-2'])
  assert.deepEqual(decomposeWorkload(partly, 'cs-1'), { pending: 1, already: 2, captioned: 3 })

  // Counting captions instead would quote three images — and three model calls — for one item's
  // worth of new fragments.
  const fresh = decomposeSet(['m-1', 'm-2', 'm-3'], [])
  assert.deepEqual(decomposeWorkload(fresh, 'cs-1'), { pending: 3, already: 0, captioned: 3 })

  // An empty caption is no caption: it produces no fragment, so it is not work.
  const blank = decomposeSet(['m-1', 'm-2'], [])
  blank.captionsets[0]!.captions['m-2'] = '   '
  assert.deepEqual(decomposeWorkload(blank, 'cs-1'), { pending: 1, already: 0, captioned: 1 })

  // No pass chosen, and a pass that is not on the dataset, are both "nothing to run".
  assert.deepEqual(decomposeWorkload(partly, null), { pending: 0, already: 0, captioned: 0 })
  assert.deepEqual(decomposeWorkload(partly, 'cs-elsewhere'), { pending: 0, already: 0, captioned: 0 })
})

test('the decompose control says how many images are left, or that there are none', () => {
  const left = decomposePlanNote({ pending: 2, already: 28, captioned: 30 }, false)
  assert.match(left, /2 images left to decompose/)
  assert.match(left, /28 images are already decomposed/)

  const none = decomposePlanNote({ pending: 0, already: 30, captioned: 30 }, false)
  assert.match(none, /already decomposed/)
  assert.doesNotMatch(none, /left to decompose/)

  // The expensive path names its own size rather than borrowing the incremental sentence.
  const redo = decomposePlanNote({ pending: 0, already: 30, captioned: 30 }, true)
  assert.match(redo, /all 30 images/)
  assert.match(redo, /replaces the fragments/)

  // One image is one image.
  assert.match(decomposePlanNote({ pending: 1, already: 0, captioned: 1 }, false), /1 image left/)
})

test('a decompose with nothing left to run is not armed, and a redo of the same set is', () => {
  const armedGate = { captionsetId: 'cs-1', inFlight: false }
  assert.equal(canFireDecompose({ ...armedGate, pending: 2 }), true)
  assert.equal(canFireDecompose({ ...armedGate, pending: 0 }), false)
  // A redo hands no pending count — the whole pass is the work, whatever is decomposed already.
  assert.equal(canFireDecompose(armedGate), true)
  // The other two rules still bite regardless of the workload.
  assert.equal(canFireDecompose({ captionsetId: 'cs-1', inFlight: true, pending: 2 }), false)
  assert.equal(canFireDecompose({ captionsetId: null, inFlight: false, pending: 2 }), false)
})

test('a decompose asks to redo everything only when the user said so', () => {
  assert.equal('redo' in decomposeRunRequest({ datasetId: 'ds-1', captionsetId: 'cs-1' }).aditus, false)
  assert.equal('redo' in decomposeRunRequest({ datasetId: 'ds-1', captionsetId: 'cs-1', redo: false }).aditus, false)
  assert.equal(decomposeRunRequest({ datasetId: 'ds-1', captionsetId: 'cs-1', redo: true }).aditus.redo, true)
})

test('a decompose refused for having nothing to do reads as a status, not as a failure', () => {
  const note = decomposeFailureNote(`409 {"error":{"code":"${DECOMPOSE_NOTHING_TO_DO_CODE}","message":"..."}}`)
  assert.match(note, /already decomposed/)
  assert.match(note, /nothing was spent/)
  assert.doesNotMatch(note, /couldn't decompose/, 'the press was reasonable — this is the status that was missing')
})

// ---------------------------------------------------------------------------
// The session history (noema-274) — every session a dataset carries, findable.
//
// The resume lookup was the ONLY consumer of the session list: the screen took the most
// recently changed session and dropped the rest, so an earlier session could not be
// addressed from the product at all. These are the rules a history is made of, and the
// one that keeps browsing from being mistaken for working.
//
// Fixtures are invented throughout (`ses-…`, `run-…`, `ds-…`).
// ---------------------------------------------------------------------------


// Non-vacuity 1 — the list is ordered by the work, newest first

test('sessions are listed most recently worked first', () => {
  const fox = frag('subject', 'a fox')
  const oldest = session([fox], { id: 'ses-oldest', mutatum: '2026-01-01T00:00:00.000Z' })
  const newest = session([fox], { id: 'ses-newest', mutatum: '2026-03-09T00:00:00.000Z' })
  const middle = session([fox], { id: 'ses-middle', mutatum: '2026-02-02T00:00:00.000Z' })

  const rows = sessionHistory([oldest, newest, middle])
  assert.deepEqual(rows.map((r) => r.id), ['ses-newest', 'ses-middle', 'ses-oldest'])

  // The first row is the session the bare muse door resumes into, which is what makes
  // the history read the same way the product behaves.
  assert.equal(rows[0]!.id, latestSession([oldest, newest, middle])!.id)
})

// Non-vacuity 2 — a session that made nothing is the one most worth finding

test('a session that recorded no pieces is still listed, and says so', () => {
  const fox = frag('subject', 'a fox')
  const nothing = session([fox], { id: 'ses-nothing', pieces: [] })
  const something = session([fox], {
    id: 'ses-something',
    pieces: [ledgerPiece('run-1', [fox], { saved: true }), ledgerPiece('run-2', [fox])],
  })

  const rows = sessionHistory([nothing, something])
  assert.equal(rows.length, 2, 'a session with an empty ledger is not filtered out of its own history')

  const empty = rows.find((r) => r.id === 'ses-nothing')!
  assert.equal(empty.empty, true)
  assert.equal(empty.pieces, 0)
  assert.match(empty.line, /nothing was recorded/, 'and the row says it out loud rather than rendering a bare 0')

  const worked = rows.find((r) => r.id === 'ses-something')!
  assert.match(worked.line, /2 pieces/)
  assert.match(worked.line, /1 saved/)
  assert.doesNotMatch(worked.line, /nothing was recorded/)

  // One piece is one piece, and a session that saved none of them says that too.
  assert.match(sessionRow(session([fox], { pieces: [ledgerPiece('run-1', [fox])] })).line, /1 piece · none saved/)
})

// Non-vacuity 3 — browsing is not working: reading an old session must not move the door

test('opening an older session does not change which session a bare visit resumes', () => {
  const fox = frag('subject', 'a fox')
  const current = session([fox], { id: 'ses-current', mutatum: '2026-03-09T00:00:00.000Z' })
  const older = session([fox], { id: 'ses-older', mutatum: '2026-02-01T00:00:00.000Z' })
  const all = [current, older]

  // A visit naming a session READS that one session: no list, no spawn, and no write.
  // `MuseSessions.save` restamps `mutatum`, and `mutatum` is both this list's sort key
  // and what `latestSession` resumes by — so a history that wrote to a session merely
  // because it was looked at would silently move the resume pointer onto it.
  const entry = sessionEntry(older.id)
  assert.deepEqual(entry, { kind: 'read', sessionId: 'ses-older' })
  assert.equal(entryStampsSession(entry), false, 'arriving writes nothing to the session it names')

  // and so, after opening the older one, the bare door still resumes the current work
  assert.equal(latestSession(all)!.id, 'ses-current')
  assert.equal(sessionHistory(all)[0]!.id, 'ses-current')

  // A bare visit is unchanged: list, resume the most recent, spawn only when there is none.
  assert.deepEqual(sessionEntry(null), { kind: 'resume' })
  assert.deepEqual(sessionEntry(''), { kind: 'resume' })
  assert.deepEqual(sessionEntry('   '), { kind: 'resume' })

  // The session is named ON the existing muse route rather than replacing it, so every
  // link and bookmark that means "resume" keeps meaning that.
  assert.equal(sessionHref('ds-1', 'ses-older'), `/datasets/ds-1/muse?${SESSION_PARAM}=ses-older`)
  assert.equal(sessionHistoryHref('ds-1'), '/datasets/ds-1/muse/sessions')
  assert.equal(sessionHref('ds/1', 'ses one'), `/datasets/ds%2F1/muse?${SESSION_PARAM}=ses%20one`)
})

// Non-vacuity 4 — a session is hunted for by what it made

test('a search matches a session by the text of a fragment in a piece\'s lineage', () => {
  const fox = frag('subject', 'a fox')
  const harbor = frag('setting', 'a foggy harbor')
  const cat = frag('subject', 'a cat')

  const foxes = session([fox, harbor], {
    id: 'ses-foxes',
    mutatum: '2026-03-09T00:00:00.000Z',
    pieces: [ledgerPiece('run-1', [fox, harbor])],
  })
  const cats = session([cat], {
    id: 'ses-cats',
    mutatum: '2026-02-01T00:00:00.000Z',
    pieces: [ledgerPiece('run-2', [cat])],
  })
  const rows = sessionHistory([foxes, cats])

  assert.deepEqual(filterSessionHistory(rows, 'fox').map((r) => r.id), ['ses-foxes'])
  assert.deepEqual(filterSessionHistory(rows, 'harbor').map((r) => r.id), ['ses-foxes'],
    'any fragment of the lineage finds it, not just the subject')
  assert.deepEqual(filterSessionHistory(rows, 'FOGGY').map((r) => r.id), ['ses-foxes'], 'case is not a hurdle')
  assert.deepEqual(filterSessionHistory(rows, 'cat').map((r) => r.id), ['ses-cats'])
  assert.deepEqual(filterSessionHistory(rows, '').map((r) => r.id), ['ses-foxes', 'ses-cats'],
    'an empty search is not a filter, and the order is the history\'s own')

  // The dates a session was worked are searchable too — the other way a session is remembered.
  assert.deepEqual(filterSessionHistory(rows, '2026-02').map((r) => r.id), ['ses-cats'])

  // A row carries the distinct lineage texts it matched on, so the list can show them.
  assert.deepEqual(rows.find((r) => r.id === 'ses-foxes')!.lineage, ['a fox', 'a foggy harbor'])
  assert.equal(matchesSessionQuery(sessionRow(cats), 'fox'), false)

  // And a search that matches nothing says which field it ran over.
  assert.match(sessionSearchEmptyNote(filterSessionHistory(rows, 'zebra'), 'zebra')!, /fragments/)
  assert.match(sessionSearchEmptyNote([], '')!, /no muse sessions/)
  assert.equal(sessionSearchEmptyNote(rows, ''), null)
})

test('the dataset screen says how many sessions it has, or nothing at all', () => {
  const fox = frag('subject', 'a fox')
  assert.equal(sessionCountLine([]), null, 'with no sessions the door alone is the whole story')
  assert.match(sessionCountLine([session([fox])])!, /1 muse session\b/)
  assert.match(sessionCountLine([session([fox], { id: 'a' }), session([fox], { id: 'b' })])!, /2 muse sessions/)
})

test('a piece whose run cannot be read still renders, and says the image could not be read', () => {
  const fox = frag('subject', 'a fox')
  const view = session([fox], { pieces: [ledgerPiece('run-gone', [fox])] })

  // The rebuild puts the piece back from the ledger — lineage and all — and its image is
  // resolved from its own run afterwards, because a recorded piece stores no media.
  const rebuilt = rehydrateStream(view)
  assert.equal(rebuilt.pieces.length, 1)
  assert.equal(rebuilt.pieces[0]!.status, 'running')

  const settled = applyRunResult(rebuilt, 'run-gone', unreadableRun())
  const tile = settled.pieces[0]!
  assert.equal(tile.status, 'failed', 'a run that no longer resolves is a state, not a tile stuck on generating')
  assert.match(tile.error!, /could not be read/)
  assert.deepEqual(tile.lineage.map((f) => f.text), ['a fox'], 'and the piece keeps the lineage it was drawn from')
})

// ── The archive controls (noema-267) ────────────────────────────────────────
//
// Four rules, each gated here rather than in the screen: the confirmation, the undo offer, the
// filter that keeps an archived image out of the grid, and the count that follows it.

test('archiving asks once before it is done', () => {
  const set267: ArchiveTarget = { kind: 'dataset', datasetId: 'ds-1' }
  const image: ArchiveTarget = { kind: 'media', datasetId: 'ds-1', mediaId: 'm-2' }

  // Nothing is asking yet, so the first press on either control is a question, never the act.
  const firstSet = archiveStep(null, set267)
  assert.equal(firstSet.ask, true)
  assert.match(firstSet.ask ? firstSet.question : '', /archive this set\?/)
  const firstImage = archiveStep(null, image)
  assert.equal(firstImage.ask, true)
  assert.match(firstImage.ask ? firstImage.question : '', /remove this image\?/)

  // A second press on the SAME control carries it out, and hands back what to archive.
  const second = archiveStep(set267, set267)
  assert.equal(second.ask, false)
  assert.deepEqual(second.ask === false ? second.archive : null, set267)
  assert.equal(archiveStep(image, { kind: 'media', datasetId: 'ds-1', mediaId: 'm-2' }).ask, false)

  // A press on a DIFFERENT control asks again — a question open on one image can never carry
  // a press on another, which is the whole reason the confirmation is per-target.
  assert.equal(archiveStep(image, { kind: 'media', datasetId: 'ds-1', mediaId: 'm-3' }).ask, true)
  assert.equal(archiveStep(image, set267).ask, true)
  assert.equal(archiveStep(set267, image).ask, true)
  assert.equal(archiveStep({ kind: 'dataset', datasetId: 'ds-2' }, set267).ask, true)

  // And the user is told what archive means, once, in the product's own words: recoverable,
  // out of the lists, and not an erasure of what pointed at it.
  assert.match(ARCHIVE_MEANING, /not erasing/)
  assert.match(ARCHIVE_MEANING, /bring it back/)
})

test('an archive offers to be taken back', () => {
  const at = 1_000_000
  const image: ArchiveTarget = { kind: 'media', datasetId: 'ds-1', mediaId: 'm-2' }

  const offer = undoOffer({ target: image, at }, at + 1_000)
  assert.notEqual(offer, null, 'an archive that cannot be taken back is not the archive that was designed')
  assert.match(offer?.label ?? '', /take it back/)
  assert.deepEqual(offer?.target, image, 'the offer restores exactly what was archived')
  assert.match(offer?.line ?? '', /left the set/)

  // The whole set says so in its own words.
  const whole = undoOffer({ target: { kind: 'dataset', datasetId: 'ds-1' }, at }, at)
  assert.match(whole?.line ?? '', /archived/)
  assert.deepEqual(whole?.target, { kind: 'dataset', datasetId: 'ds-1' })

  // It is an offer with a window, and nothing archived is on offer before there is one.
  assert.notEqual(undoOffer({ target: image, at }, at + ARCHIVE_UNDO_WINDOW_MS), null)
  assert.equal(undoOffer({ target: image, at }, at + ARCHIVE_UNDO_WINDOW_MS + 1), null)
  assert.equal(undoOffer(null, at), null)
})

test('an archived image is not rendered in the set\'s grid', () => {
  const media = [
    { id: 'm-1', url: 'u1' },
    { id: 'm-2', url: 'u2', archivum: '2026-08-21T00:00:00.000Z' },
    { id: 'm-3', url: 'u3' },
  ]

  assert.deepEqual(liveRecords(media).map((m) => m.id), ['m-1', 'm-3'], 'the archived item is out of the grid')
  assert.equal(isArchived(media[1] as { archivum?: string }), true)
  assert.equal(isArchived({}), false, 'an item written before the field existed is live')
  assert.equal(isArchived({ archivum: '   ' }), false)
  // A dataset is archived the same way, which is what keeps an archived set off the shelf.
  assert.deepEqual(
    liveRecords([{ id: 'ds-1' }, { id: 'ds-2', archivum: '2026-08-21T00:00:00.000Z' }]).map((d) => d.id),
    ['ds-1'],
  )
  // Its chips leave the garden with it — an archived image must not keep seeding rolls.
  const pooled = poolDatasetFragments([
    { id: 'm-1', url: 'u1', source: 'upload', addedAt: 'n', fragments: [frag('subject', 'a fox', 'm-1')] },
    { id: 'm-2', url: 'u2', source: 'upload', addedAt: 'n', archivum: '2026-08-21T00:00:00.000Z', fragments: [frag('setting', 'a harbor', 'm-2')] },
  ])
  assert.deepEqual(pooled.map((f) => f.text), ['a fox'])
})

test('the header counts the images that are left', () => {
  const captions = Object.fromEntries(['m-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7', 'm-8', 'm-9']
    .map((id) => [id, `a caption for ${id}`]))
  const nine: { id: string; archivum?: string }[] = ['m-1', 'm-2', 'm-3', 'm-4', 'm-5', 'm-6', 'm-7', 'm-8', 'm-9'].map((id) => ({ id }))
  const archivedTwo = nine.map((m, i) => (i > 6 ? { ...m, archivum: '2026-08-21T00:00:00.000Z' } : m))

  // Seven of nine left. The header, the caption quote and the coverage line all say seven —
  // the server has already recomputed the pass' stored coverage over the same seven, so a
  // count over the whole array would contradict the fraction printed beside it.
  assert.equal(liveRecords(archivedTwo).length, 7)
  assert.equal(captionPassLabel({ media: archivedTwo }), 'Caption all 7 images →')
  assert.match(captionPassNote({ media: archivedTwo }), /7 images/)

  const partly = { media: archivedTwo, captionsets: [{ id: 'cs-1', coverage: '5/7', captions: { 'm-1': 'a fox', 'm-2': 'a heron', 'm-3': 'a bridge', 'm-4': 'fog', 'm-5': 'a rope' } }] }
  assert.match(captionCoverageLine(partly, 'cs-1'), /2 of 7 images have no caption in this pass/)
  assert.match(decomposeGateReason(partly, 'cs-1') ?? '', /2 of 7 images/)

  // The archived images are not counted as uncaptioned work either — they have left the pass.
  assert.equal(uncaptionedCount({ media: archivedTwo, captionsets: [{ id: 'cs-1', captions }] }, 'cs-1'), 0)
  assert.match(captionCoverageLine({ media: archivedTwo, captionsets: [{ id: 'cs-1', captions }] }, 'cs-1'), /all 7 images are captioned/)
})

// ═══════════════════════════════════════════════════════════════════════════
// THE HAND-FIRED PIECE CARRIES THE NOZZLE (noema-285)
//
// One nozzle control sits above both fire paths, so a piece fired by hand off a rolled
// card runs under the model that control is holding, exactly as a streamed piece does.
// `Muse.tsx#doFire` composes its request through `firedRunRequest` — the same composer
// the stream loop calls — so there is one place the two halves are put together and no
// second one to drift from it.
//
// BOTH HALVES OR NEITHER, per proofs 1 and 2 below: the trigger word in the prompt is
// what applies the weights, `pinnedModels` is what the run is allowed to load, and either
// alone is a full-price run that does something other than what the screen says.
//
// Proof 3 is the case this must NOT change: with nothing on the nozzle, a hand fire sends
// the request it sent before — same keys, same prompt string.
// ═══════════════════════════════════════════════════════════════════════════

// Non-vacuity 1 — the trigger reaches the prompt on the manual path

test('a hand-fired piece under a chosen stack carries every trigger token', () => {
  const edited = 'a fox in a foggy harbor, low sun'
  const stack = stacked(card(), SECOND)

  const request = firedRunRequest('flow-t2i', edited, stack)
  const fired = String(request.aditus.prompt)

  for (const entry of stack) {
    assert.match(fired, new RegExp(entry.trigger), `${entry.trigger} never reached the prompt the resolver reads`)
    assert.equal((fired.match(new RegExp(entry.trigger, 'g')) ?? []).length, 1, 'each token appears exactly once')
  }
  assert.match(fired, /^trigword, othertrig/, 'the tokens lead the prompt, in stack order')
  assert.match(fired, /a foggy harbor/, 'and the edited prompt is still all there')

  // The hand path composes the same string the stream path does for the same inputs —
  // one composer, so the model on screen means one thing on both.
  assert.equal(fired, promptWithAffix(edited, stack, undefined))

  // A standing affix rides alongside it without displacing a token.
  const withAffix = String(firedRunRequest('flow-t2i', edited, stack, AFFIX()).aditus.prompt)
  assert.match(withAffix, /^trigword, othertrig/)
  assert.match(withAffix, /a photograph of/)
  assert.match(withAffix, /shot on film$/)
})

// Non-vacuity 2 — the weights are pinned on the manual path

test('a hand-fired piece carries pinnedModels for that stack', () => {
  const stack = stacked(card(), SECOND, THIRD)
  const request = firedRunRequest('flow-t2i', 'a fox in a foggy harbor', stack)

  assert.deepEqual(request.pinnedModels, ['lora-1', 'lora-2', 'lora-3'], 'every chosen model is given to the run')
  assert.equal(request.modusId, 'flow-t2i')

  // BOTH HALVES: the pinned run is the one carrying the triggers, entry for entry. A pin
  // with no trigger downloads weights that are never applied, at full price.
  for (const entry of stack) {
    assert.ok(request.pinnedModels!.includes(entry.intellaId))
    assert.match(String(request.aditus.prompt), new RegExp(entry.trigger))
  }

  // A single chosen model is a stack of one — the same request, not a second shape.
  assert.deepEqual(firedRunRequest('flow-t2i', 'a fox', CHOICE()).pinnedModels, ['lora-1'])
})

// Non-vacuity 3 — with no model chosen, nothing about the request changes

test('a hand-fired piece with an EMPTY stack sends what it sends today', () => {
  const edited = ' a fox in a foggy harbor, low sun '

  // The request the manual path sent before it read the nozzle: the flow and the prompt,
  // and nothing else. Every empty spelling of "no model" gives back exactly that.
  const bare = ignitionRequest('flow-t2i', edited)
  for (const empty of [null, undefined, [] as LoraChoice[]]) {
    const request = firedRunRequest('flow-t2i', edited, empty)
    assert.deepEqual(request, bare, 'an empty nozzle reshaped the request')
    assert.equal('pinnedModels' in request, false, 'nothing is pinned when nothing was chosen')
    assert.equal(String(request.aditus.prompt), edited, 'the prompt is byte-identical, whitespace included')
    assert.deepEqual(Object.keys(request).sort(), ['aditus', 'modusId'])
  }

  // Still true with an empty affix object beside the empty nozzle.
  assert.deepEqual(firedRunRequest('flow-t2i', edited, null, {}), bare)
  assert.deepEqual(firedRunRequest('flow-t2i', edited, [], { prefix: '  ', suffix: '' }), bare)

  // A card with no trigger word cannot be stacked, so it can never turn a hand fire into
  // a pin with nothing to apply it.
  assert.deepEqual(stacked(card({ intellaId: 'lora-9', trigger: '  ' })), [])
  assert.equal('pinnedModels' in firedRunRequest('flow-t2i', edited, stacked(card({ trigger: '' }))), false)
})

// ── The setup comes back with the pieces (noema-287) ────────────────────────
//
// The floor and the piece ledger already survived a reload; the ENGINE did not. What is
// gated here is the round trip — what is written on commit, what is read back on mount,
// and the two rules that make a restore safe rather than expensive:
//
//   HYDRATING IS NOT FIRING. Every function on this path is a pure read. A restored
//   setup arms the screen and spends nothing; the launch control is still the only
//   thing that does.
//
//   A MODEL THAT IS NO LONGER THERE IS NAMED. A stored stack is re-resolved against the
//   catalog the chosen flow actually offers, and what does not resolve comes back by
//   name rather than being quietly dropped — firing under fewer models than the line
//   claims is a wrong image at full price.
//
// Fixtures are invented throughout (`ses-…`, `sample-lora`, `trigword`).

function setupSession(setup: MuseSetup): MuseSessionView {
  return {
    id: 'ses-1',
    owner: 'anima-1',
    motherDatasetId: 'ds-1',
    fragments: [],
    floor: [],
    pieces: [],
    keptRolls: [],
    setup,
    natum: '2026-01-01T00:00:00.000Z',
    mutatum: '2026-01-02T00:00:00.000Z',
  }
}

// Non-vacuity 1 — the stack and the run shape come back

test('a session resolved on mount restores its stack and run shape', () => {
  const first = card()
  const second = card({ intellaId: 'lora-2', nomen: 'other-lora', trigger: 'othertrig' })
  const offer = [first, second]

  // What a commit writes…
  const written = setupOf({
    modusId: 'flow-t2i',
    config: { mode: 'infinite', cap: 24, acknowledged: true },
    nozzle: [CHOICE({ weight: 0.8 }), CHOICE({ intellaId: 'lora-2', nomen: 'other-lora', trigger: 'othertrig' })],
    affix: { prefix: 'a standing lead', suffix: 'a standing trail' },
  })
  assert.equal(written.modusId, 'flow-t2i')
  assert.equal(written.mode, 'infinite')
  assert.equal(written.cap, 24)
  assert.deepEqual(written.nozzle?.map((e) => e.intellaId), ['lora-1', 'lora-2'])
  assert.equal(written.nozzle?.[0]?.weight, 0.8)
  assert.equal('weight' in written.nozzle![1]!, false, "no weight set means the model's own default")

  // …is what a mount reads back.
  const restored = hydrateSetup(setupSession(written))
  assert.equal(restored.modusId, 'flow-t2i')
  assert.equal(restored.config.mode, 'infinite')
  assert.equal(restored.config.cap, 24)
  assert.deepEqual(restored.affix, { prefix: 'a standing lead', suffix: 'a standing trail' })

  const { stack, missing } = resolveNozzle(restored.nozzle, offer, 'base-a')
  assert.deepEqual(missing, [], 'every model is still on offer, so nothing is missing')
  assert.deepEqual(stack.map((c) => c.intellaId), ['lora-1', 'lora-2'], 'in the order it was stacked')
  assert.equal(stack[0]!.weight, 0.8, 'the weight the user set comes back with it')
  assert.equal(stack[1]!.weight, null, "and an unset weight stays unset rather than inheriting its neighbour's")

  // The restored stack is a working nozzle, not a readout: it composes the same prompt
  // and pins the same weights a hand-chosen one does.
  assert.match(promptWithAffix('a fox', stack, restored.affix), /^trigword:0\.8, othertrig, a standing lead, a fox, a standing trail$/)
  assert.deepEqual(firedRunRequest('flow-t2i', 'a fox', stack, restored.affix).pinnedModels, ['lora-1', 'lora-2'])

  // A session that never committed a setup comes back on the screen's own defaults.
  const fresh = hydrateSetup(setupSession({}))
  assert.equal(fresh.modusId, null)
  assert.deepEqual(fresh.config, DEFAULT_STREAM_CONFIG)
  assert.deepEqual(fresh.nozzle, [])
  assert.deepEqual(fresh.affix, {})
  assert.deepEqual(hydrateSetup(null).config, DEFAULT_STREAM_CONFIG)
})

// Non-vacuity 3 — THE MONEY PROOF: consent does not survive the sitting that gave it

test('a restored session comes back UNACKNOWLEDGED', () => {
  // An infinite-mode acknowledgement is what stands in for the count an infinite run
  // does not have. It is refused in three places, and this is the last of them: the
  // write does not carry it, the wire type has no field for it, and the read forces it
  // false whatever arrives — which is what holds for a session written before the other
  // two existed.
  const written = setupOf({
    modusId: 'flow-t2i',
    config: { mode: 'infinite', cap: 12, acknowledged: true },
    nozzle: [],
  })
  assert.equal('acknowledged' in written, false, 'a commit does not write the acknowledgement')

  const smuggled = setupSession({ mode: 'infinite', cap: 12, acknowledged: true } as MuseSetup)
  const restored = hydrateSetup(smuggled)
  assert.equal(restored.config.mode, 'infinite', 'the run shape itself is restored')
  assert.equal(restored.config.acknowledged, false, 'the consent is not')

  // And the refusal is load-bearing, not cosmetic: the launch control is still shut
  // until this sitting acknowledges it for itself.
  const blocked = launchBlockReason({
    config: restored.config,
    modusId: 'flow-t2i',
    flowBlockReason: null,
    liveFragments: 3,
    quote: { modusId: 'flow-t2i', impetus: '40' },
  })
  assert.match(String(blocked), /stop it/, 'a restored infinite setup cannot launch until it is acknowledged again')
})

// Non-vacuity 4 — a hydrate is a read

test('hydrating fires no run and no quote', async () => {
  // Every request this app makes goes through `fetch`. Trapping it is the whole proof:
  // a hydrate that priced the flow, asked for a run, or read a balance would land here.
  const real = globalThis.fetch
  let calls = 0
  globalThis.fetch = (async (...args: unknown[]) => {
    calls += 1
    throw new Error(`a hydrate must make no request (${String(args[0])})`)
  }) as typeof fetch
  try {
    const written = setupOf({
      modusId: 'flow-t2i',
      config: { mode: 'batched', cap: 24, acknowledged: true },
      nozzle: [CHOICE({ weight: 0.8 })],
      affix: { prefix: 'a standing lead' },
    })
    const restored = hydrateSetup(setupSession(written))
    const resolved = resolveNozzle(restored.nozzle, [card()], 'base-a')
    missingNozzleNote(resolved.missing)

    assert.equal(calls, 0, 'restoring a setup made a request')
    assert.equal(resolved.stack.length, 1, 'and it still restored the setup')
  } finally {
    globalThis.fetch = real
  }

  // Armed, not spending: the restored setup carries no price of its own, and an unpriced
  // stream has no ceiling, so launch stays shut until the ordinary quote path prices it.
  const restored = hydrateSetup(setupSession({ modusId: 'flow-t2i', mode: 'batched', cap: 24 }))
  const unpriced = launchBlockReason({
    config: restored.config,
    modusId: restored.modusId,
    flowBlockReason: null,
    liveFragments: 3,
    quote: null,
  })
  assert.match(String(unpriced), /pricing/, 'a hydrated setup is priced the way a hand-chosen one is, not by the hydrate')
})

// Non-vacuity 5 — a model that is gone is named, not dropped

test('a restored stack naming a model that is gone SAYS SO', () => {
  const present = card()
  const written = setupOf({
    modusId: 'flow-t2i',
    config: { mode: 'batched', cap: 12, acknowledged: false },
    nozzle: [
      CHOICE({ weight: 0.8 }),
      CHOICE({ intellaId: 'lora-gone', nomen: 'deleted-lora', trigger: 'gonetrig' }),
    ],
  })
  const restored = hydrateSetup(setupSession(written))

  // The catalog no longer offers the second model — deleted, or made private since.
  const { stack, missing } = resolveNozzle(restored.nozzle, [present], 'base-a')
  assert.deepEqual(stack.map((c) => c.intellaId), ['lora-1'], 'only what is still offered goes on the nozzle')
  assert.deepEqual(missing, ['deleted-lora'], 'and what is not is handed back BY NAME')

  const note = missingNozzleNote(missing)
  assert.match(String(note), /deleted-lora/, 'the note names the model')
  assert.match(String(note), /without it/, 'and says what the next piece will fire without')
  assert.equal(missingNozzleNote([]), null, 'a stack that came back whole says nothing')
  assert.match(String(missingNozzleNote(['one-lora', 'other-lora'])), /one-lora, other-lora/)

  // The same refusal the picker makes: a LoRA trained on another base is a paid run that
  // cannot work, so a restored stack is not a way around it — and it is NAMED, not
  // dropped, for the same reason.
  const foreign = card({ intellaId: 'lora-foreign', nomen: 'foreign-lora', basis: 'base-b', trigger: 'ftrig' })
  const crossBase = resolveNozzle(
    [{ intellaId: 'lora-foreign', nomen: 'foreign-lora', trigger: 'ftrig' }],
    [foreign],
    'base-a',
  )
  assert.deepEqual(crossBase.stack, [])
  assert.deepEqual(crossBase.missing, ['foreign-lora'])

  // A catalog that could not be read restores nothing and names everything, rather than
  // stacking stored entries on trust.
  const unread = resolveNozzle(restored.nozzle, [], 'base-a')
  assert.deepEqual(unread.stack, [])
  assert.deepEqual(unread.missing, ['sample-lora', 'deleted-lora'])
})

test('a restored entry is rebuilt from the card the catalog offers now, not from what was stored', () => {
  // The trigger word and the name are stored so a resume can say what is missing — they
  // are not what fires. A model re-triggered since the stack was committed fires under
  // its CURRENT trigger, because the stored one would compose a prompt the resolver no
  // longer applies anything for.
  const retriggered = card({ nomen: 'renamed-lora', trigger: 'newtrig' })
  const { stack } = resolveNozzle(
    [{ intellaId: 'lora-1', nomen: 'sample-lora', trigger: 'oldtrig', weight: 0.8 }],
    [retriggered],
    'base-a',
  )
  assert.equal(stack[0]!.trigger, 'newtrig')
  assert.equal(stack[0]!.nomen, 'renamed-lora')
  assert.equal(stack[0]!.weight, 0.8, 'the weight is the stored entry\'s — it is the only part that is the user\'s')
  assert.match(promptWithTrigger('a fox', stack), /^newtrig:0\.8, a fox$/)
})

// ── Promotion: the gesture that makes the sitting durable (noema-307) ────────
//
// The mapping itself is the server's (`api/musePromote.ts`, asserted field by field in
// tests/unit/allocutio/api/musePromote.test.ts). What the screen owns is only whether to
// offer the gesture, what it claims when it does, and where it lands afterwards.

test('promoteBlockReason: an empty draw is the one refusal, and a thin floor is not one', () => {
  const fox = frag('subject', 'a fox');
  const harbor = frag('setting', 'a foggy harbor');

  assert.equal(promoteBlockReason(session([fox, harbor])), null, 'a live floor may be promoted');

  // One fragment is a collection of one repeated look — a choice, not an error.
  assert.equal(promoteBlockReason(session([fox])), null);

  // Nothing in the draw has no axis to expand, which is the same completeness firing
  // enforces — said before a draft is minted rather than after it.
  const dark = session([fox, harbor], {
    floor: [entry(fox, { enabled: false }), entry(harbor, { enabled: false })],
  });
  assert.ok(promoteBlockReason(dark), 'a floor with nothing left in the draw is refused');

  assert.ok(promoteBlockReason(null), 'and a sitting with no session yet has nothing to promote');
});

test('promoteLabel: the control counts the fragments it is claiming to promote', () => {
  const fox = frag('subject', 'a fox');
  const harbor = frag('setting', 'a foggy harbor');

  assert.match(promoteLabel(session([fox, harbor])), /\b2\b/);
  assert.equal(promoteLabel(session([fox])), 'make a collection from this fragment',
    'one fragment is said in the singular rather than as "1 fragments"');

  // The count is the LIVE floor, not the pool: a darkened fragment is not promoted and
  // must not be counted as though it were.
  const half = session([fox, harbor], { floor: [entry(fox), entry(harbor, { enabled: false })] });
  assert.match(promoteLabel(half), /\bthis fragment\b/);
});

test('promotedCollectionPath: a promotion lands in the new draft\'s own garden', () => {
  assert.equal(promotedCollectionPath('col-1'), '/collections/col-1/garden');
  assert.equal(promotedCollectionPath('a b/c'), '/collections/a%20b%2Fc/garden',
    'the id is encoded — an unescaped one would walk out of the route');
});

// ── training form affines: hydrate + write-through (noema-330) ──────────────
//
// Derive's baseModel/steps/trigger used to be bare useState — navigate away and the
// configuration was gone. They now live in the caller's per-modus affines: hydrated onto the
// form on mount, and written back on change. `chosenSet` is out of scope here — it is
// dataset-contextual (which captionset is newest), not a stored preference.

test('hydrateTrainingAffines: seeds the form from stored affines', () => {
  const stored = { baseModel: BASE_MODELS[1].id, steps: 2400, trigger: 'frostknight' };
  assert.deepEqual(hydrateTrainingAffines(stored), { baseModel: BASE_MODELS[1].id, steps: 2400, trigger: 'frostknight' });
});

test('hydrateTrainingAffines: no stored affines falls back to today\'s defaults', () => {
  const fallback = hydrateTrainingAffines(undefined);
  assert.deepEqual(fallback, hydrateTrainingAffines(null));
  assert.equal(fallback.baseModel, BASE_MODELS[0].id);
  assert.equal(fallback.trigger, '');
  assert.ok(fallback.steps > 0);
});

test('hydrateTrainingAffines: garbage is tolerated field-by-field, not as an all-or-nothing reject', () => {
  const defaults = hydrateTrainingAffines(undefined);

  // A base model this catalogue no longer offers falls back alone — a good stored trigger
  // and step count are not thrown out along with it.
  const droppedModel = hydrateTrainingAffines({ baseModel: 'retired-model-id', steps: 500, trigger: 'ok' });
  assert.equal(droppedModel.baseModel, defaults.baseModel);
  assert.equal(droppedModel.steps, 500);
  assert.equal(droppedModel.trigger, 'ok');

  // A non-numeric (or non-positive) steps falls back alone.
  assert.equal(hydrateTrainingAffines({ steps: 'lots' }).steps, defaults.steps);
  assert.equal(hydrateTrainingAffines({ steps: 0 }).steps, defaults.steps);
  assert.equal(hydrateTrainingAffines({ steps: -5 }).steps, defaults.steps);
  assert.equal(hydrateTrainingAffines({ steps: Number.NaN }).steps, defaults.steps);

  // A non-string trigger falls back alone.
  assert.equal(hydrateTrainingAffines({ trigger: 42 }).trigger, '');
});

test('buildTrainingAffinesPayload: writes the three training fields', () => {
  const payload = buildTrainingAffinesPayload(null, { baseModel: 'klein-4b', steps: 1500, trigger: 'frostknight' });
  assert.deepEqual(payload, { baseModel: 'klein-4b', steps: 1500, trigger: 'frostknight' });
});

test('buildTrainingAffinesPayload: merges onto the caller\'s existing record instead of clobbering it', () => {
  // setAffines replaces the whole per-modus map server-side, so a naive `{ baseModel, steps,
  // trigger }` PUT would erase any other key some other surface stored under this modus.
  const existing = { baseModel: 'zimage', steps: 1000, trigger: 'old', someOtherFlag: true };
  const payload = buildTrainingAffinesPayload(existing, { baseModel: 'klein-4b', steps: 1500, trigger: 'new' });
  assert.deepEqual(payload, { baseModel: 'klein-4b', steps: 1500, trigger: 'new', someOtherFlag: true });
});

// ---------------------------------------------------------------------------
// Kept rolls (noema-329) — the one durable act of a rolling sitting
//
// Rolling is free and a roll in progress is uncommitted work, so the report the
// screen is showing and the edits made to its text are the screen's own. Keeping is
// the explicit act: it is written to the session, and the panel is rendered from the
// session rather than from a local list, so a kept roll is still there when the
// session is opened again.
//
// Fixtures invented throughout.
// ---------------------------------------------------------------------------

test('a keep sends the prompt the user read and the verdict it was rolled at', () => {
  // The EDITED text, because that is the prompt on screen when the keep is pressed.
  assert.deepEqual(keptRollRequest('a lone figure, edited', false), { prompt: 'a lone figure, edited', paid: false })
  assert.deepEqual(keptRollRequest('  spaced  ', true), { prompt: 'spaced', paid: true })

  // The verdict is carried, never re-derived: it belongs to the roll, and the floor
  // and the nozzle it was rolled against both move afterwards.
  assert.equal(keptRollRequest('a lone figure', true).paid, true)
})

test('a keep is refused with no session to write against, and with nothing to keep', () => {
  const s = session([frag('subject', 'a fox')])
  assert.equal(keepBlocked(null, 'a lone figure'), true, 'no session, no ledger to keep against')
  assert.equal(keepBlocked(s, '   '), true, 'an empty prompt is nothing to keep')
  assert.equal(keepBlocked(s, 'a lone figure'), false)
})

test('the kept panel reads the session, so a kept roll comes back with it', () => {
  const fox = frag('subject', 'a fox')

  // NON-VACUITY: reading a screen-local `kept` array instead of the session would
  // return nothing here — the session below is exactly what a fresh mount receives,
  // and the local array a mount starts with is empty.
  const resumed = session([fox], {
    keptRolls: [
      { prompt: 'a fox, ink wash', paid: false },
      { prompt: 'a fox, dusk glow', paid: true },
    ],
  })
  assert.deepEqual(
    keptRollsOf(resumed).map((k) => k.prompt),
    ['a fox, ink wash', 'a fox, dusk glow'],
    'oldest first, as they were kept',
  )
  assert.equal(keptCount(resumed), 2, 'and the heading counts what the session holds')

  // A session that has kept nothing renders an empty panel, not an error.
  assert.deepEqual(keptRollsOf(session([fox])), [])
  assert.equal(keptCount(session([fox])), 0)

  // No session yet, and a session stored before the field existed, both read as empty.
  assert.deepEqual(keptRollsOf(null), [])
  assert.equal(keptCount(undefined), 0)
  const preField = { ...session([fox]) } as Partial<MuseSessionView>
  delete preField.keptRolls
  assert.deepEqual(keptRollsOf(preField as MuseSessionView), [], 'absent reads as empty')
})

// ── Activity bands (noema-326) ────────────────────────────────────────────────

test('partitionActivity: a running row lands in running, never in finished', () => {
  const rows = [activityRow({ actumId: 'a', status: 'running' }), activityRow({ actumId: 'b', status: 'settled' })];
  const { running, finished } = partitionActivity(rows);
  assert.deepEqual(running.map((r) => r.actumId), ['a']);
  assert.deepEqual(finished.map((r) => r.actumId), ['b']);
});

test('partitionActivity: a settled row lands in finished, never in running', () => {
  // Guards the OTHER direction too — a partition that dumped everything into one band
  // (or swapped the two) would still pass a test that only checked lengths.
  const rows = [activityRow({ actumId: 'x', status: 'settled' }), activityRow({ actumId: 'y', status: 'settled' })];
  const { running, finished } = partitionActivity(rows);
  assert.deepEqual(running, []);
  assert.deepEqual(finished.map((r) => r.actumId), ['x', 'y']);
});

test('activityBadgeCount: zero in-flight rows is zero, not a truthy placeholder', () => {
  const rows = [activityRow({ status: 'settled' }), activityRow({ status: 'settled' })];
  assert.equal(activityBadgeCount(rows), 0);
});

test('activityBadgeCount: counts only the running rows, ignoring settled ones', () => {
  const rows = [
    activityRow({ actumId: 'a', status: 'running' }),
    activityRow({ actumId: 'b', status: 'settled' }),
    activityRow({ actumId: 'c', status: 'running' }),
  ];
  assert.equal(activityBadgeCount(rows), 2);
});

test('activityKindLabel / activityDoorLabel: the app\'s own nouns, labels match where the door leads', () => {
  assert.equal(activityKindLabel('training'), 'training');
  assert.equal(activityKindLabel('caption'), 'caption pass');
  assert.equal(activityKindLabel('decompose'), 'decompose');
  assert.equal(activityKindLabel('generation'), 'generation');
  assert.equal(activityDoorLabel('generation'), 'view media');
  assert.equal(activityDoorLabel('training'), 'view models');
  assert.equal(activityDoorLabel('caption'), 'view captions');
  assert.equal(activityDoorLabel('decompose'), 'view cutting floor');
});

// ── Home "awaiting you" / "running now" bands (noema-327) ──────────────────────────────

function activityRow(over: Partial<ActivityRow> = {}): ActivityRow {
  return { actumId: 'a1', kind: 'generation', modusId: 'm1', status: 'settled', ...over }
}

test('partitionHomeActivity: splits real activity rows into settled (capped) and running', () => {
  // Real ActivityRow shapes only — status/kind/door are exactly what a client-local chat
  // title never carries, so feeding that list back in here would filter to empty on both
  // sides rather than reproducing a "recent" band.
  const settled = Array.from({ length: AWAITING_YOU_MAX + 3 }, (_, i) =>
    activityRow({ actumId: `settled-${i}`, status: 'settled' }))
  const running = [activityRow({ actumId: 'r1', status: 'running' }), activityRow({ actumId: 'r2', status: 'running' })]
  const { awaiting, running: runningOut } = partitionHomeActivity([...settled, ...running])
  assert.equal(awaiting.length, AWAITING_YOU_MAX)
  assert.deepEqual(awaiting.map((r) => r.actumId), settled.slice(0, AWAITING_YOU_MAX).map((r) => r.actumId))
  assert.deepEqual(runningOut.map((r) => r.actumId), ['r1', 'r2'])
})

test('partitionHomeActivity: chat-shaped (non-activity) input contributes to neither band', () => {
  // Feeding the OLD localStorage chat list back into the band (the regression this item
  // fixes) has no `status` field at all, so it partitions to nothing rather than rendering.
  const chatShaped = [{ kind: 'chat', detail: 'a title', project: 'demo' }] as unknown as ActivityRow[]
  const { awaiting, running } = partitionHomeActivity(chatShaped)
  assert.equal(awaiting.length, 0)
  assert.equal(running.length, 0)
})

test('activityRowLabel: prefers modusLabel, falls back to the house noun for the kind', () => {
  assert.equal(activityRowLabel(activityRow({ kind: 'training', modusLabel: 'Portrait LoRA' })), 'Portrait LoRA')
  assert.equal(activityRowLabel(activityRow({ kind: 'training' })), 'training')
  assert.equal(activityRowLabel(activityRow({ kind: 'caption' })), 'caption pass')
  assert.equal(activityRowLabel(activityRow({ kind: 'decompose' })), 'decompose')
  assert.equal(activityRowLabel(activityRow({ kind: 'generation' })), 'generation')
})

test('activityDoorHref: resolves each kind\'s door to its real destination', () => {
  assert.equal(activityDoorHref(activityRow({ kind: 'training', door: { modelId: 'model-1' } })), '/models')
  assert.equal(
    activityDoorHref(activityRow({ kind: 'caption', door: { datasetId: 'ds-1', captionsetId: 'cs-1' } })),
    '/datasets/ds-1/caption?captionset=cs-1',
  )
  assert.equal(activityDoorHref(activityRow({ kind: 'decompose', door: { datasetId: 'ds-1' } })), '/datasets/ds-1/muse')
  assert.equal(
    activityDoorHref(activityRow({ kind: 'generation', door: { mediaUrl: 'https://cdn.example/media/x.png' } })),
    'https://cdn.example/media/x.png',
  )
})

test('activityDoorHref: a row without the door fields its kind needs renders without a link, never a dead one', () => {
  assert.equal(activityDoorHref(activityRow({ kind: 'training', door: {} })), undefined)
  assert.equal(activityDoorHref(activityRow({ kind: 'caption', door: { datasetId: 'ds-1' } })), undefined)
  assert.equal(activityDoorHref(activityRow({ kind: 'decompose', door: {} })), undefined)
  assert.equal(activityDoorHref(activityRow({ kind: 'generation', door: {} })), undefined)
  assert.equal(activityDoorHref(activityRow({ kind: 'generation' })), undefined)
})
