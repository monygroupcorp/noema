import { test } from 'node:test'
import assert from 'node:assert/strict'
import { selectForPiece, nftName } from '../../../src/crystal/TraitMixer.js'
import type { Tractus, TraitValor } from '../../../src/types/collectio.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTractus(porta: string, valores: TraitValor[], label?: string): Tractus {
  return { porta, valores, ...(label !== undefined ? { label } : {}) }
}

// ── Test 1: Determinism ───────────────────────────────────────────────────────

test('same tractus + same pieceIndex produces identical TraitSelection', () => {
  const tractus: Tractus[] = [
    makeTractus('background', [
      { value: 'desert', label: 'Desert', rarity: 0.3 },
      { value: 'forest', label: 'Forest', rarity: 0.5 },
      { value: 'city', label: 'City', rarity: 0.2 },
    ], 'Background'),
    makeTractus('outfit', [
      { value: 'knight', label: 'Knight', rarity: 0.6 },
      { value: 'wizard', label: 'Wizard', rarity: 0.4 },
    ], 'Outfit'),
  ]

  const a = selectForPiece({ tractus, pieceIndex: 7 })
  const b = selectForPiece({ tractus, pieceIndex: 7 })

  assert.deepEqual(a.aditus, b.aditus)
  assert.equal(a.prompt, b.prompt)
  assert.deepEqual(a.attributes, b.attributes)
})

// ── Test 2: Variation ─────────────────────────────────────────────────────────

test('different pieceIndex values produce different aditus with non-trivial rarity', () => {
  const tractus: Tractus[] = [
    makeTractus('background', [
      { value: 'a', rarity: 0.5 },
      { value: 'b', rarity: 0.5 },
      { value: 'c', rarity: 0.5 },
      { value: 'd', rarity: 0.5 },
      { value: 'e', rarity: 0.5 },
    ]),
  ]

  // Collect backgrounds across 50 pieceIndex values
  const results = Array.from({ length: 50 }, (_, i) =>
    selectForPiece({ tractus, pieceIndex: i }).aditus['background']
  )

  const unique = new Set(results)
  // With 5 options and 50 pieces, at least 2 distinct values should appear
  assert.ok(unique.size >= 2, `Expected multiple distinct values but got: ${[...unique].join(', ')}`)
})

// ── Test 3: Prompt assembly with tokens ──────────────────────────────────────

test('basePrompt with {{porta}} token is replaced with winner promptFragment ?? label ?? value', () => {
  const tractus: Tractus[] = [
    makeTractus('background', [
      { value: 'desert.png', label: 'Desert', promptFragment: 'a vast desert landscape', rarity: 1 },
    ], 'Background'),
  ]

  const result = selectForPiece({
    tractus,
    pieceIndex: 0,
    basePrompt: 'Generate {{background}} scene',
  })

  assert.equal(result.prompt, 'Generate a vast desert landscape scene')
})

test('{{porta}} token falls back to label when no promptFragment', () => {
  const tractus: Tractus[] = [
    makeTractus('background', [
      { value: 'desert.png', label: 'Desert', rarity: 1 },
    ]),
  ]

  const result = selectForPiece({
    tractus,
    pieceIndex: 0,
    basePrompt: '{{background}} environment',
  })

  assert.equal(result.prompt, 'Desert environment')
})

test('{{porta}} token falls back to String(value) when no label or promptFragment', () => {
  const tractus: Tractus[] = [
    makeTractus('seed', [{ value: 42, rarity: 1 }]),
  ]

  const result = selectForPiece({
    tractus,
    pieceIndex: 0,
    basePrompt: 'seed={{seed}}',
  })

  assert.equal(result.prompt, 'seed=42')
})

// ── Test 4: Prompt assembly without tokens ────────────────────────────────────

test('basePrompt without tokens is joined with promptFragments from tractus', () => {
  const tractus: Tractus[] = [
    makeTractus('background', [
      { value: 'desert', promptFragment: 'vast desert', rarity: 1 },
    ]),
    makeTractus('outfit', [
      { value: 'knight', promptFragment: 'wearing knight armor', rarity: 1 },
    ]),
  ]

  const result = selectForPiece({
    tractus,
    pieceIndex: 0,
    basePrompt: 'dark fantasy',
  })

  assert.equal(result.prompt, 'dark fantasy, vast desert, wearing knight armor')
})

// ── Test 5: Prompt assembly with no basePrompt ────────────────────────────────

test('no basePrompt: promptFragments from tractus are joined with comma', () => {
  const tractus: Tractus[] = [
    makeTractus('background', [
      { value: 'desert', promptFragment: 'vast desert', rarity: 1 },
    ]),
    makeTractus('outfit', [
      { value: 'knight', promptFragment: 'wearing knight armor', rarity: 1 },
    ]),
  ]

  const result = selectForPiece({ tractus, pieceIndex: 0 })

  assert.equal(result.prompt, 'vast desert, wearing knight armor')
})

