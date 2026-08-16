import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ATTRIBUTE,
  CATEGORIES,
  EXCLUSIVE,
  TEMPLATE_ORDER,
  isCategory,
  tierOf,
  type Fragment,
  type Garden,
} from '../../../src/crystal/muse/taxonomy.js'
import { rollFragments } from '../../../src/crystal/muse/sampler.js'
import { composeTemplate, detectConflicts } from '../../../src/crystal/muse/weaver.js'

// Hermetic: no network, no clock, no filesystem. Pure string logic only.

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
