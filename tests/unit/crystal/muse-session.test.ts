import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fragmentKey, type Fragment } from '../../../src/crystal/muse/taxonomy.js'
import { rollFragments } from '../../../src/crystal/muse/sampler.js'
import { buildGarden } from '../../../src/crystal/muse/garden.js'
import {
  DEFAULT_FRAGMENT_STATE,
  DuplicatePieceError,
  EmptyFragmentTextError,
  MANUAL_SOURCE,
  UnknownCategoryError,
  UnknownFragmentError,
  UnknownPieceError,
  addFragment,
  manualFragment,
  enabledFragments,
  fragmentStateOf,
  holdsFragment,
  lineageOf,
  rebuildFragments,
  recordPiece,
  setFragmentEnabled,
  setFragmentWeight,
  spawnSession,
  updatePiece,
  withSessionDataset,
  withSetup,
  normalizeSetup,
  keepRoll,
  keptRollsOf,
  normalizeKeptRolls,
  pieceOf,
} from '../../../src/crystal/muse/session.js'
import { MongoMuseSession } from '../../../src/crystal/MongoMuseSession.js'
import type { Collection } from 'mongodb'

// Hermetic: pure domain only. No I/O, no clock, no randomness — a session is a
// value, every operation returns a new one, and nothing here touches a store.
//
// ONE EXCEPTION, at the bottom of the file: the kept-rolls round trip drives
// `MongoMuseSession` over an in-memory collection double. The document mapping is
// module-private, and a session field missing from either half of it is dropped on
// every write and every read with nothing failing — so the mapping is only reachable
// through the store class. No driver connection and no clock: the double is a Map.

function frag(category: Fragment['category'], text: string, source = 'boardA'): Fragment {
  return { category, text, source, trigger: `${source}-trigger` }
}

/** A small mother: one fragment list, distinguishable, across three categories. */
function motherFragments(): Fragment[] {
  return [
    frag('subject', 'a lone figure'),
    frag('subject', 'two figures'),
    frag('hair', 'cropped silver hair'),
    frag('hair', 'long dark braid'),
    frag('mood', 'still and cold'),
  ]
}

// --- S7: the mother stays pure ----------------------------------------------

test('a session never mutates its mother’s fragments', () => {
  const mother = motherFragments()
  const before = mother.map((f) => ({ ...f }))
  const session = spawnSession('mother-dataset', mother)

  // The session's floor is not the mother's objects.
  for (const owned of session.fragments) {
    assert.ok(
      !mother.includes(owned),
      `the session holds the mother's own fragment object for '${owned.text}'`,
    )
  }

  // Working the session — darkening, weighting, recording — leaves the mother alone.
  let worked = setFragmentEnabled(session, mother[0]!, false)
  worked = setFragmentWeight(worked, mother[2]!, 4)
  worked = recordPiece(worked, {
    runId: 'run-1',
    rollIndex: 0,
    fragments: [mother[1]!, mother[3]!],
  })
  for (const owned of worked.fragments) {
    owned.source = 'rewritten-by-the-session'
  }

  assert.deepEqual(mother, before, 'the mother fragment list changed')

  // And the reverse: editing the mother afterwards does not reach the session.
  mother[0]!.text = 'rewritten-in-the-mother'
  assert.ok(
    session.fragments.some((f) => f.text === 'a lone figure'),
    'a mother edit reached the session floor',
  )
})

test('a spawned session starts every fragment on the floor, in the draw, at even odds', () => {
  const mother = motherFragments()
  const session = spawnSession('mother-dataset', mother)

  assert.equal(session.motherDatasetId, 'mother-dataset')
  assert.equal(session.fragments.length, mother.length)
  assert.equal(session.floor.size, mother.length)
  assert.deepEqual(session.pieces, [])
  for (const fragment of mother) {
    assert.deepEqual(
      fragmentStateOf(session, fragment),
      { enabled: DEFAULT_FRAGMENT_STATE.enabled, weight: DEFAULT_FRAGMENT_STATE.weight },
      `'${fragment.text}' did not start at the default floor state`,
    )
  }
})

test('the floor is the steer the sampler already reads', () => {
  const mother = motherFragments()
  const off = mother[0]!
  const session = setFragmentEnabled(spawnSession('mother-dataset', mother), off, false)
  const garden = buildGarden(mother).garden

  for (let i = 0; i < 100; i++) {
    const rolled = rollFragments(garden, i, session.floor)
    assert.ok(
      !rolled.some((f) => fragmentKey(f) === fragmentKey(off)),
      `roll ${i} drew a fragment the session floor has turned off`,
    )
    assert.ok(
      rolled.some((f) => f.category === 'subject'),
      `roll ${i} lost the category entirely instead of drawing its live fragment`,
    )
  }
})

