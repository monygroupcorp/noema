// =============================================================================
// partnerContract — the published agreement IS the version keys are issued against
// =============================================================================
//
// `PARTNER_CONTRACT_VERSION` is load-bearing: it is stamped onto every partner API key and
// the credential acceptor refuses a key whose stamp is not this value. So it has to name the
// text a customer can actually read. Two ways that goes wrong and this catches both:
//
//   - the constant is bumped and the page is not (customers bound to text nobody published);
//   - the page is rewritten and a commitment goes missing (the agreement stops being the
//     thing the feature claims it is).
//
// The commitments are matched as PATTERNS, declared beside the constant. Rewording the page
// is free; deleting a commitment is not. Hermetic — two files off disk, no DB, no network.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PARTNER_CONTRACT_VERSION,
  PARTNER_CONTRACT_PATH,
  PARTNER_CONTRACT_SOURCE,
  PARTNER_CONTRACT_COMMITMENTS,
} from '../../../src/crystal/partnerContract.js'

// tests/unit/api → repo root is three levels up.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const page = readFileSync(resolve(repoRoot, PARTNER_CONTRACT_SOURCE), 'utf8')

test('the published agreement declares the version keys are issued against', () => {
  const declared = page.match(/^\*\*Version:\*\*\s*(\S+)\s*$/m)
  assert.ok(declared, `${PARTNER_CONTRACT_SOURCE} carries no "**Version:** <id>" line`)
  assert.equal(
    declared[1],
    PARTNER_CONTRACT_VERSION,
    `the published agreement says version '${declared[1]}' and PARTNER_CONTRACT_VERSION says ` +
      `'${PARTNER_CONTRACT_VERSION}'. Keys are stamped with the constant and the customer reads the page; ` +
      'they must be the same text. Bump both together.',
  )
})

test('the agreement carries every commitment it exists to make', () => {
  const missing = PARTNER_CONTRACT_COMMITMENTS.filter(c => !c.pattern.test(page)).map(c => c.label)
  assert.deepEqual(
    missing,
    [],
    `the published agreement no longer carries: ${missing.join('; ')}. Either restore the ` +
      'commitment, or — if it was deliberately reworded — update its pattern in ' +
      'src/crystal/partnerContract.ts so the guard follows the text rather than blocking it.',
  )
})

test('the agreement binds BOTH sides on named-artist styles, not just the customer', () => {
  // The one commitment in the set that is an obligation on US, and the one a rewrite would most
  // naturally drop while keeping the word "artist" somewhere on the page. Asserted separately so
  // a half-kept section fails loudly rather than passing on the section heading.
  assert.match(page, /\*\*We\*\* will not offer you a model, adapter, or preset/, 'our own half of the named-artist clause')
  assert.match(page, /\*\*You\*\* will not send prompts, adapters, or fine-tuning material/, "the customer's half")
})

test('the reference copy in docs/legal is the published page, byte for byte under its header', () => {
  // `guard-legal-mirror` already enforces this across every legal page; asserted here too because
  // this particular pair is the one the key gate depends on, and a repo-wide guard is easy to
  // skip in a hurry.
  const ref = readFileSync(resolve(repoRoot, 'docs/legal/api-terms.md'), 'utf8')
  const header = ref.match(/^<!--[\s\S]*?-->\n\n/)
  assert.ok(header, 'docs/legal/api-terms.md carries no source-of-truth header comment')
  assert.equal(ref.slice(header[0].length), page, 'the reference copy has drifted from the published page')
})

test('the agreement is published where the API says it is', () => {
  const app = readFileSync(resolve(repoRoot, 'src/platforms/web/app/src/App.tsx'), 'utf8')
  assert.ok(
    app.includes(`path="${PARTNER_CONTRACT_PATH}"`),
    `App.tsx declares no route for ${PARTNER_CONTRACT_PATH}, which is the path GET /v1/me/partner/contract ` +
      'sends a partner to read before signing.',
  )
})
