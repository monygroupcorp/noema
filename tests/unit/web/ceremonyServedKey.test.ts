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

// ---------------------------------------------------------------------------
// A hash match is half the claim. The proving key clients download follows the
// ceremony; the verification key the site judges their proofs with is a file in
// the image, and the two are only meaningful as a pair. Publish the ceremony's
// key against an image built before it and the transcript, the served hash and
// the page all agree — while no proof made with that key can verify here, and
// the key still in force is the one the ceremony was run to replace.
// ---------------------------------------------------------------------------

test('a served key that matches the transcript but cannot be verified is not a match', () => {
  assert.equal(
    checkServedKey(finalized(), { hash: FINAL, source: 'ceremony', paired: false }),
    'unverifiable',
  )
})

test('a matching key the server vouches for is still a match', () => {
  assert.equal(
    checkServedKey(finalized(), { hash: FINAL, source: 'ceremony', paired: true }),
    'match',
  )
})

test('a server that does not report the pairing keeps the verdict it always gave', () => {
  // `paired` absent is an older build, not a failed check. Downgrading here would put a
  // warning on every site that has not redeployed yet.
  assert.equal(checkServedKey(finalized(), { hash: FINAL, source: 'ceremony' }), 'match')
  assert.equal(checkServedKey(finalized(), { hash: FINAL, source: 'ceremony', paired: null }), 'match')
})

test('the pairing never rescues a key the transcript does not name', () => {
  // Wrong key, vouched for: still the wrong key. The hash comparison comes first.
  assert.equal(checkServedKey(finalized(), { hash: OTHER, source: 'ceremony', paired: true }), 'mismatch')
})

// ---------------------------------------------------------------------------
// "Serves nothing" has two causes and one message, and they want opposite work.
//
// A box whose custody a deploy emptied is missing bytes: publish the key there
// and it is done. A box running a build older than the ceremony's output is not
// missing anything — it is holding a proving key, just the wrong one, and no
// amount of publishing on that box helps because the build itself predates the
// key. Both read `zkeySource: 'none'` and both said "not published here yet".
//
// The byte that separates them is the hash of the key the build carries, which
// /arcanum/config now reports whenever that is not the key being served.
// ---------------------------------------------------------------------------

test('serving nothing while holding a different key is withheld, not absent', () => {
  assert.equal(
    checkServedKey(finalized(), { hash: null, source: 'none', imageKeyHash: OTHER }),
    'withheld',
  )
})

test('serving nothing and holding nothing is still absent', () => {
  // Nothing to name, so nothing to tell apart — the message that was always right here.
  assert.equal(
    checkServedKey(finalized(), { hash: null, source: 'none', imageKeyHash: null }),
    'absent',
  )
  // A server that predates the field omits it, and keeps the verdict it always gave.
  assert.equal(checkServedKey(finalized(), { hash: null, source: 'none' }), 'absent')
})

test('the site can name the key it belongs to and still be withholding another', () => {
  // The live shape: /config reports zkeyHash (the transcript's key, which this box does
  // not have) beside imageKeyHash (the key it does). Naming the expected key is not the
  // same as serving it, and the verdict follows the source, not the hash.
  assert.equal(
    checkServedKey(finalized(), { hash: null, source: 'none', imageKeyHash: OTHER, paired: null }),
    'withheld',
  )
})

test('a build carrying the right key is never withheld — it is serving it', () => {
  // imageKeyHash is only reported when the image key is NOT the served key, so a match
  // can never carry one. Belt and braces: the source decides first.
  assert.equal(
    checkServedKey(finalized(), { hash: FINAL, source: 'ceremony', imageKeyHash: null }),
    'match',
  )
})