// --- S8: identity-keyed floor, darkened not deleted --------------------------

test('a disabled fragment stays disabled after the fragment list is rebuilt', () => {
  const mother = motherFragments()
  const off = mother[2]! // 'cropped silver hair'
  const session = setFragmentEnabled(spawnSession('mother-dataset', mother), off, false)
  assert.equal(fragmentStateOf(session, off)?.enabled, false)

  // A rebuild renumbers everything: a fragment is dropped from the front, one is
  // added, and the order changes. Position-keyed state would land elsewhere.
  const rebuiltList: Fragment[] = [
    frag('mood', 'still and cold'),
    frag('hair', 'long dark braid'),
    frag('subject', 'a lone figure'),
    frag('hair', 'cropped silver hair'),
    frag('palette', 'bleached greys'),
  ]
  assert.notEqual(
    mother.findIndex((f) => fragmentKey(f) === fragmentKey(off)),
    rebuiltList.findIndex((f) => fragmentKey(f) === fragmentKey(off)),
    'the rebuild did not actually move the disabled fragment',
  )

  const rebuilt = rebuildFragments(session, rebuiltList)

  assert.equal(
    fragmentStateOf(rebuilt, off)?.enabled,
    false,
    'the disabled fragment came back enabled after the rebuild',
  )
  assert.ok(holdsFragment(rebuilt, off), 'the disabled fragment left the floor')
  assert.ok(
    rebuilt.fragments.some((f) => fragmentKey(f) === fragmentKey(off)),
    'the disabled fragment was deleted rather than darkened',
  )
  // Everything else the rebuild brought in is live at the default.
  for (const fragment of rebuiltList) {
    if (fragmentKey(fragment) === fragmentKey(off)) continue
    assert.equal(
      fragmentStateOf(rebuilt, fragment)?.enabled,
      true,
      `'${fragment.text}' did not survive the rebuild in the draw`,
    )
  }
  assert.equal(
    enabledFragments(rebuilt).length,
    rebuiltList.length - 1,
    'the rebuilt floor did not keep exactly one fragment out of the draw',
  )
})

test('a weighted fragment keeps its weight across a rebuild, and a dropped identity takes its state with it', () => {
  const mother = motherFragments()
  const heavy = mother[1]!
  const dropped = mother[4]!
  const session = setFragmentWeight(spawnSession('mother-dataset', mother), heavy, 4)

  const rebuilt = rebuildFragments(
    session,
    mother.filter((f) => fragmentKey(f) !== fragmentKey(dropped)).reverse(),
  )

  assert.equal(fragmentStateOf(rebuilt, heavy)?.weight, 4, 'the weight did not survive the rebuild')
  assert.equal(fragmentStateOf(rebuilt, dropped), undefined)
  assert.equal(holdsFragment(rebuilt, dropped), false)
})

test('a darkened fragment is tappable back to live', () => {
  const mother = motherFragments()
  const target = mother[3]!
  const dark = setFragmentEnabled(spawnSession('mother-dataset', mother), target, false)
  const live = setFragmentEnabled(dark, target, true)

  assert.equal(fragmentStateOf(live, target)?.enabled, true)
  assert.equal(fragmentStateOf(dark, target)?.enabled, false, 'the earlier session value was mutated')
})

test('a weight is clamped to the bounds the sampler enforces', () => {
  const mother = motherFragments()
  const session = spawnSession('mother-dataset', mother)

  assert.equal(fragmentStateOf(setFragmentWeight(session, mother[0]!, 500), mother[0]!)?.weight, 8)
  assert.equal(
    fragmentStateOf(setFragmentWeight(session, mother[0]!, 0.0001), mother[0]!)?.weight,
    0.125,
  )
})

// --- V10 / S11: the piece ledger carries lineage -----------------------------

