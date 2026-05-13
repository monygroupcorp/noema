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
