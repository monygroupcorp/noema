import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatFunnelReport } from '../../../scripts/funnel-report.js'

test('formats a header and one row per stage, in the given order', () => {
  const out = formatFunnelReport({
    since: '2024-01-01T00:00:00.000Z',
    stages: [
      { stage: 'catalog_view', visitors: 100, ofStart: 1, ofPrevious: 1, droppedHere: 0 },
      { stage: 'quote', visitors: 40, ofStart: 0.4, ofPrevious: 0.4, droppedHere: 60 },
    ],
  })
  const lines = out.split('\n')
  assert.ok(lines[0].includes('2024-01-01'))
  assert.ok(lines.some((l) => l.includes('catalog_view') && l.includes('100')))
  assert.ok(lines.some((l) => l.includes('quote') && l.includes('40') && l.includes('60')))
})

test('an empty stage list still prints the header without throwing', () => {
  const out = formatFunnelReport({ since: '2024-01-01T00:00:00.000Z', stages: [] })
  assert.ok(out.includes('stage'))
})
