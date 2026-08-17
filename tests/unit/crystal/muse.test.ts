import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTRIBUTE,
  CATEGORIES,
  EXCLUSIVE,
  TEMPLATE_ORDER,
  isAttribute,
  isCategory,
  isExclusive,
  tierOf,
  type Fragment,
  type Garden,
} from '../../../src/crystal/muse/taxonomy.js'
import { rollFragments } from '../../../src/crystal/muse/sampler.js'
import { composeTemplate, detectConflicts } from '../../../src/crystal/muse/weaver.js'
import {
  buildGarden,
  gardenCounts,
  growGarden,
  type CaptionSource,
  type FragmentExtractor,
} from '../../../src/crystal/muse/garden.js'
import { rollReport } from '../../../src/crystal/muse/roll.js'

// Hermetic: no network, no clock, no filesystem. Pure string logic only.
// Every garden test drives the extraction seam through an INJECTED FAKE — a test
// that reached a provider would be measuring the provider, not this code.

function frag(category: Fragment['category'], text: string, source = 'boardA'): Fragment {
  return { category, text, source, trigger: `${source}-trigger` }
}

/** A garden whose categories each hold `size` distinguishable fragments. */
function gardenOf(categories: Fragment['category'][], size: number): Garden {
  const g: Garden = {}
  for (const cat of categories) {
    g[cat] = Array.from({ length: size }, (_, n) => frag(cat, `${cat}-${n}`))
  }
  return g
}

// --- Taxonomy ----------------------------------------------------------------

test('the two tiers are non-empty, disjoint, and cover every category', () => {
  assert.ok(EXCLUSIVE.length > 0, 'exclusive tier is non-empty')
  assert.ok(ATTRIBUTE.length > 0, 'attribute tier is non-empty')

  const exclusive = new Set<string>(EXCLUSIVE)
  const attribute = new Set<string>(ATTRIBUTE)
  const overlap = [...exclusive].filter((c) => attribute.has(c))
  assert.deepEqual(overlap, [], 'no category may sit in both tiers')

  assert.equal(
    exclusive.size + attribute.size,
    CATEGORIES.length,
    'the tiers partition CATEGORIES with no duplicates',
  )
  assert.deepEqual(
    [...CATEGORIES].sort(),
    [...exclusive, ...attribute].sort(),
    'CATEGORIES is exactly the union of the two tiers',
  )

  // The render order is the same category set, ordered differently on purpose.
  assert.deepEqual(
    [...TEMPLATE_ORDER].sort(),
    [...CATEGORIES].sort(),
    'every category has a slot in the render order and no slot is unknown',
  )
})

test('EXCLUSIVE and ATTRIBUTE share no category', () => {
  const exclusive = new Set<string>(EXCLUSIVE)
  for (const cat of ATTRIBUTE) assert.ok(!exclusive.has(cat), `'${cat}' is in both tiers`)
})

test('CATEGORIES is exactly ATTRIBUTE then EXCLUSIVE, 11 long, no duplicates', () => {
  assert.deepEqual(
    [...CATEGORIES],
    [...ATTRIBUTE, ...EXCLUSIVE],
    'CATEGORIES is the concatenation of ATTRIBUTE followed by EXCLUSIVE, in that order',
  )
  assert.equal(CATEGORIES.length, 11)
  assert.equal(new Set(CATEGORIES).size, CATEGORIES.length, 'no category repeats in CATEGORIES')
})

test('isExclusive/isAttribute/tierOf agree with the tier arrays for every category', () => {
  for (const cat of CATEGORIES) {
    const inExclusive = (EXCLUSIVE as readonly string[]).includes(cat)
    const inAttribute = (ATTRIBUTE as readonly string[]).includes(cat)
    assert.equal(isExclusive(cat), inExclusive, `isExclusive('${cat}')`)
    assert.equal(isAttribute(cat), inAttribute, `isAttribute('${cat}')`)
    assert.equal(tierOf(cat), inExclusive ? 'exclusive' : 'attribute', `tierOf('${cat}')`)
  }

  assert.equal(tierOf('bicycle'), undefined, 'an out-of-taxonomy string has no tier')
  assert.equal(isCategory('bicycle'), false, 'an out-of-taxonomy string is not a category')
})