test('no basePrompt and no promptFragments: prompt is empty string', () => {
  const tractus: Tractus[] = [
    makeTractus('seed', [{ value: 42, rarity: 1 }]),
  ]

  const result = selectForPiece({ tractus, pieceIndex: 0 })

  assert.equal(result.prompt, '')
})

// ── Test 6: NFT attributes shape ──────────────────────────────────────────────

test('attributes use tractus.label as trait_type, falling back to porta', () => {
  const tractus: Tractus[] = [
    makeTractus('background', [{ value: 'desert', label: 'Desert', rarity: 1 }], 'Background Type'),
    makeTractus('seed', [{ value: 42, rarity: 1 }]),
  ]

  const result = selectForPiece({ tractus, pieceIndex: 0 })

  assert.equal(result.attributes[0].trait_type, 'Background Type')
  assert.equal(result.attributes[1].trait_type, 'seed')
})

test('attributes use winner.label as value, falling back to String(winner.value)', () => {
  const tractus: Tractus[] = [
    makeTractus('bg', [{ value: 'desert.png', label: 'Desert', rarity: 1 }]),
    makeTractus('num', [{ value: 7, rarity: 1 }]),
  ]

  const result = selectForPiece({ tractus, pieceIndex: 0 })

  assert.equal(result.attributes[0].value, 'Desert')
  assert.equal(result.attributes[1].value, '7')
})

test('attributes array length equals tractus length', () => {
  const tractus: Tractus[] = [
    makeTractus('a', [{ value: 1, rarity: 1 }]),
    makeTractus('b', [{ value: 2, rarity: 1 }]),
    makeTractus('c', [{ value: 3, rarity: 1 }]),
  ]

  const result = selectForPiece({ tractus, pieceIndex: 0 })
  assert.equal(result.attributes.length, 3)
})

// ── Test 7: Exclusion rules ────────────────────────────────────────────────────

test('option with excludes=[Desert] is never selected when tractus A selected Desert', () => {
  // tractus A: background — always selects Desert (rarity=1, only option)
  // tractus B: outfit — has Knight (excludes Desert) and Wizard
  const tractus: Tractus[] = [
    makeTractus('background', [
      { value: 'desert', label: 'Desert', rarity: 1 },
    ], 'Background'),
    makeTractus('outfit', [
      { value: 'knight', label: 'Knight', rarity: 0.9, excludes: ['Desert'] },
      { value: 'wizard', label: 'Wizard', rarity: 0.1 },
    ], 'Outfit'),
  ]

  // Over 100 different pieceIndex values, Knight should never be selected
  for (let i = 0; i < 100; i++) {
    const result = selectForPiece({ tractus, pieceIndex: i })
    assert.equal(
      result.aditus['outfit'],
      'wizard',
      `Expected wizard at piece ${i} but got ${result.aditus['outfit']}`
    )
  }
})

test('exclusion only blocks the specific label match', () => {
  // When background is Forest (not Desert), Knight should be selectable
  const tractus: Tractus[] = [
    makeTractus('background', [
      { value: 'forest', label: 'Forest', rarity: 1 },
    ], 'Background'),
    makeTractus('outfit', [
      { value: 'knight', label: 'Knight', rarity: 1, excludes: ['Desert'] },
      { value: 'wizard', label: 'Wizard', rarity: 0 },
    ], 'Outfit'),
  ]

  // Knight is the only option with non-zero rarity; wizard has rarity 0
  // So Knight must be chosen when Forest is selected (exclusion doesn't apply)
  const result = selectForPiece({ tractus, pieceIndex: 0 })
  assert.equal(result.aditus['outfit'], 'knight')
})

// ── Test 8: Empty tractus array ───────────────────────────────────────────────

test('empty tractus array returns aditus={}, prompt=basePrompt, attributes=[]', () => {
  const result = selectForPiece({ tractus: [], pieceIndex: 0, basePrompt: 'hello world' })

  assert.deepEqual(result.aditus, {})
  assert.equal(result.prompt, 'hello world')
  assert.deepEqual(result.attributes, [])
})

test('empty tractus with no basePrompt returns prompt=""', () => {
  const result = selectForPiece({ tractus: [], pieceIndex: 5 })
  assert.equal(result.prompt, '')
})

// ── Test 9: Single option per tractus ────────────────────────────────────────

