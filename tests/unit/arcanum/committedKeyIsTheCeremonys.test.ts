import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

// ---------------------------------------------------------------------------
// The committed proving key is the ceremony's output, and CI is where that is checked.
//
// The server already refuses to serve a key the transcript does not name, and serves the
// committed one the moment its hash matches (src/arcanum/ProvingKeySource.ts). Both halves
// are right, and together they have a blind spot: if the image carries a key the ceremony
// did not produce, everything behaves correctly and the site serves NOTHING — 503 on
// /arcanum/circuit/zkey, `ready: false`, a transcript still advertising a finished
// ceremony. Correct, and dark.
//
// That is not hypothetical. The ceremony finalized on 2026-08-04 naming dd9668a5…; the
// image went on carrying 5b75bb88…, the solo dev key, and the site served no proving key
// for six weeks. Nothing failed. The tests all passed, because every one of them derives
// its expected hash FROM the tracked file — so a file swapped for any other bytes proves
// itself, and the one comparison that matters, against the hash the public record already
// publishes, was made by hand against production and by nothing else.
//
// This is that comparison, pinned. The hash below is not derived from anything in the
// tree; it is transcribed from the ceremony's own published record:
//
//     curl -s https://noema.art/v1/ceremony | jq -r .finalHash
//
// It stays a test-only constant deliberately. Read at runtime it would let the image
// assert the ceremony's outcome, and the whole point of the transcript is that the
// database says what the ceremony produced and the image has to match it, never the
// reverse.
// ---------------------------------------------------------------------------

/** The beacon'd final proving key, as published by GET /v1/ceremony. */
const CEREMONY_FINAL_HASH = 'dd9668a51dab87667d9804e0e19180c64565d39422197e1357730e1a1365fb2d'

/** The solo dev key that shipped in its place, kept so the failure is nameable. */
const DEV_SETUP_KEY_HASH = '5b75bb881bd5fe210b67e776b1cb55ec1873935396049ed6b637f360ff52ae02'

const ZKEY_PATH = path.join(process.cwd(), 'src/arcanum/circuit/artifacts/arcanum_final.zkey')

test('the proving key in this image is the one the ceremony published', () => {
  assert.ok(existsSync(ZKEY_PATH),
    'arcanum_final.zkey is tracked, not fetched — the deploy has no artifact to move and no ' +
    'step that can be skipped on the next box. An absent file is a broken image.')

  const hash = createHash('sha256').update(readFileSync(ZKEY_PATH)).digest('hex')

  assert.notEqual(hash, DEV_SETUP_KEY_HASH,
    'this is the solo dev key from arcanum-trusted-setup.sh, not the ceremony\'s. Anyone who ' +
    'ran that script could forge proofs on it, and the server will serve no key at all rather ' +
    'than hand it out under a finished transcript.')

  assert.equal(hash, CEREMONY_FINAL_HASH,
    'arcanum_final.zkey is not the key GET /v1/ceremony names as finalHash. A site running ' +
    'this image serves no proving key: /arcanum/circuit/zkey answers 503 and /arcanum/config ' +
    'reads zkeySource none, while the transcript goes on advertising a finished ceremony. ' +
    'Commit the ceremony\'s own output (and the verification_key.json exported from it), or ' +
    'if the ceremony was re-run, update the hash here from its new published transcript.')
})

// The other half of the pair is checked against real snarkjs in verifierPairingReal.test.ts:
// the tracked verification_key.json is derivable from the tracked zkey. The two tests
// together are the whole claim — this one ties the image's key to the public record, that
// one ties the verifier to the same key — and neither is sufficient alone. A key matching
// the transcript with a verifier from a different setup leaves honest proofs rejected under
// a page reporting the ceremony closed.
//
// Neither reads the contributions INSIDE the key against the published chain; that is
// `snarkjs zkey verify` against the Hermez ptau, which needs a 700MB download no CI runner
// has. docs/arcanum-ceremony.md says how to run it, and it is a thing a human does once
// when the key changes.
