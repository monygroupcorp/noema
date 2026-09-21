// The pairing check against the real snarkjs exporter and the real tracked artifacts.
//
// A stubbed exporter here would be testing the stub: the whole question is whether the
// verification key this server holds is derivable from the proving key it serves, and
// only snarkjs can answer that. See verifierPairing.test.ts for the logic around it and
// src/arcanum/verifierPairing.ts for why the question is worth asking at all.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import request from 'supertest'
import { createArcanumRouter } from '../../../src/api/arcanum/arcanumRouter.js'
import { createRepoProvingKeySource } from '../../../src/arcanum/ProvingKeySource.js'
import { createVerifierPairing } from '../../../src/arcanum/verifierPairing.js'
import type { ServedProvingKey } from '../../../src/arcanum/ProvingKeySource.js'
import type { ArcanumIssuer } from '../../../src/ledger/ArcanumIssuer.js'
import type { ArcanumTreeStore } from '../../../src/arcanum/ArcanumTree.js'

// snarkjs's exporter builds a bn128 curve through ffjavascript, which starts a worker pool
// and hands snarkjs no way to stop it: the process stays alive with nothing left to do and
// the file never returns. (Terminating the curve does not help — snarkjs carries its own
// nested copy of ffjavascript, so more than one pool is left behind.) So the file exits
// itself, the way ArcanumPairing.test.ts does.
//
// It exits on the VERDICT, which is the part that idiom got wrong. `process.exit(0)` from a
// hook throws the run away before node:test can report it, so a file that exits that way
// reports as a pass whatever its assertions did — a wrong assertion in one leaves the gate
// green. Anything thrown in the test below leaves `passed` false and this exits 1, which is
// the only signal the runner has left to read.
let passed = false

after(() => {
  process.exit(passed ? 0 : 1)
})

const ARTIFACTS = path.join(process.cwd(), 'src/arcanum/circuit/artifacts')
const ZKEY_PATH = path.join(ARTIFACTS, 'arcanum_final.zkey')
const VKEY_PATH = path.join(ARTIFACTS, 'verification_key.json')

const served: ServedProvingKey = { origin: 'repo', hash: 'a'.repeat(64), path: ZKEY_PATH }

test('the pairing check reads a real zkey: the tracked pair pairs, another setup does not', async (t) => {
  assert.ok(existsSync(ZKEY_PATH), 'arcanum_final.zkey must be tracked')
  assert.ok(existsSync(VKEY_PATH), 'verification_key.json must be tracked')
  const tracked = JSON.parse(readFileSync(VKEY_PATH, 'utf8')) as { vk_alpha_1: string[] }

  assert.equal(await createVerifierPairing(tracked)(served), 'paired')

  // The shape is right and one curve point is not — a different setup's key, which is
  // exactly what an image built before the ceremony carries.
  const other = JSON.parse(JSON.stringify(tracked)) as { vk_alpha_1: string[] }
  other.vk_alpha_1 = [...other.vk_alpha_1]
  other.vk_alpha_1[0] = other.vk_alpha_1[0] === '1' ? '2' : '1'
  assert.equal(await createVerifierPairing(other)(served), 'mismatch')

  t.diagnostic('both verdicts derived from the tracked arcanum_final.zkey')

  // And the verdict reaches the surface that decides whether a client should prove at all.
  // A key clients can fetch whose proofs this server cannot verify is not a ready site —
  // this is the half of the ceremony's promise that lives in the verification key, and
  // reporting ready:true here would put the finished badge on a setup still forgeable by
  // whoever holds the other one's toxic waste.
  const config = async (verificationKey: unknown) => {
    const app = express()
    app.use('/arcanum', createArcanumRouter(
      {} as unknown as ArcanumIssuer,
      {} as unknown as ArcanumTreeStore,
      { provingKey: createRepoProvingKeySource(ZKEY_PATH), verificationKey },
    ))
    return (await request(app).get('/arcanum/config')).body
  }

  const paired = await config(tracked)
  assert.equal(paired.verifierPaired, true)
  assert.equal(paired.ready, true)

  const unpaired = await config(other)
  assert.equal(unpaired.verifierPaired, false)
  assert.equal(unpaired.ready, false)
  // The key itself is still named and still served: the site is saying what it has and
  // what is wrong with it, not going dark.
  assert.equal(unpaired.zkeySource, 'repo')
  assert.equal(typeof unpaired.zkeyHash, 'string')

  // A server holding no verification key cannot answer the question and says so, rather
  // than reading as a mismatch and taking itself down.
  const silent = await config(undefined)
  assert.equal(silent.verifierPaired, null)
  assert.equal(silent.ready, true)

  passed = true
})