test('TEMPLATE_ORDER is a permutation of CATEGORIES, not a subset or superset', () => {
  assert.equal(TEMPLATE_ORDER.length, CATEGORIES.length)
  assert.deepEqual(
    [...TEMPLATE_ORDER].sort(),
    [...CATEGORIES].sort(),
    'TEMPLATE_ORDER contains exactly the same categories as CATEGORIES, reordered',
  )
})

test('a category reports which tier it belongs to', () => {
  for (const cat of EXCLUSIVE) assert.equal(tierOf(cat), 'exclusive', cat)
  for (const cat of ATTRIBUTE) assert.equal(tierOf(cat), 'attribute', cat)
  assert.equal(tierOf('bicycle'), undefined, 'an unknown category has no tier')
  assert.equal(isCategory('bicycle'), false)
  assert.equal(isCategory('setting'), true)
})

// --- Sampler -----------------------------------------------------------------

test('the same garden and roll index always yield the same roll', () => {
  const garden = gardenOf([...CATEGORIES], 5)
  for (const i of [0, 1, 7, 42]) {
    const first = rollFragments(garden, i)
    const second = rollFragments(garden, i)
    assert.deepEqual(second, first, `roll ${i} is stable across calls`)
  }
})

test('categories with equal-length names do not draw the same index', () => {
  // `hair`, `pose` and `mood` are all four characters long. An offset keyed on
  // the name length gives all three the same seed, so they advance in lockstep.
  const trio: Fragment['category'][] = ['hair', 'pose', 'mood']
  const garden = gardenOf(trio, 4)

  let sawAllDistinct = false
  for (let i = 0; i < 6; i++) {
    const rolled = rollFragments(garden, i)
    assert.equal(rolled.length, 3, `roll ${i} draws one fragment per category`)

    const indices = trio.map((cat) => {
      const picked = rolled.find((f) => f.category === cat)
      assert.ok(picked, `roll ${i} drew a ${cat} fragment`)
      return Number(picked.text.split('-')[1])
    })

    assert.notEqual(
      new Set(indices).size,
      1,
      `roll ${i} drew index ${indices[0]} for all of ${trio.join(', ')} — the categories are moving in lockstep`,
    )
    if (new Set(indices).size === 3) sawAllDistinct = true
  }
  assert.ok(sawAllDistinct, 'the three categories draw fully independently on at least one roll')
})

test('rolls vary as the roll index advances', () => {
  const garden = gardenOf([...CATEGORIES], 5)
  const rolls = [0, 1, 2, 3].map((i) => composeTemplate(rollFragments(garden, i)))
  assert.ok(new Set(rolls).size > 1, 'successive rolls are not all the same prompt')
})

test('empty and missing categories drop out of a roll without throwing', () => {
  const garden: Garden = {
    subject: [frag('subject', 'a young woman')],
    hair: [], // present but empty
    setting: [frag('setting', 'a sunlit meadow')],
    // every other category is absent entirely
  }
  const rolled = rollFragments(garden, 3)
  assert.deepEqual(
    rolled.map((f) => f.category).sort(),
    ['setting', 'subject'],
    'only non-empty categories contribute',
  )
  assert.ok(
    rolled.every((f) => f !== undefined && typeof f.text === 'string'),
    'no undefined entry reaches the caller',
  )
})

// --- Template composition ----------------------------------------------------

test('a full fragment set composes in slot order with its connectives', () => {
  const fragments = [
    frag('mood', 'serene and dreamlike'),
    frag('subject', 'a young woman'),
    frag('palette', 'cool blues and whites'),
    frag('style', 'digital painting'),
    frag('hair', 'long silver wavy hair'),
    frag('outfit', 'a black frilly dress'),
    frag('pose', 'seated with knees drawn up'),
    frag('expression', 'a distant gaze'),
    frag('props', 'a paper parasol'),
    frag('setting', 'a quiet library'),
    frag('lighting', 'soft dappled light'),
  ]
  assert.equal(
    composeTemplate(fragments),
    'digital painting, a young woman, long silver wavy hair, wearing a black frilly dress, ' +
      'seated with knees drawn up, a distant gaze, holding a paper parasol, set in a quiet library, ' +
      'soft dappled light, cool blues and whites tones, serene and dreamlike',
  )
})

