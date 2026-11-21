import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// DESIGN.md D-42: a screen has one primary action, styled as the accent-filled button;
// everything else is ghost or plain. /collections' topbar '+ New collection' pill was one
// accent button, and every card's own next-step action ('Author draft →' / 'View run →' /
// 'Export & publish →') was ALSO accent-filled — three more live accent buttons on the same
// screen at once, on top of the topbar's.

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(resolve(here, '../../../src/platforms/web/app/src/screens/Collections.tsx'), 'utf8')

test('a collection card carries no accent-filled action — the topbar is the one primary action', () => {
  const collActions = src.match(/<div className="coll-actions">([\s\S]*?)<\/div>\s*<\/div>/)
  assert.ok(collActions, '.coll-actions block not found — Collections.tsx changed shape')
  assert.doesNotMatch(collActions![1], /"btn accent"/, 'a card action is still accent-filled, competing with the topbar\'s primary action (D-42)')
})
