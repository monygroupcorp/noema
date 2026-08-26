import { test } from 'node:test'
import assert from 'node:assert/strict'

import { pickConciergeThread } from '../../../src/platforms/web/app/src/lib/conciergeThread.js'

test('pickConciergeThread: newest wins even when the list is not pre-sorted', () => {
  const threads = [
    { id: 'a', mutatum: '2026-08-20T00:00:00.000Z' },
    { id: 'c', mutatum: '2026-08-25T00:00:00.000Z' },
    { id: 'b', mutatum: '2026-08-22T00:00:00.000Z' },
  ]
  assert.deepEqual(pickConciergeThread(threads), { action: 'resume', id: 'c' })
})

test('pickConciergeThread: empty list creates', () => {
  assert.deepEqual(pickConciergeThread([]), { action: 'create' })
})

test('pickConciergeThread: a single thread resumes itself', () => {
  const threads = [{ id: 'only', mutatum: '2026-08-01T00:00:00.000Z' }]
  assert.deepEqual(pickConciergeThread(threads), { action: 'resume', id: 'only' })
})

// The dock's explicit "+ New conversation" affordance (Concierge.tsx's startNewDock) never
// calls pickConciergeThread — it clears the pointer directly, bypassing this helper entirely.
// That is a structural property of the dock's wiring rather than of this pure helper, and
// isn't asserted here: the app's toolchain has no jsdom/@testing-library/react (see
// dirtyGuard.test.ts's header note), so there is no component-level harness in this suite to
// render the dock and observe the bypass.