test('a sparse fragment set composes cleanly with no dangling connectives', () => {
  const composed = composeTemplate([
    frag('subject', 'a winged angel'),
    frag('mood', 'eerie'),
  ])
  assert.equal(composed, 'a winged angel, eerie')
  assert.ok(!/wearing|holding|set in|tones/.test(composed), 'no connective survives its missing slot')
  assert.ok(!composed.includes(', ,') && !composed.startsWith(',') && !composed.endsWith(','))
})

test('an empty fragment set composes to an empty prompt', () => {
  assert.equal(composeTemplate([]), '')
})

// --- Conflict detection ------------------------------------------------------

test('a second implied place alongside a setting is reported', () => {
  const reasons = detectConflicts([
    frag('props', 'a cracked stone wall behind her'),
    frag('setting', 'a sunlit meadow'),
  ])
  assert.equal(reasons.length, 1)
  assert.match(reasons[0], /two places/)
  assert.match(reasons[0], /props/)
  assert.match(reasons[0], /sunlit meadow/)
})

test('a place word with NO setting fragment is not a conflict', () => {
  // One implied place is simply the place: there is no second location to
  // reconcile, so this must not buy a paid weave.
  const reasons = detectConflicts([
    frag('props', 'a cracked stone wall behind her'),
    frag('subject', 'a young woman'),
    frag('mood', 'nostalgic'),
  ])
  assert.deepEqual(reasons, [], 'a lone implied place is not a two-places clash')
})

test('a whole-scene brightness clash is reported', () => {
  const reasons = detectConflicts([
    frag('setting', 'a dim abandoned chapel'),
    frag('palette', 'vibrant saturated pinks'),
  ])
  assert.equal(reasons.length, 1)
  assert.match(reasons[0], /brightness clash/)
})

test('a bright lighting fragment in a dim setting is not a clash', () => {
  // Deliberate: a bright light source in a dark scene is chiaroscuro. Only
  // setting and palette describe the whole scene's brightness.
  const reasons = detectConflicts([
    frag('setting', 'a dim abandoned chapel'),
    frag('lighting', 'a single radiant spotlight'),
  ])
  assert.deepEqual(reasons, [], 'lighting is excluded from the brightness check on purpose')
})

test('a coherent fragment set reports no reasons at all', () => {
  const reasons = detectConflicts([
    frag('subject', 'a young woman'),
    frag('setting', 'a sunlit meadow'),
    frag('palette', 'warm golden yellows'),
    frag('mood', 'serene'),
  ])
  assert.deepEqual(reasons, [])
})

// --- Garden: caption -> validated, deduped, attributed fragments -------------

/** An extractor that returns exactly what it was handed, stamped with the source and trigger. */
function fakeExtractor(rows: Array<{ category: string; text: string }>): FragmentExtractor {
  return async (_captions, source, trigger) =>
    rows.map((r) => ({ category: r.category as Fragment['category'], text: r.text, source, trigger }))
}

function source(captions: string[], name = 'boardA', trigger = 'boardA-trigger'): CaptionSource {
  return { name, trigger, captions }
}

test('an unknown category is rejected, not silently kept', async () => {
  // The sampler iterates CATEGORIES, so a pool under an unknown key is a pool
  // nothing ever reads — an invented category must be dropped AND counted, never
  // carried into the garden where it looks like coverage.
  const built = await growGarden(
    [source(['a caption'])],
    fakeExtractor([
      { category: 'subject', text: 'a young woman' },
      { category: 'bicycle', text: 'a rusted touring bike' },
      { category: 'vibe', text: 'crunchy' },
      { category: 'mood', text: 'nostalgic' },
    ]),
  )

  assert.equal(built.kept, 2, 'only the two in-taxonomy fragments are pooled')
  assert.equal(built.drops.unknownCategory, 2, 'both out-of-taxonomy fragments are counted')
  assert.deepEqual(built.drops.unknownCategories, ['bicycle', 'vibe'], 'the caller can report what was dropped')

  const pooled = Object.keys(built.garden)
  assert.deepEqual(pooled.sort(), ['mood', 'subject'], 'no pool exists for a category outside the taxonomy')
  for (const key of pooled) {
    assert.ok(isCategory(key), `'${key}' reached the garden but is not a category`)
  }
})