test('a recorded piece names the fragments that produced it', () => {
  const mother = motherFragments()
  const session = spawnSession('mother-dataset', mother)
  const drawn = [mother[1]!, mother[2]!, mother[4]!]

  const after = recordPiece(session, { runId: 'run-7', rollIndex: 3, fragments: drawn })

  assert.equal(after.pieces.length, 1)
  const piece = after.pieces[0]!
  assert.equal(piece.runId, 'run-7')
  assert.equal(piece.rollIndex, 3)
  assert.deepEqual(
    piece.fragments.map(fragmentKey),
    drawn.map(fragmentKey),
    'the piece did not record the fragments that produced it',
  )
  assert.deepEqual(
    lineageOf(after, 'run-7')?.map(fragmentKey),
    drawn.map(fragmentKey),
    'the lineage is not retrievable by run',
  )
  assert.equal(piece.saved, false)
  assert.equal(piece.dismissed, false)
  assert.equal(piece.reaction, undefined)

  // Recording does not touch the session it was recorded from.
  assert.equal(session.pieces.length, 0, 'the earlier session value gained a piece')
})

test('a recorded lineage is a copy, so later edits to the drawn fragments cannot rewrite it', () => {
  const mother = motherFragments()
  const drawn = [{ ...mother[0]! }]
  const after = recordPiece(spawnSession('mother-dataset', mother), {
    runId: 'run-8',
    rollIndex: 0,
    fragments: drawn,
  })

  drawn[0]!.text = 'rewritten after the fact'

  assert.equal(after.pieces[0]!.fragments[0]!.text, 'a lone figure')
})

test('a piece carries its reaction and its keep/discard flags as recorded', () => {
  const mother = motherFragments()
  const after = recordPiece(spawnSession('mother-dataset', mother), {
    runId: 'run-9',
    rollIndex: 1,
    fragments: [mother[0]!],
    reaction: 'up',
    saved: true,
    dismissed: false,
  })

  assert.equal(after.pieces[0]!.reaction, 'up')
  assert.equal(after.pieces[0]!.saved, true)
  assert.equal(after.pieces[0]!.dismissed, false)
})

test('a piece cannot cite a fragment its session does not have', () => {
  const mother = motherFragments()
  const session = spawnSession('mother-dataset', mother)
  const stranger = frag('props', 'a brass telescope', 'boardB')

  assert.throws(
    () =>
      recordPiece(session, {
        runId: 'run-10',
        rollIndex: 0,
        fragments: [mother[0]!, stranger],
      }),
    (error: unknown) => {
      assert.ok(error instanceof UnknownFragmentError)
      assert.equal(error.citedKey, fragmentKey(stranger))
      return true
    },
    'a piece citing a fragment off the floor was recorded',
  )

  assert.equal(session.pieces.length, 0, 'the rejected piece was appended anyway')

  // A fragment that is on the floor but darkened is still one the session has:
  // a piece rolled before it was turned off is a real piece with a real lineage.
  const darkened = setFragmentEnabled(session, mother[0]!, false)
  const recorded = recordPiece(darkened, {
    runId: 'run-11',
    rollIndex: 0,
    fragments: [mother[0]!],
  })
  assert.equal(recorded.pieces.length, 1)
})

test('a piece cannot cite a fragment the mother dropped in a rebuild', () => {
  const mother = motherFragments()
  const gone = mother[4]!
  const rebuilt = rebuildFragments(
    spawnSession('mother-dataset', mother),
    mother.filter((f) => fragmentKey(f) !== fragmentKey(gone)),
  )

  assert.throws(
    () => recordPiece(rebuilt, { runId: 'run-12', rollIndex: 0, fragments: [gone] }),
    UnknownFragmentError,
  )
})

// --- S13 / V11: the session knows its mother ---------------------------------

test('a session knows the dataset it broke off from, and two sessions off one mother are independent', () => {
  const mother = motherFragments()
  const a = setFragmentEnabled(spawnSession('mother-dataset', mother), mother[0]!, false)
  const b = spawnSession('mother-dataset', mother)

  assert.equal(a.motherDatasetId, 'mother-dataset')
  assert.equal(b.motherDatasetId, 'mother-dataset')
  assert.equal(fragmentStateOf(a, mother[0]!)?.enabled, false)
  assert.equal(fragmentStateOf(b, mother[0]!)?.enabled, true, 'one session steered another')
})

test('a fragment list carrying the same identity twice lands on one floor entry', () => {
  const doubled = [frag('subject', 'a lone figure'), frag('subject', 'A Lone Figure', 'boardB')]
  const session = spawnSession('mother-dataset', doubled)

  assert.equal(session.floor.size, 1)
  assert.equal(session.fragments.length, 1)
})

// --- One entry per run, and reaching a piece after it is recorded ------------

