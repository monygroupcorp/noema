import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_VARIANCE_THRESHOLDS,
  combinationKey,
  readVariance,
} from '../../../src/crystal/muse/variance.js'
import { CATEGORIES, type Fragment, type Garden } from '../../../src/crystal/muse/taxonomy.js'

// Hermetic and pure: no network, no clock, no filesystem, no model. The readout
// is counted from state already in hand, which is the property that lets it fire
// on every piece for nothing — see the first test, which is what holds it there.

function frag(
  category: Fragment['category'],
  text: string,
  opts: { disabled?: boolean; source?: string } = {},
): Fragment {
  return {
    category,
    text,
    source: opts.source ?? 'boardA',
    trigger: 'triggerA',
    ...(opts.disabled ? { disabled: true } : {}),
  }
}

/** A garden holding `n` fragments in each of the named categories. */
function floorOf(spec: Partial<Record<Fragment['category'], number>>): Garden {
  const garden: Garden = {}
  for (const [category, n] of Object.entries(spec)) {
    garden[category as Fragment['category']] = Array.from({ length: n as number }, (_, i) =>
      frag(category as Fragment['category'], `${category}-${i}`),
    )
  }
  return garden
}

/** Turn off all but the first `keep` fragments of every category. */
function disableAllBut(garden: Garden, keep: number): Garden {
  const out: Garden = {}
  for (const category of CATEGORIES) {
    const pool = garden[category]
    if (!pool) continue
    out[category] = pool.map((f, i) => (i < keep ? f : { ...f, disabled: true }))
  }
  return out
}

/** One roll: the first fragment of each named category, as the sampler would hand it over. */
function roll(garden: Garden, indexPerCategory: Partial<Record<Fragment['category'], number>>): Fragment[] {
  const out: Fragment[] = []
  for (const category of CATEGORIES) {
    const i = indexPerCategory[category]
    if (i === undefined) continue
    const pick = garden[category]?.[i]
    if (pick) out.push(pick)
  }
  return out
}

// ── NON-VACUITY 1 ─────────────────────────────────────────────────────────────
// V4 ruled the measure COMBINATORIC, and that ruling is the whole economics of
// the readout: it costs nothing, so it can fire on every piece. Reverting it —
// giving the readout a model call, an injected fetch, or an API key — fails
// here, because a call makes the function async and a fetch trips the stub.

test('the readout is computed without any injected fetch or key', () => {
  const globals = globalThis as { fetch?: unknown }
  const realFetch = globals.fetch
  let fetches = 0
  globals.fetch = (...args: unknown[]) => {
    fetches++
    throw new Error(`variance reached the network: ${String(args[0])}`)
  }

  try {
    const garden = floorOf({ subject: 4, hair: 3, setting: 2 })
    const readout = readVariance(garden, [roll(garden, { subject: 0, hair: 0, setting: 0 })])

    // Synchronous by construction: a model call could not be awaited from here.
    assert.equal(readVariance.constructor.name, 'Function')
    assert.equal(typeof (readout as { then?: unknown }).then, 'undefined')
    assert.equal(typeof readout.liveCombinations, 'number')

    // Nothing reached the network, and no key was consulted: the reading is the
    // same with every provider credential stripped from the environment.
    assert.equal(fetches, 0)
    const keys = Object.keys(process.env).filter((k) => /API|KEY|TOKEN/i.test(k))
    const saved = keys.map((k) => [k, process.env[k]] as const)
    for (const k of keys) delete process.env[k]
    try {
      assert.deepEqual(
        readVariance(garden, [roll(garden, { subject: 0, hair: 0, setting: 0 })]),
        readout,
      )
    } finally {
      for (const [k, v] of saved) if (v !== undefined) process.env[k] = v
    }
  } finally {
    if (realFetch === undefined) delete globals.fetch
    else globals.fetch = realFetch
  }
})

// ── NON-VACUITY 2 ─────────────────────────────────────────────────────────────
// Disable is not delete (the fragments stay on the floor), so the count that
// matters is the LIVE one. Counting disabled fragments as live collapses the
// live width onto the starting width, headroom becomes 1, and this fails.