test('single option per tractus is always selected regardless of rarity', () => {
  const tractus: Tractus[] = [
    makeTractus('bg', [{ value: 'only-option', label: 'Only' }]),
  ]

  for (let i = 0; i < 10; i++) {
    const result = selectForPiece({ tractus, pieceIndex: i })
    assert.equal(result.aditus['bg'], 'only-option')
  }
})

test('single option with rarity=0 is still selected (only candidate)', () => {
  const tractus: Tractus[] = [
    makeTractus('bg', [{ value: 'zero-rarity', rarity: 0 }]),
  ]

  const result = selectForPiece({ tractus, pieceIndex: 0 })
  assert.equal(result.aditus['bg'], 'zero-rarity')
})

// ── Test 10: nftName ──────────────────────────────────────────────────────────

test('nftName with collectionName returns "CollectionName #N"', () => {
  assert.equal(nftName({ collectionName: 'MyPFP', pieceIndex: 0 }), 'MyPFP #1')
  assert.equal(nftName({ collectionName: 'MyPFP', pieceIndex: 9 }), 'MyPFP #10')
  assert.equal(nftName({ collectionName: 'Cool Cats', pieceIndex: 99 }), 'Cool Cats #100')
})

test('nftName without collectionName returns "Piece #N"', () => {
  assert.equal(nftName({ pieceIndex: 0 }), 'Piece #1')
  assert.equal(nftName({ pieceIndex: 4 }), 'Piece #5')
})

// ── aditus record ─────────────────────────────────────────────────────────────

test('aditus record maps porta to selected valor.value', () => {
  const tractus: Tractus[] = [
    makeTractus('background', [{ value: 'desert_url', rarity: 1 }]),
    makeTractus('style', [{ value: 'oil_painting', rarity: 1 }]),
  ]

  const result = selectForPiece({ tractus, pieceIndex: 0 })
  assert.equal(result.aditus['background'], 'desert_url')
  assert.equal(result.aditus['style'], 'oil_painting')
})

// ── Tag-group exclusion (tagRules) ────────────────────────────────────────────

test('tagRules: selecting a fantasy valor blocks all sci-fi valors in later tractus', () => {
  const tractus: Tractus[] = [
    makeTractus('background', [
      { value: 'enchanted_forest', label: 'Enchanted Forest', tags: ['fantasy'], rarity: 1 },
    ]),
    makeTractus('outfit', [
      { value: 'spacesuit', label: 'Spacesuit', tags: ['sci-fi'], rarity: 0.9 },
      { value: 'robe', label: 'Robe', tags: ['fantasy'], rarity: 0.1 },
    ]),
  ]

  for (let i = 0; i < 50; i++) {
    const result = selectForPiece({
      tractus,
      pieceIndex: i,
      tagRules: [['fantasy', 'sci-fi']],
    })
    assert.notEqual(result.aditus['outfit'], 'spacesuit',
      `Piece ${i}: sci-fi outfit should be blocked when fantasy background selected`)
  }
})

test('tagRules: selecting a sci-fi valor blocks all fantasy valors in later tractus', () => {
  const tractus: Tractus[] = [
    makeTractus('background', [
      { value: 'space_station', label: 'Space Station', tags: ['sci-fi'], rarity: 1 },
    ]),
    makeTractus('weapon', [
      { value: 'sword', label: 'Sword', tags: ['fantasy'], rarity: 0.9 },
      { value: 'laser', label: 'Laser', tags: ['sci-fi'], rarity: 0.1 },
    ]),
  ]

  for (let i = 0; i < 50; i++) {
    const result = selectForPiece({
      tractus,
      pieceIndex: i,
      tagRules: [['fantasy', 'sci-fi']],
    })
    assert.notEqual(result.aditus['weapon'], 'sword',
      `Piece ${i}: fantasy weapon should be blocked when sci-fi background selected`)
  }
})

test('tagRules: multiple independent rules enforced simultaneously', () => {
  const tractus: Tractus[] = [
    makeTractus('season', [
      { value: 'snow', label: 'Snow', tags: ['winter'], rarity: 1 },
    ]),
    makeTractus('theme', [
      { value: 'spaceship', label: 'Spaceship', tags: ['sci-fi'], rarity: 1 },
    ]),
    makeTractus('outfit', [
      { value: 'swimsuit', label: 'Swimsuit', tags: ['summer'], rarity: 0.5 },
      { value: 'spacesuit', label: 'Spacesuit', tags: ['sci-fi'], rarity: 0.5 },
      { value: 'coat', label: 'Coat', tags: ['winter'], rarity: 0.5 },
    ]),
  ]

  // Rules: winter/summer mutually exclusive, fantasy/sci-fi mutually exclusive
  // season=winter blocks summer outfits; theme=sci-fi blocks sci-fi outfits (same tag = not blocked)
  // Wait — sci-fi theme selects sci-fi, which blocks sci-fi in outfit? No — same tag isn't blocked.
  // Only OTHER tags in the group are blocked. So sci-fi selected → nothing blocked within sci-fi group
  // (sci-fi is the only tag in that group here, so nothing is blocked).
  // winter selected → summer blocked in outfit.
  // So outfit candidates = [coat (winter), spacesuit (sci-fi)] — swimsuit (summer) is blocked.
  for (let i = 0; i < 50; i++) {
    const result = selectForPiece({
      tractus,
      pieceIndex: i,
      tagRules: [['winter', 'summer'], ['fantasy', 'sci-fi']],
    })
    assert.notEqual(result.aditus['outfit'], 'swimsuit',
      `Piece ${i}: summer outfit should be blocked when winter season selected`)
  }
})