test('recording the same runId twice does not append a second ledger entry', () => {
  const mother = motherFragments()
  const session = recordPiece(spawnSession('mother-dataset', mother), {
    runId: 'run-1',
    rollIndex: 0,
    fragments: [mother[0]!, mother[2]!],
  })

  assert.throws(
    () =>
      recordPiece(session, {
        runId: 'run-1',
        rollIndex: 1,
        fragments: [mother[1]!],
      }),
    (error: unknown) => {
      assert.ok(error instanceof DuplicatePieceError)
      assert.equal(error.runId, 'run-1')
      return true
    },
    'a second record for one run was appended',
  )

  assert.equal(session.pieces.length, 1, 'the ledger holds one entry per run')

  // The rejection is about the run, not about recording: a different run still lands.
  const second = recordPiece(session, { runId: 'run-2', rollIndex: 1, fragments: [mother[1]!] })
  assert.equal(second.pieces.length, 2)
  assert.deepEqual(second.pieces.map((p) => p.runId), ['run-1', 'run-2'])
})

test('a reaction lands on the piece it names', () => {
  const mother = motherFragments()
  const ledger = recordPiece(
    recordPiece(spawnSession('mother-dataset', mother), {
      runId: 'run-1',
      rollIndex: 0,
      fragments: [mother[0]!],
    }),
    { runId: 'run-2', rollIndex: 1, fragments: [mother[1]!] },
  )

  const reacted = updatePiece(ledger, 'run-2', { reaction: 'up' })

  assert.equal(pieceOf(reacted, 'run-2')?.reaction, 'up')
  assert.equal(pieceOf(reacted, 'run-1')?.reaction, undefined, 'the reaction landed on the wrong piece')
  assert.equal(ledger.pieces[1]!.reaction, undefined, 'the source session was mutated in place')

  // The ledger keeps its order and its lineage — an update is not a re-record.
  assert.deepEqual(reacted.pieces.map((p) => p.runId), ['run-1', 'run-2'])
  assert.deepEqual(
    pieceOf(reacted, 'run-2')!.fragments.map((f) => fragmentKey(f)),
    [fragmentKey(mother[1]!)],
  )
  assert.equal(pieceOf(reacted, 'run-2')?.rollIndex, 1)
})

test('a dismissal and a reaction are independent, and either alone leaves the other as it was', () => {
  const mother = motherFragments()
  const ledger = recordPiece(spawnSession('mother-dataset', mother), {
    runId: 'run-1',
    rollIndex: 0,
    fragments: [mother[0]!],
    reaction: 'note',
  })

  const dismissed = updatePiece(ledger, 'run-1', { dismissed: true })
  assert.equal(pieceOf(dismissed, 'run-1')?.dismissed, true)
  assert.equal(pieceOf(dismissed, 'run-1')?.reaction, 'note', 'a dismissal cleared the reaction')

  const rereacted = updatePiece(dismissed, 'run-1', { reaction: 'down' })
  assert.equal(pieceOf(rereacted, 'run-1')?.reaction, 'down')
  assert.equal(pieceOf(rereacted, 'run-1')?.dismissed, true, 'a reaction cleared the dismissal')

  // An empty patch is a no-op rather than a reset.
  const untouched = updatePiece(rereacted, 'run-1', {})
  assert.equal(pieceOf(untouched, 'run-1')?.reaction, 'down')
  assert.equal(pieceOf(untouched, 'run-1')?.dismissed, true)
})

test('an update naming a run the ledger does not hold is rejected rather than recording one', () => {
  const mother = motherFragments()
  const ledger = recordPiece(spawnSession('mother-dataset', mother), {
    runId: 'run-1',
    rollIndex: 0,
    fragments: [mother[0]!],
  })

  assert.throws(
    () => updatePiece(ledger, 'run-never-rolled', { reaction: 'up' }),
    (error: unknown) => {
      assert.ok(error instanceof UnknownPieceError)
      assert.equal(error.runId, 'run-never-rolled')
      return true
    },
  )
  assert.equal(ledger.pieces.length, 1, 'an update created a ledger entry')
})

// ---------------------------------------------------------------------------
// The manual add (noema-242) — the free way to widen a floor
//
// Every other mutator here reweights a floor. This one WIDENS it, and it does so
// for nothing: the four tests below are the four properties that make it the free
// half of the add — no model behind it, inside the taxonomy, never reaching the
// mother, and never a second copy of one identity.
// ---------------------------------------------------------------------------