test('identical text is deduped within a category and kept across categories', () => {
  const built = buildGarden([
    frag('props', 'a paper parasol'),
    frag('props', 'a paper parasol'),   // exact repeat — one caption set says it twice
    frag('props', 'A Paper Parasol'),   // same fragment, different casing
    frag('outfit', 'a paper parasol'),  // same words, different MEANING — kept
    frag('props', 'a small crown'),
  ])

  assert.equal(built.garden.props?.length, 2, 'the repeated props fragment collapses to one')
  assert.deepEqual(
    built.garden.props?.map((f) => f.text),
    ['a paper parasol', 'a small crown'],
    'the first occurrence is the one kept, so pool order stays a function of the input',
  )
  assert.equal(built.garden.outfit?.length, 1, 'the same text under another category is a different fragment')
  assert.equal(built.drops.duplicate, 2, 'both repeats are counted')
})

test('every fragment carries the source it came from', async () => {
  // The source/trigger pair is the model binding. A roll that has lost it cannot
  // be turned back into a LoRA attach, and the loss is invisible in the prompt.
  const built = await growGarden(
    [
      source(['c1'], 'boardA', 'alpha'),
      source(['c2'], 'boardB', 'beta'),
    ],
    async (_captions, name, trigger) => [
      { category: 'subject', text: `${name}-subject`, source: name, trigger },
      { category: 'setting', text: `${name}-setting`, source: name, trigger },
      { category: 'mood', text: `${name}-mood`, source: name, trigger },
    ],
  )

  for (const { category } of gardenCounts(built.garden)) {
    for (const f of built.garden[category] ?? []) {
      assert.ok(f.source, `[${category}] "${f.text}" lost its source`)
      assert.ok(f.trigger, `[${category}] "${f.text}" lost its trigger`)
      assert.equal(f.trigger, f.source === 'boardA' ? 'alpha' : 'beta', 'the trigger stays bound to its own source')
    }
  }

  // …and it survives the roll, which is where it is actually consumed.
  const report = rollReport(built.garden, 4)
  for (const roll of report.rolls) {
    assert.ok(roll.fragments.length > 0, `roll ${roll.index} drew nothing`)
    for (const f of roll.fragments) {
      assert.ok(f.source && f.trigger, `roll ${roll.index} carried a fragment with no attribution`)
    }
    assert.ok(roll.triggers.length > 0, `roll ${roll.index} reports no model binding`)
    assert.deepEqual(
      [...roll.triggers].sort(),
      [...new Set(roll.fragments.map((f) => f.trigger))].sort(),
      'the reported bindings are exactly the distinct triggers of the chosen fragments',
    )
  }
})

test('an empty captions list produces an empty garden and no throw', async () => {
  const reached: string[] = []
  const extractor: FragmentExtractor = async (_c, name) => {
    reached.push(name)
    return [frag('subject', 'a young woman')]
  }

  const built = await growGarden([source([], 'emptyBoard'), source(['   ', ''], 'blankBoard')], extractor)

  assert.deepEqual(reached, [], 'a source with no usable captions never reaches the extractor')
  assert.equal(built.kept, 0)
  assert.deepEqual(built.garden, {}, 'no category pool is created at all')
  assert.deepEqual(gardenCounts(built.garden).filter((c) => c.count > 0), [])

  const report = rollReport(built.garden, 3)
  assert.equal(report.rolls.length, 3, 'rolling an empty garden still reports the rolls asked for')
  assert.deepEqual(report.rolls.map((r) => r.prompt), ['', '', ''])
  assert.equal(report.paid, 0)
})

test('a blank fragment is dropped and counted rather than pooled', () => {
  const built = buildGarden([
    frag('subject', 'a young woman'),
    frag('hair', '   '),
    frag('mood', ''),
  ])
  assert.equal(built.kept, 1)
  assert.equal(built.drops.blank, 2)
  assert.equal(built.garden.hair, undefined, 'no pool is created for a category whose only fragment was blank')
})

// --- Roll report -------------------------------------------------------------

