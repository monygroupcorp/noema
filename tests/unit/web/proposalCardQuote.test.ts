import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatQuote } from '../../../src/platforms/web/app/src/lib/format.js'

// ---------------------------------------------------------------------------
// noema-361 — the concierge quote must read as a price. `formatQuote` is the
// SAME function ProposalCard's render imports and calls, so a revert to the
// old inline "~{impetus} credits" string (no unit-formatting, no shared
// formatter) removes its only caller and this suite catches the regression.
// ---------------------------------------------------------------------------

test('formatQuote: the amount carries a formatted number and the shared unit word', () => {
  const { amount } = formatQuote({ impetus: '1234567', recipient: '123456789012345' })
  assert.equal(amount, '1,234,567 cr')
})

test('formatQuote: the recipient is a short labeled detail, not the raw id jammed in', () => {
  const recipient = '123456789012345678901234567890'
  const { recipientShort } = formatQuote({ impetus: '100', recipient })
  assert.notEqual(recipientShort, recipient)
  assert.ok(recipientShort.length < recipient.length)
})

test('formatQuote: a short recipient is shown in full (nothing to truncate)', () => {
  const { recipientShort } = formatQuote({ impetus: '100', recipient: 'abc123' })
  assert.equal(recipientShort, 'abc123')
})