test('a manual add reaches no model and no key', () => {
  const session = spawnSession('mother-dataset', motherFragments())

  // Synchronous by construction. A path that called a model would have to be
  // awaited, so a thenable here is the shape of a manual add that stopped being
  // free — this assertion is what a fetch on the add path breaks.
  const fragment = manualFragment('mood', 'a wet street at dawn')
  const widened = addFragment(session, fragment)
  assert.ok(!(widened instanceof Promise), 'the add path returned a promise')
  assert.equal(typeof (widened as { then?: unknown }).then, 'undefined', 'the add path is awaitable')
  assert.equal(typeof (fragment as { then?: unknown }).then, 'undefined', 'building the fragment is awaitable')

  // The fragment carries exactly the four fields a fragment has: no flow, no model,
  // no key, no quote came back with it.
  assert.deepEqual(
    Object.keys(widened.fragments.at(-1)!).sort(),
    ['category', 'source', 'text', 'trigger'],
    'a manually added fragment carries a field a fragment does not have',
  )

  // Attribution is stated rather than inferred: the source says the user wrote it,
  // and the trigger is empty because there is no model binding behind it.
  assert.equal(widened.fragments.at(-1)!.source, MANUAL_SOURCE)
  assert.equal(widened.fragments.at(-1)!.trigger, '')

  // It lands in the draw at even odds, like every other fragment on the floor.
  assert.deepEqual(fragmentStateOf(widened, fragment), { ...DEFAULT_FRAGMENT_STATE })
})

test('a fragment cannot be added outside the taxonomy', () => {
  assert.throws(
    () => manualFragment('vibe', 'something ineffable'),
    (error: unknown) => {
      assert.ok(error instanceof UnknownCategoryError)
      assert.equal(error.category, 'vibe')
      return true
    },
  )

  // A fragment needs text of its own — an empty phrase has no identity to key it by.
  assert.throws(() => manualFragment('mood', '   '), EmptyFragmentTextError)

  // And the reason the constraint matters: a fragment inside the taxonomy lands in a
  // pool the sampler actually reads, so it can be drawn. One filed anywhere else
  // would sit on the floor and never appear in a roll.
  const widened = addFragment(
    spawnSession('mother-dataset', motherFragments()),
    manualFragment('outfit', 'a borrowed overcoat'),
  )
  const garden = buildGarden(enabledFragments(widened)).garden
  assert.ok(
    (garden.outfit ?? []).some((f) => f.text === 'a borrowed overcoat'),
    'a manually added fragment did not reach a pool the sampler reads',
  )
  // The only outfit fragment on this floor, so every roll must draw it.
  assert.equal((garden.outfit ?? []).length, 1)
  const drawn = rollFragments(garden, 0, widened.floor)
  assert.ok(
    drawn.some((f) => f.text === 'a borrowed overcoat'),
    'a manually added fragment was never drawable',
  )
})

test('a manual add never writes the mother dataset', () => {
  const mother = motherFragments()
  const motherBefore = mother.map((f) => ({ ...f }))
  const session = spawnSession('mother-dataset', mother)

  const widened = addFragment(session, manualFragment('style', 'hand-tinted photograph'))

  // The mother's own fragment list is the array the session was spawned from. A manual
  // add appends to a new list; it must not reach that one, by reference or by write.
  assert.deepEqual(mother, motherBefore, 'the mother dataset\'s fragments were mutated')
  assert.equal(mother.length, motherBefore.length, 'a fragment was pushed onto the mother')
  assert.ok(
    !mother.some((f) => f.text === 'hand-tinted photograph'),
    'a manually added fragment reached the mother dataset',
  )

  // The session it was called on is unchanged too — same immutable convention as
  // every other mutator in this module.
  assert.equal(session.fragments.length, motherBefore.length)
  assert.equal(widened.fragments.length, motherBefore.length + 1)
  assert.equal(widened.motherDatasetId, 'mother-dataset')
})

test('adding a fragment already on the floor does not duplicate it', () => {
  const session = spawnSession('mother-dataset', motherFragments())
  const once = addFragment(session, manualFragment('props', 'a paper lantern'))
  const twice = addFragment(once, manualFragment('props', 'a paper lantern'))

  assert.equal(twice, once, 'a second add of one identity produced a new session')
  assert.equal(
    twice.fragments.filter((f) => f.text === 'a paper lantern').length, 1,
    'one fragment landed on the floor twice, doubling its odds',
  )
  assert.equal(twice.floor.size, twice.fragments.length)

  // The identity is `fragmentKey`, which trims and folds case — so a retype that
  // differs only in spacing or case is the same fragment, not a second one.
  const retyped = addFragment(twice, manualFragment('props', '  A Paper Lantern  '))
  assert.equal(retyped, twice, 'a retyped identity was added as a second fragment')

  // A fragment a steer has darkened is still one the floor holds: adding it again
  // does not quietly re-enable it or add a live copy beside the dark one.
  const darkened = setFragmentEnabled(twice, { category: 'props', text: 'a paper lantern' }, false)
  const readded = addFragment(darkened, manualFragment('props', 'a paper lantern'))
  assert.equal(readded, darkened)
  assert.equal(fragmentStateOf(readded, { category: 'props', text: 'a paper lantern' })?.enabled, false)
  assert.equal(readded.fragments.filter((f) => fragmentKey(f) === 'props:a paper lantern').length, 1)
})

