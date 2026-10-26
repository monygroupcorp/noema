import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heroAction, type CeremonyStatus } from '../../../src/platforms/web/app/src/lib/ceremony.js'

// ---------------------------------------------------------------------------
// The ceremony page's hero used to show a filled "Contribute" button under a status
// pill that could read "finalized · keys published" or "contributions paused": the
// one accent-filled control on the page inviting the one thing the page could not
// accept. `heroAction` is what that button says and where it leads, derived from the
// same status the pill reads, plus the one line the fold says about why.
// ---------------------------------------------------------------------------

function status(over: Partial<CeremonyStatus> = {}): CeremonyStatus {
  return {
    phase: 'open',
    rootHash: 'ab'.repeat(32),
    chain: [],
    finalHash: null,
    openSlots: null,
    headHash: 'ab'.repeat(32),
    ...over,
  }
}

test('while contributions are accepted the hero invites one, with nothing to explain', () => {
  const a = heroAction(status({ acceptingContributions: true }))
  assert.equal(a.label, 'Contribute')
  assert.equal(a.href, '#contribute')
  assert.equal(a.note, null)
})

test('before the coordinator answers, and while announced, it still leads to the contribution card', () => {
  assert.equal(heroAction(null).href, '#contribute')
  assert.equal(heroAction(status({ phase: 'announced' })).href, '#contribute')
})

test('finalized: the primary is verifying the published key, and the fold says contributions are closed', () => {
  const a = heroAction(status({ phase: 'finalized', finalHash: 'cd'.repeat(32) }))
  assert.equal(a.href, '#transcript')
  assert.doesNotMatch(a.label, /contribute/i)
  assert.match(a.note ?? '', /closed/)
})

test('paused: the primary is the transcript, and the fold says why a contribution cannot be taken', () => {
  const a = heroAction(status({ acceptingContributions: false }))
  assert.equal(a.href, '#transcript')
  assert.doesNotMatch(a.label, /contribute/i)
  assert.match(a.note ?? '', /paused/)
})
