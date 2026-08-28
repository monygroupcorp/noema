import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { CONCIERGE_ROUTES, validateDestination } from '../../../src/allocutio/api/ConciergeAgent.js'

// =============================================================================
// NAVIGATE boundary (noema-367). The agent proposes a destination, it never
// steers there — the user clicks and react-router does the routing. This guard
// holds two invariants mechanically:
//   (1) the reply-parse/destination path is a pure, synchronous, no-I/O function:
//       it cannot call a tool, cannot touch `deps`/`api`/`ctx`, cannot await.
//   (2) CONCIERGE_ROUTES never carries an auth/identity/admin route — the
//       concierge never steers auth or identity.
// =============================================================================

const SRC_PATH = path.join(process.cwd(), 'src/allocutio/api/ConciergeAgent.ts')

test('validateDestination is a pure, synchronous function with no deps/api/ctx access', () => {
  const src = readFileSync(SRC_PATH, 'utf8')
  const m = src.match(/export function validateDestination\([\s\S]*?\n}\n/)
  assert.ok(m, 'validateDestination not found in ConciergeAgent.ts')
  const body = m![0]
  assert.ok(!/\bawait\b/.test(body), 'validateDestination must not await anything (no I/O)')
  assert.ok(!/\bdeps\.|\bapi\.|\bctx\./.test(body), 'validateDestination must not reach into deps/api/ctx')
})

test('validateDestination returns synchronously, never a Promise', () => {
  const result = validateDestination({ path: '/chat', label: 'Open chat' })
  assert.ok(!(result instanceof Promise), 'validateDestination must not be async')
})

// The four forbidden strings are the item spec's own list (auth/identity/moderation
// surfaces the concierge must never steer toward).
const FORBIDDEN = ['/onboard', '/keyring', '/ceremony', '/admin']

test('CONCIERGE_ROUTES contains no auth/identity route', () => {
  for (const route of CONCIERGE_ROUTES) {
    for (const bad of FORBIDDEN) {
      assert.ok(
        route !== bad && !route.startsWith(`${bad}/`),
        `CONCIERGE_ROUTES entry "${route}" matches forbidden prefix "${bad}"`,
      )
    }
  }
})

test('CONCIERGE_ROUTES is non-empty and every entry is an in-app absolute path', () => {
  assert.ok(CONCIERGE_ROUTES.length > 0)
  for (const route of CONCIERGE_ROUTES) {
    assert.ok(route.startsWith('/'), `"${route}" must start with "/"`)
    assert.ok(!route.includes('//'), `"${route}" must not contain "//"`)
    assert.ok(!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(route), `"${route}" must not carry a scheme`)
  }
})