// --- The session's own dataset (noema-245) ----------------------------------

test('a session names no dataset of its own until one is minted for it', () => {
  const session = spawnSession('mother-1', motherFragments())
  assert.equal(session.sessionDatasetId, undefined,
    'a session that has never saved must not claim a dataset — nothing has been created for it')

  const named = withSessionDataset(session, 'ds-of-the-session')
  assert.equal(named.sessionDatasetId, 'ds-of-the-session')
  assert.equal(session.sessionDatasetId, undefined, 'the original value was mutated')
  assert.equal(named.motherDatasetId, 'mother-1', 'naming a session dataset does not touch the mother')

  // Fixed once set: a second naming cannot re-point the session and strand the pieces
  // already in the first record.
  const again = withSessionDataset(named, 'ds-somewhere-else')
  assert.equal(again, named)
  assert.equal(again.sessionDatasetId, 'ds-of-the-session')
})

test('a saved piece is flagged in the ledger without disturbing what else it says', () => {
  const fragments = motherFragments()
  const spawned = spawnSession('mother-1', fragments)
  const recorded = recordPiece(spawned, { runId: 'run-1', rollIndex: 0, fragments: [fragments[0]] })
  assert.equal(pieceOf(recorded, 'run-1')?.saved, false, 'a piece is not saved until it is saved')

  const reacted = updatePiece(recorded, 'run-1', { reaction: 'up' })
  const saved = updatePiece(reacted, 'run-1', { saved: true })
  const piece = pieceOf(saved, 'run-1')!
  assert.equal(piece.saved, true)
  assert.equal(piece.reaction, 'up', 'the reaction survived the save')
  assert.equal(piece.dismissed, false)
  assert.deepEqual(piece.fragments, lineageOf(recorded, 'run-1'), 'the lineage is fixed at record time')

  // And a later patch that says nothing about `saved` leaves it as it stands — the flag
  // records that the media landed, so nothing may clear it as a side effect.
  const laterNote = updatePiece(saved, 'run-1', { reaction: 'note' })
  assert.equal(pieceOf(laterNote, 'run-1')?.saved, true)
})

// --- The setup: what the session fires its draw through (noema-287) ----------
//
// The setup is a field of the PURE session value, not of the persistence envelope
// (`src/types/museSession.ts` declares the envelope's four fields fixed), so it is
// mutated the way everything else here is: a function that takes a session and returns
// a new one. These tests gate the two things the shape refuses.

test('a setup cannot carry an infinite-mode acknowledgement, whatever the caller sends', () => {
  // THE MONEY PROOF. An infinite-mode acknowledgement is consent for ONE sitting: it is
  // what stands in for the count that an infinite run does not have. A setup that stored
  // it would hand a reload a session already agreed to an unbounded spend.
  const spawned = spawnSession('mother-1', motherFragments())
  const stored = withSetup(spawned, {
    modusId: 'flow-t2i',
    mode: 'infinite',
    cap: 12,
    acknowledged: true,
    collapsed: { nozzle: 'closed' },
  })

  const setup = stored.setup!
  assert.equal('acknowledged' in setup, false, 'an acknowledgement must not survive into the stored setup')
  assert.equal('collapsed' in setup, false, 'fold state is the screen’s and does not belong on the session')
  assert.deepEqual(Object.keys(setup).sort(), ['cap', 'mode', 'modusId'])
})

