import { test } from 'node:test'
import assert from 'node:assert/strict'
import { contributionsPaused, type CeremonyStatus } from '../../../src/platforms/web/app/src/lib/ceremony.js'

// ---------------------------------------------------------------------------
// The page's status pill used to read "Ceremony open · accepting contributions"
// off the phase alone. The phase is a database record; whether anyone can
// actually contribute depends on a file being on the sequencer's disk, and the
// two come apart the moment a deploy replaces a container whose custody was not
// mounted. The pill went on inviting contributions into a 503.
//
// `contributionsPaused` is the difference between those two facts. It says the
// ceremony is paused only when the server has actually reported that it cannot
// hand out the head — never on a guess, and never on an older server that does
// not report the field at all, where the page behaves exactly as it used to.
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

test('open and servable is not paused', () => {
  assert.equal(contributionsPaused(status({ acceptingContributions: true })), false)
})

test('open but the head is not in custody is paused', () => {
  assert.equal(contributionsPaused(status({ acceptingContributions: false })), true)
})

test('a server that does not report the field is left alone', () => {
  // The field is absent, not false. Guessing "paused" here would take a working
  // ceremony off the page on nothing more than an older build being deployed.
  assert.equal(contributionsPaused(status()), false)
})

test('a ceremony that is not open is never "paused" — it was never accepting', () => {
  assert.equal(contributionsPaused(status({ phase: 'announced', acceptingContributions: false })), false)
  assert.equal(contributionsPaused(status({ phase: 'finalized', acceptingContributions: false })), false)
})

test('no status at all is not paused', () => {
  assert.equal(contributionsPaused(null), false)
})
