import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rarityReport } from '../../../src/crystal/rarityReport.js'
import type { Tractus } from '../../../src/types/collectio.js'

const tractus: Tractus[] = [
  {
    porta: 'color',
    label: 'Color',
    valores: [
      { value: 'red', label: 'Red', rarity: 0.9 },
      { value: 'blue', label: 'Blue', rarity: 0.1 },
    ],
  },
]

test('targetRarity is the weight normalised within its axis', () => {
  const report = rarityReport({ tractus, pieces: [] })
  const axis = report.axes[0]
  assert.equal(axis.trait_type, 'Color')
  const red = axis.valores.find((v) => v.value === 'Red')!
  const blue = axis.valores.find((v) => v.value === 'Blue')!
  assert.ok(Math.abs(red.targetRarity - 0.9) < 1e-9)
  assert.ok(Math.abs(blue.targetRarity - 0.1) < 1e-9)
})

test('realized counts + shares come from the stamped attributes', () => {
  const pieces = [
    [{ trait_type: 'Color', value: 'Red' }],
    [{ trait_type: 'Color', value: 'Red' }],
    [{ trait_type: 'Color', value: 'Red' }],
    [{ trait_type: 'Color', value: 'Blue' }],
  ]
  const report = rarityReport({ tractus, pieces })
  assert.equal(report.totalPieces, 4)
  const red = report.axes[0].valores.find((v) => v.value === 'Red')!
  const blue = report.axes[0].valores.find((v) => v.value === 'Blue')!
  assert.equal(red.realizedCount, 3)
  assert.equal(red.realizedRarity, 0.75)
  assert.equal(blue.realizedCount, 1)
  assert.equal(blue.realizedRarity, 0.25)
})

test('zero pieces → realized shares are 0, no divide-by-zero', () => {
  const report = rarityReport({ tractus, pieces: [] })
  assert.equal(report.totalPieces, 0)
  for (const v of report.axes[0].valores) {
    assert.equal(v.realizedCount, 0)
    assert.equal(v.realizedRarity, 0)
  }
})

test('axis with zero total weight → targetRarity 0 (no NaN)', () => {
  const zero: Tractus[] = [{ porta: 'x', valores: [{ value: 'a', rarity: 0 }, { value: 'b', rarity: 0 }] }]
  const report = rarityReport({ tractus: zero, pieces: [] })
  for (const v of report.axes[0].valores) assert.equal(v.targetRarity, 0)
})