test('a stored stack drops what cannot fire and keeps the order of what can', () => {
  const spawned = spawnSession('mother-1', motherFragments())
  const stored = withSetup(spawned, {
    nozzle: [
      { intellaId: 'model-a', nomen: 'Model A', trigger: 'atrig', weight: 0.8 },
      // No trigger word: weights that would be fetched and never applied.
      { intellaId: 'model-b', nomen: 'Model B', trigger: '   ' },
      // The same model twice describes a run that does not exist — the compiler de-dupes.
      { intellaId: 'model-a', nomen: 'Model A again', trigger: 'atrig' },
      { intellaId: 'model-c', nomen: 'Model C', trigger: 'ctrig' },
      // A non-finite weight is no weight at all; the entry still fires, at its own default.
      { intellaId: 'model-d', nomen: 'Model D', trigger: 'dtrig', weight: Number.NaN },
    ],
  })

  const nozzle = stored.setup!.nozzle!
  assert.deepEqual(nozzle.map((e) => e.intellaId), ['model-a', 'model-c', 'model-d'])
  assert.equal(nozzle[0]!.weight, 0.8)
  assert.equal('weight' in nozzle[2]!, false, 'a non-finite weight is stored as no weight')
  assert.equal(nozzle[1]!.nomen, 'Model C', 'the name rides along, so a resume can say which model is gone')
})

test('a setup is replaced wholesale, and one that names nothing clears it', () => {
  const spawned = spawnSession('mother-1', motherFragments())
  const first = withSetup(spawned, {
    modusId: 'flow-t2i',
    mode: 'batched',
    cap: 40,
    nozzle: [{ intellaId: 'model-a', nomen: 'Model A', trigger: 'atrig' }],
    prefix: 'a standing lead',
  })
  assert.equal(first.setup?.cap, 40)

  // Wholesale: the model the user took off is off, rather than merged forward.
  const second = withSetup(first, { modusId: 'flow-t2i', mode: 'batched', cap: 40 })
  assert.equal(second.setup?.nozzle, undefined)
  assert.equal(second.setup?.prefix, undefined)

  // Cleared reads exactly as never set.
  const cleared = withSetup(second, {})
  assert.equal('setup' in cleared, false)
  assert.equal(withSetup(spawned, {}), spawned, 'clearing a setup that was never there changes nothing')

  // The floor and the ledger are untouched by any of it.
  assert.deepEqual(second.fragments, spawned.fragments)
  assert.deepEqual(second.pieces, spawned.pieces)
})

test('a cap is a whole number of pieces, at least one', () => {
  assert.equal(normalizeSetup({ cap: 12.7 }).cap, 12)
  assert.equal(normalizeSetup({ cap: 0 }).cap, 1)
  assert.equal(normalizeSetup({ cap: -5 }).cap, 1)
  assert.equal(normalizeSetup({ cap: '12' }).cap, undefined, 'a cap off the wire is a number or it is nothing')
  assert.equal(normalizeSetup({ mode: 'endless' }).mode, undefined, 'a mode outside the two is no mode')
  assert.deepEqual(normalizeSetup(null), {})
})

// --- Kept rolls: the one durable act of a rolling sitting (noema-329) --------

/** A spawned session with nothing kept — the state every kept-roll test starts from. */
function rollingSession() {
  return spawnSession('mother-dataset', motherFragments())
}

test('keeping a roll appends it, and keeping the same prompt twice keeps it twice', () => {
  const session = rollingSession()
  assert.deepEqual(keptRollsOf(session), [], 'a fresh session has kept nothing')

  const once = keepRoll(session, { prompt: 'a lone figure, still and cold', paid: false })
  assert.deepEqual(keptRollsOf(once), [{ prompt: 'a lone figure, still and cold', paid: false }])
  assert.deepEqual(keptRollsOf(session), [], 'the mutator is pure — the session it was given is untouched')

  const twice = keepRoll(once, { prompt: 'two figures, still and cold', paid: true })
  assert.deepEqual(
    keptRollsOf(twice),
    [
      { prompt: 'a lone figure, still and cold', paid: false },
      { prompt: 'two figures, still and cold', paid: true },
    ],
    'append-only, in the order they were kept',
  )

  // Keeping the same prompt again is the user saying so again, not a mistake to collapse.
  const again = keepRoll(twice, { prompt: 'two figures, still and cold', paid: true })
  assert.equal(keptRollsOf(again).length, 3, 'a duplicate prompt is a third entry, not a no-op')

  // NON-VACUITY: a mutator that dropped the roll and returned the session unchanged
  // fails every assertion above. That is the guard this test exists to be.
  assert.notEqual(once, session, 'a keep returns a new session')
})