test('tagRules: untagged valors are never blocked by tag rules', () => {
  const tractus: Tractus[] = [
    makeTractus('background', [
      { value: 'forest', label: 'Forest', tags: ['fantasy'], rarity: 1 },
    ]),
    makeTractus('accessory', [
      { value: 'glasses', label: 'Glasses', rarity: 1 },  // no tags — never blocked
    ]),
  ]

  for (let i = 0; i < 10; i++) {
    const result = selectForPiece({
      tractus,
      pieceIndex: i,
      tagRules: [['fantasy', 'sci-fi']],
    })
    assert.equal(result.aditus['accessory'], 'glasses',
      `Piece ${i}: untagged accessory should never be blocked`)
  }
})

test('tagRules absent: tags on valors have no effect', () => {
  const tractus: Tractus[] = [
    makeTractus('background', [
      { value: 'forest', label: 'Forest', tags: ['fantasy'], rarity: 1 },
    ]),
    makeTractus('outfit', [
      { value: 'spacesuit', label: 'Spacesuit', tags: ['sci-fi'], rarity: 1 },
    ]),
  ]

  // No tagRules — tags are ignored, spacesuit must be selected (only option)
  const result = selectForPiece({ tractus, pieceIndex: 0 })
  assert.equal(result.aditus['outfit'], 'spacesuit')
})

// ── DNA uniqueness (opt-in dedup) ──────────────────────────────────────────────

test('selection carries a canonical DNA over non-bypassed axes', () => {
  const tractus: Tractus[] = [
    makeTractus('color', [{ value: 'red', label: 'Red', rarity: 1 }]),
    makeTractus('shape', [{ value: 'square', label: 'Square', rarity: 1 }]),
  ]
  const r = selectForPiece({ tractus, pieceIndex: 0 })
  assert.equal(r.dna, 'color=Red|shape=Square')
})

test('bypassDNA axes are excluded from the DNA key', () => {
  const tractus: Tractus[] = [
    makeTractus('color', [{ value: 'red', label: 'Red', rarity: 1 }]),
    { ...makeTractus('background', [{ value: 'sky', label: 'Sky', rarity: 1 }]), bypassDNA: true },
  ]
  const r = selectForPiece({ tractus, pieceIndex: 0 })
  assert.equal(r.dna, 'color=Red', 'background is bypassed → not in DNA')
})

test('usedDna ledger forces a reroll to a unique combination', () => {
  // Two axes, 2×2 = 4 possible combos — plenty of room to find a unique one.
  const tractus: Tractus[] = [
    makeTractus('color', [
      { value: 'red', label: 'Red', rarity: 1 },
      { value: 'blue', label: 'Blue', rarity: 1 },
    ]),
    makeTractus('shape', [
      { value: 'square', label: 'Square', rarity: 1 },
      { value: 'circle', label: 'Circle', rarity: 1 },
    ]),
  ]
  const usedDna = new Set<string>()
  const seen = new Set<string>()
  for (let i = 0; i < 4; i++) {
    const r = selectForPiece({ tractus, pieceIndex: i, usedDna })
    assert.ok(!seen.has(r.dna), `piece ${i} DNA ${r.dna} must be unique`)
    seen.add(r.dna)
    usedDna.add(r.dna)
  }
  assert.equal(seen.size, 4, 'all four unique combinations produced')
})

test('without a usedDna ledger, duplicates are allowed (variation-test behaviour)', () => {
  const tractus: Tractus[] = [
    makeTractus('color', [
      { value: 'red', label: 'Red', rarity: 1 },
      { value: 'blue', label: 'Blue', rarity: 1 },
    ]),
  ]
  // Same pieceIndex → identical selection whether or not dedup is involved.
  const a = selectForPiece({ tractus, pieceIndex: 5 })
  const b = selectForPiece({ tractus, pieceIndex: 5 })
  assert.equal(a.dna, b.dna)
})