test('a floor whose fragments are mostly disabled reports narrow', () => {
  const wide = floorOf({ subject: 6, hair: 6, outfit: 6, setting: 6, style: 6 })
  const cut = disableAllBut(wide, 1)

  // No rolls at all, so `exhausted` cannot fire and only the width is under test.
  const readout = readVariance(cut, [])

  assert.equal(readout.narrowed, true)
  assert.deepEqual(readout.reasons, ['aimed'])
  assert.equal(readout.liveCombinations, 1)
  assert.equal(readout.startCombinations, 6 ** 5)
  assert.ok(readout.headroom < DEFAULT_VARIANCE_THRESHOLDS.headroom)
  assert.equal(readout.liveFragments, 5)
  assert.equal(readout.startFragments, 30)

  // The same floor read with nothing turned off says nothing.
  assert.equal(readVariance(wide, []).narrowed, false)
})

// ── NON-VACUITY 3 ─────────────────────────────────────────────────────────────
// Combinatorial headroom alone is not the signal the user feels. A floor with
// room left can still hand back the same picture; repetition in the recent-roll
// window is what catches it. Ignore the window and this fails.

test('a floor with room left but repeating rolls reports narrow', () => {
  const garden = floorOf({ subject: 8, hair: 8, outfit: 8, setting: 8 })
  const same = roll(garden, { subject: 0, hair: 0, outfit: 0, setting: 0 })
  const other = roll(garden, { subject: 1, hair: 1, outfit: 1, setting: 1 })
  const rolls = [same, same, same, same, same, other]

  const readout = readVariance(garden, rolls)

  // Nothing is disabled: the floor is at full width and has plenty left.
  assert.equal(readout.headroom, 1)
  assert.equal(readout.liveCombinations, 8 ** 4)
  assert.equal(readout.narrowed, true)
  assert.deepEqual(readout.reasons, ['exhausted'])
  assert.equal(readout.rollsConsidered, 6)
  assert.equal(readout.distinctCombinations, 2)
  assert.ok(readout.repetition >= DEFAULT_VARIANCE_THRESHOLDS.repetition)

  // Six distinct rolls off the same floor say nothing.
  const varied = [0, 1, 2, 3, 4, 5].map((i) =>
    roll(garden, { subject: i, hair: i, outfit: i, setting: i }),
  )
  assert.equal(readVariance(garden, varied).narrowed, false)
})

// ── NON-VACUITY 4 ─────────────────────────────────────────────────────────────
// The sparse-floor guard. A real decompose produces thin categories as a matter
// of course, so the readout measures CHANGE against the session's own starting
// width. Revert that to an absolute width threshold and a first-roll user is
// greeted by an alarm — this fails, because this floor is thin and untouched.

test('a floor that was always thin does not report as newly narrowed', () => {
  const thin = floorOf({ subject: 3, lighting: 2, props: 3 })
  const rolls = [0, 1, 2].map((i) => roll(thin, { subject: i, lighting: i % 2, props: i }))

  const readout = readVariance(thin, rolls)

  assert.equal(readout.narrowed, false)
  assert.deepEqual(readout.reasons, [])
  // Absolutely narrow — 18 combinations — and yet no change has happened.
  assert.equal(readout.liveCombinations, 18)
  assert.equal(readout.startCombinations, 18)
  assert.equal(readout.headroom, 1)

  // The same thin floor DOES speak the moment a steer cuts into it.
  const cut = disableAllBut(thin, 1)
  assert.deepEqual(readVariance(cut, []).reasons, ['aimed'])
})

// ── The two situations are distinguishable ────────────────────────────────────

test('narrowing reports which of the two situations it is, and reports both when both hold', () => {
  const wide = floorOf({ subject: 6, hair: 6, outfit: 6, setting: 6, style: 6 })
  const cut = disableAllBut(wide, 1)
  const only = roll(cut, { subject: 0, hair: 0, outfit: 0, setting: 0, style: 0 })

  const both = readVariance(cut, Array.from({ length: 8 }, () => only))
  assert.deepEqual(both.reasons, ['aimed', 'exhausted'])
  assert.equal(both.narrowed, true)
})

test('a short window of repeats is not yet a reading', () => {
  const garden = floorOf({ subject: 8, hair: 8 })
  const same = roll(garden, { subject: 0, hair: 0 })

  // Below `minRolls` the sample cannot tell a repeating floor from an unlucky pair.
  const short = readVariance(garden, [same, same, same])
  assert.equal(short.narrowed, false)
  assert.equal(short.rollsConsidered, 3)
  assert.equal(short.repetition, 1 - 1 / 3)

  const long = readVariance(garden, Array.from({ length: 6 }, () => same))
  assert.deepEqual(long.reasons, ['exhausted'])
})

