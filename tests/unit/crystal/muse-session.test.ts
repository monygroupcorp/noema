import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fragmentKey, type Fragment } from '../../../src/crystal/muse/taxonomy.js'
import { rollFragments } from '../../../src/crystal/muse/sampler.js'
import { buildGarden } from '../../../src/crystal/muse/garden.js'
import {
  DEFAULT_FRAGMENT_STATE,
  UnknownFragmentError,
  enabledFragments,
  fragmentStateOf,
  holdsFragment,
  lineageOf,
  rebuildFragments,
  recordPiece,
  setFragmentEnabled,
  setFragmentWeight,
  spawnSession,
} from '../../../src/crystal/muse/session.js'

// Hermetic: pure domain only. No I/O, no clock, no randomness — a session is a
// value, every operation returns a new one, and nothing here touches a store.

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