test('a kept roll carries a prompt and a verdict and nothing else, whatever the caller sends', () => {
  const session = rollingSession()

  // Non-vacuity: a normalize that spread its input instead of reading the two fields it
  // defines would carry `runId` and `reaction` onto the session, and this would fail.
  const smuggled = keepRoll(session, {
    prompt: 'a lone figure',
    paid: true,
    runId: 'run-1',
    reaction: 'up',
    saved: true,
  })
  assert.deepEqual(keptRollsOf(smuggled), [{ prompt: 'a lone figure', paid: true }])

  // A malformed roll is dropped rather than repaired — a defaulted verdict would label
  // a paid prompt free, and a defaulted prompt would keep a roll nobody kept.
  assert.deepEqual(keptRollsOf(keepRoll(session, { prompt: '   ', paid: false })), [], 'an empty prompt is no prompt')
  assert.deepEqual(keptRollsOf(keepRoll(session, { prompt: 'a lone figure' })), [], 'a missing verdict is no verdict')
  assert.deepEqual(keptRollsOf(keepRoll(session, { prompt: 'a lone figure', paid: 'yes' })), [], 'nor is a string one')
  assert.deepEqual(keptRollsOf(keepRoll(session, { prompt: 42, paid: true })), [], 'a prompt is a string or it is nothing')
  assert.deepEqual(keptRollsOf(keepRoll(session, null)), [], 'and nothing at all keeps nothing')

  // The prompt is stored as it is identified — trimmed, like every other text this
  // module takes off the wire.
  assert.equal(keptRollsOf(keepRoll(session, { prompt: '  spaced  ', paid: false }))[0]?.prompt, 'spaced')

  // The list normalizer's own edges: a non-array input is the empty list, and a
  // malformed entry inside a list is dropped without taking its neighbours with it.
  assert.deepEqual(normalizeKeptRolls(undefined), [])
  assert.deepEqual(normalizeKeptRolls('not a list'), [])
  assert.deepEqual(
    normalizeKeptRolls([{ prompt: 'kept', paid: false }, { prompt: '', paid: true }, { prompt: 'also kept', paid: true }]),
    [{ prompt: 'kept', paid: false }, { prompt: 'also kept', paid: true }],
  )
})

/**
 * The slice of `Collection` `MongoMuseSession` uses, over a Map.
 *
 * Only the four calls the store makes are implemented, and each one keeps the
 * semantics the store depends on: `findOneAndUpdate` matches on the version and
 * returns the document after the write.
 */
function collectionDouble(): Collection {
  const docs = new Map<string, Record<string, unknown>>()
  return {
    async insertOne(doc: Record<string, unknown>) {
      docs.set(String(doc.id), { ...doc })
      return { acknowledged: true }
    },
    async findOne(filter: Record<string, unknown>) {
      return docs.get(String(filter.id)) ?? null
    },
    async findOneAndUpdate(filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) {
      const found = docs.get(String(filter.id))
      if (!found) return null
      const next = { ...found, ...update.$set }
      docs.set(String(filter.id), next)
      return next
    },
    /** The seam a test writes a pre-field document through. */
    _put(doc: Record<string, unknown>) { docs.set(String(doc.id), doc) },
  } as unknown as Collection
}

test('kept rolls survive the store round trip, and a document written without the field reads as empty', async () => {
  const col = collectionDouble()
  const store = new MongoMuseSession(col)

  const kept = keepRoll(rollingSession(), { prompt: 'a lone figure, still and cold', paid: true })
  const created = await store.create({ owner: 'anima-1', session: kept })

  // NON-VACUITY: `keptRolls` missing from either half of the document mapping drops it
  // here with nothing else failing — which is exactly the defect this asserts against.
  const read = await store.find(created.id)
  assert.ok(read)
  assert.deepEqual(
    keptRollsOf(read.session),
    [{ prompt: 'a lone figure, still and cold', paid: true }],
    'what was written comes back',
  )

  // A second keep, through the store's own save, lands beside the first.
  const saved = await store.save(created.id, keepRoll(read.session, { prompt: 'two figures', paid: false }), read.versio ?? 0)
  assert.ok(saved)
  assert.deepEqual(keptRollsOf(saved.session).map((r) => r.prompt), ['a lone figure, still and cold', 'two figures'])

  // A document written before the field existed carries none. It reads as a session
  // that has kept nothing — no backfill, and no distinction between absent and empty.
  ;(col as unknown as { _put(doc: Record<string, unknown>): void })._put({
    id: 'sess-legacy',
    owner: 'anima-1',
    session: {
      motherDatasetId: 'mother-dataset',
      fragments: [],
      floor: [],
      pieces: [],
    },
    natum: new Date(),
    mutatum: new Date(),
  })
  const legacy = await store.find('sess-legacy')
  assert.ok(legacy)
  assert.equal(legacy.session.keptRolls, undefined, 'the field is absent, not an empty array on disk')
  assert.deepEqual(keptRollsOf(legacy.session), [], 'and absent reads as empty')
})