test('repetition looks only at the most recent window', () => {
  const garden = floorOf({ subject: 30, hair: 30 })
  const same = roll(garden, { subject: 0, hair: 0 })
  const older = Array.from({ length: 8 }, () => same)
  const newer = Array.from({ length: 12 }, (_, i) => roll(garden, { subject: i + 1, hair: i + 1 }))

  const readout = readVariance(garden, [...older, ...newer], { window: 12 })

  assert.equal(readout.rollsConsidered, 12)
  assert.equal(readout.distinctCombinations, 12)
  assert.equal(readout.repetition, 0)
  assert.equal(readout.narrowed, false)
})

// ── Baseline ──────────────────────────────────────────────────────────────────

test('an explicit session-start snapshot overrides the floor-derived baseline', () => {
  const started = floorOf({ subject: 8, hair: 8 })
  // The session added fragments as well as cutting them, so the floor no longer
  // carries its own starting width and the snapshot is what the caller passes.
  const now: Garden = {
    subject: [...(started.subject ?? []), frag('subject', 'added-by-hand')].map((f, i) =>
      i > 0 && i < 8 ? { ...f, disabled: true } : f,
    ),
    hair: started.hair,
  }

  const derived = readVariance(now, [])
  const explicit = readVariance(now, [], { sessionStart: started })

  assert.equal(explicit.startCombinations, 64)
  assert.equal(derived.startCombinations, 72)
  assert.equal(explicit.liveCombinations, 2 * 8)
  assert.ok(explicit.headroom > derived.headroom)
})

// ── Shape, determinism and edges ──────────────────────────────────────────────

test('the readout is deterministic and reports every category width', () => {
  const garden = floorOf({ subject: 4, hair: 2 })
  const a = readVariance(garden, [])
  const b = readVariance(garden, [])

  assert.deepEqual(a, b)
  assert.equal(a.widths.length, CATEGORIES.length)
  assert.deepEqual(
    a.widths.filter((w) => w.start > 0).map((w) => `${w.category}:${w.live}/${w.start}`),
    ['subject:4/4', 'hair:2/2'],
  )
})

test('an empty floor produces no combinations and no reading', () => {
  const readout = readVariance({}, [])

  assert.equal(readout.liveCombinations, 0)
  assert.equal(readout.startCombinations, 0)
  assert.equal(readout.headroom, 1)
  assert.equal(readout.narrowed, false)
  assert.equal(readout.rollsConsidered, 0)
  assert.equal(readout.repetition, 0)
})

test('a floor cut to nothing live reports zero headroom', () => {
  const garden = disableAllBut(floorOf({ subject: 4, hair: 4 }), 0)
  const readout = readVariance(garden, [])

  assert.equal(readout.liveCombinations, 0)
  assert.equal(readout.headroom, 0)
  assert.deepEqual(readout.reasons, ['aimed'])
})

test('empty categories drop out of the count rather than zeroing it', () => {
  const garden: Garden = { ...floorOf({ subject: 3, hair: 2 }), props: [] }
  assert.equal(readVariance(garden, []).liveCombinations, 6)
})

test('combination keys are order-independent and category-qualified', () => {
  const a = frag('subject', 'a young woman')
  const b = frag('hair', 'long silver hair')

  assert.equal(combinationKey([a, b]), combinationKey([b, a]))
  assert.notEqual(combinationKey([a]), combinationKey([b]))
  // The same phrase under two categories is two different fragments.
  assert.notEqual(
    combinationKey([frag('mood', 'muted')]),
    combinationKey([frag('palette', 'muted')]),
  )
  // Whitespace and case are normalized, so a re-tagged duplicate does not read as new.
  assert.equal(combinationKey([frag('mood', ' Muted ')]), combinationKey([frag('mood', 'muted')]))
})

test('thresholds are callable parameters, not baked-in constants', () => {
  const garden = disableAllBut(floorOf({ subject: 4, hair: 4 }), 2)

  // headroom is 4/16 = 0.25 — at the default, so it reads; tighten it and it does not.
  assert.deepEqual(readVariance(garden, []).reasons, ['aimed'])
  assert.deepEqual(readVariance(garden, [], { headroom: 0.1 }).reasons, [])
})