test('the paid/free tally matches the detector', async () => {
  // The tally is the cost shape of the whole front half, so it must be the
  // detector's verdict and nothing else — never a second opinion formed while
  // counting. Rebuild it independently and require exact agreement, roll by roll.
  const built = await growGarden(
    [source(['c1'])],
    fakeExtractor([
      { category: 'setting', text: 'a dim abandoned chapel' },
      { category: 'setting', text: 'a sunlit meadow' },
      { category: 'palette', text: 'vibrant saturated pinks' },
      { category: 'palette', text: 'muted earthy browns' },
      { category: 'props', text: 'a cracked stone wall behind her' },
      { category: 'props', text: 'a paper parasol' },
      { category: 'subject', text: 'a young woman' },
      { category: 'mood', text: 'nostalgic' },
    ]),
  )

  const report = rollReport(built.garden, 24)
  assert.equal(report.rolls.length, 24)

  let expectedPaid = 0
  for (const roll of report.rolls) {
    const reasons = detectConflicts(rollFragments(built.garden, roll.index))
    assert.deepEqual(roll.reasons, reasons, `roll ${roll.index} reports reasons the detector did not give`)
    assert.equal(roll.paid, reasons.length > 0, `roll ${roll.index} is tallied against its own reasons`)
    if (reasons.length > 0) expectedPaid++
  }

  assert.equal(report.paid, expectedPaid, 'the paid count is exactly the rolls the detector flagged')
  assert.equal(report.free, report.rolls.length - expectedPaid, 'free is exactly the remainder')
  assert.equal(report.paidShare, expectedPaid / report.rolls.length)

  // The fixture is built to exercise both verdicts; a tally that can only ever
  // report one of them would pass any arithmetic and measure nothing.
  assert.ok(report.paid > 0, 'the fixture produces at least one conflicted roll')
  assert.ok(report.free > 0, 'the fixture produces at least one clean roll')
})

test('a roll with no reasons is free and a roll with reasons is paid', () => {
  const clean = rollReport({ subject: [frag('subject', 'a young woman')], mood: [frag('mood', 'serene')] }, 1)
  assert.deepEqual(clean.rolls[0].reasons, [])
  assert.equal(clean.rolls[0].paid, false)
  assert.equal(clean.free, 1)
  assert.equal(clean.paid, 0)

  const clashing = rollReport(
    {
      setting: [frag('setting', 'a sunlit meadow')],
      props: [frag('props', 'a cracked stone wall behind her')],
    },
    1,
  )
  assert.ok(clashing.rolls[0].reasons.length > 0)
  assert.equal(clashing.rolls[0].paid, true)
  assert.equal(clashing.paid, 1)
  assert.equal(clashing.free, 0)
  assert.equal(clashing.paidShare, 1)
})

test('zero rolls reports an empty tally rather than dividing by zero', () => {
  const report = rollReport({ subject: [frag('subject', 'a young woman')] }, 0)
  assert.deepEqual(report.rolls, [])
  assert.equal(report.free, 0)
  assert.equal(report.paid, 0)
  assert.equal(report.paidShare, 0)
})

test('determinism survives the garden layer', async () => {
  // The new layer sits between the captions and the sampler; it must not become
  // a source of variation. Same fake extractor, same sources -> same rolls.
  const rows = [
    { category: 'subject', text: 'a young woman' },
    { category: 'hair', text: 'long silver wavy hair' },
    { category: 'setting', text: 'a quiet library' },
    { category: 'setting', text: 'a sunlit meadow' },
    { category: 'mood', text: 'serene and dreamlike' },
    { category: 'style', text: 'digital painting' },
  ]
  const sources = [source(['c1', 'c2'], 'boardA', 'alpha')]

  const first = await growGarden(sources, fakeExtractor(rows))
  const second = await growGarden(sources, fakeExtractor(rows))
  assert.deepEqual(second.garden, first.garden, 'the garden itself is a function of its inputs')

  for (const i of [0, 1, 7, 42]) {
    const a = rollReport(first.garden, i + 1).rolls[i]
    const b = rollReport(second.garden, i + 1).rolls[i]
    assert.deepEqual(b, a, `roll ${i} is stable across independently built gardens`)
  }
})
