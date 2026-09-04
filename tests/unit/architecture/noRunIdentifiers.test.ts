import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

// This repository is public. A run id, an actum id or a provider's pod id in a comment is a
// permanent public pointer at a private record — the same objection the commit attribution guard
// raises against session URLs. It is also useless to the reader: the sentence around it already
// carried the fact, and the id only named a row nobody outside can open.
//
// The MiniMax H3 bring-up put several into seeds, tests and a PR body before anyone noticed.
//
// What is allowed: describing the run ("the first cold t2v run"), and the MEASUREMENTS from it.
// Numbers are evidence; identifiers are pointers.

// Both patterns are KEYWORD-ANCHORED, deliberately. A first attempt matched any 14-character
// alphanumeric — the shape of a RunPod pod id — and flagged 70 legitimate lines, because
// `ms2stationthis` and `miladystation2` are also 14 characters. A guard that noisy gets deleted
// rather than obeyed. Anchoring on the word that introduces the id catches every form that
// actually leaked here and cannot fire on an org or a hostname.

/**
 * `pod ybpa…`, `job z7ai…`, `podId: '…'` — an opaque handle introduced by its noun.
 *
 * The token must carry at least two letters AND two digits. Without that it matched ordinary
 * English after the keyword — "pod entrypoint", "job communication", "pod provisioner" — which
 * is the second way this guard nearly became unusable. Real pod ids interleave the two.
 */
const POD_ID = /\b(?:pod|podId|job|jobId)\s*[:=]?\s+`?'?(?=[a-z0-9]*[a-z][a-z0-9]*[a-z])(?=[a-z0-9]*\d[a-z0-9]*\d)[a-z0-9]{10,20}`?'?\b/i
/** `actum 01a7…` / `run 5eff…`, whole or by leading 8 hex — the shapes that got merged. */
const ACTUM_ID = /\b(?:actum|run|job)\s+`?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}`?|\b(?:actum|run|job)\s+`?[0-9a-f]{8}`?\b/i

const files = execFileSync('git', ['ls-files', 'src', 'tests/unit', 'scripts'], { encoding: 'utf8' })
  .split('\n').filter(f => /\.(ts|py|sh)$/.test(f) && !f.endsWith('noRunIdentifiers.test.ts'))

test('no source file cites a run, actum or pod identifier', () => {
  const offenders: string[] = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (ACTUM_ID.test(line) || POD_ID.test(line)) offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 90)}`)
    })
  }
  assert.deepEqual(
    offenders, [],
    'each line above names a specific run or pod. Describe the run instead — "the first cold ' +
    't2v run" — and keep the measurements. The id is a public pointer at a private record and ' +
    'tells a future reader nothing.',
  )
})

test('the guard actually matches the shapes that leaked (not vacuous)', () => {
  assert.ok(ACTUM_ID.test('// Measured on actum 01a7dc6b (cold, RTX 4090)'))
  assert.ok(ACTUM_ID.test('* (actum 7d5fd175) at `executionMs: 898405`'))
  assert.ok(POD_ID.test('job z7ai6mkic7gm6y timed out after 900s'))
  // and does not fire on ordinary prose or on measurements
  assert.ok(!ACTUM_ID.test('the first cold t2v run executed in 768 s of a 900 s budget'))
  assert.ok(!POD_ID.test('the substrate carries 56 GB of weights'))
  assert.ok(!POD_ID.test('containerDiskInGb'))
  // the false positives that killed the first draft of this guard
  assert.ok(!POD_ID.test("const ORG = process.env.HF_ORG ?? 'ms2stationthis'"))
  assert.ok(!POD_ID.test('https://models.miladystation2.net/vae/ae.safetensors'))
  assert.ok(!ACTUM_ID.test('a job window of 900 s'))
})
