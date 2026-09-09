import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkServedKey, type CeremonyStatus, type ServedKey } from '../../../src/platforms/web/app/src/lib/ceremony.js'

// ---------------------------------------------------------------------------
// The /ceremony page publishes a transcript ending in a final key hash. The key
// clients prove with is served by a different route entirely, and for a while the
// live site named `dd9668…` in its transcript while /arcanum/circuit/zkey handed
// out the key the image happened to be built with. Nothing said so, because
// nothing compared them.
//
// `checkServedKey` is that comparison, and this pins the two answers that matter:
// it says 'match' only when the hashes are actually equal, and it never says
// 'match' by default — an unfinished ceremony, an older server, or a key hosted
// elsewhere each get their own verdict rather than being waved through.
// ---------------------------------------------------------------------------

const FINAL = 'dd9668a51dab87667d9804e0e19180c64565d39422197e1357730e1a1365fb2d'
const OTHER = '5b75bb881bd5fe210b67e776b1cb55ec1873935396049ed6b637f360ff52ae02'

function finalized(finalHash: string | null = FINAL): CeremonyStatus {
  return { phase: 'finalized', rootHash: 'ab'.repeat(32), chain: [], finalHash, openSlots: null }
}
function served(hash: string | null, source: ServedKey['source']): ServedKey {
  return { hash, source }
}

test('the served key is the transcript key: match', () => {
  assert.equal(checkServedKey(finalized(), served(FINAL, 'ceremony')), 'match')
})

test('a served key the transcript does not name is a mismatch, whatever it calls itself', () => {
  assert.equal(checkServedKey(finalized(), served(OTHER, 'ceremony')), 'mismatch')
  // The repo key under a finished transcript is the exact case that shipped.
  assert.equal(checkServedKey(finalized(), served(OTHER, 'repo')), 'mismatch')
})

test('hash comparison ignores case, so an upper-case hash is not read as a mismatch', () => {
  assert.equal(checkServedKey(finalized(), served(FINAL.toUpperCase(), 'ceremony')), 'match')
})

test('a finalized ceremony whose key this server has not got reads absent, not match', () => {
  assert.equal(checkServedKey(finalized(), served(null, 'none')), 'absent')
  assert.equal(checkServedKey(finalized(), served(null, 'ceremony')), 'absent')
})

test('a key hosted off this API is external — we have not seen those bytes and do not vouch for them', () => {
  assert.equal(checkServedKey(finalized(), served(null, 'external')), 'external')
})

test('nothing to compare reads unknown rather than match', () => {
  const open: CeremonyStatus = { phase: 'open', rootHash: null, chain: [], finalHash: null, openSlots: 3 }
  assert.equal(checkServedKey(open, served(OTHER, 'repo')), 'unknown')
  assert.equal(checkServedKey(finalized(null), served(FINAL, 'ceremony')), 'unknown')
  assert.equal(checkServedKey(null, served(FINAL, 'ceremony')), 'unknown')
  // An older server omits zkeySource entirely; ceremony.servedKey() reports that as null.
  assert.equal(checkServedKey(finalized(), null), 'unknown')
  assert.equal(checkServedKey(finalized(), served(null, null)), 'unknown')
})
