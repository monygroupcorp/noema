import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HELP_TEXT, GROUP_RULE } from '../../../../src/allocutio/lexicon/copy.js'

test('HELP_TEXT lists /bind and /stop, which CommandRouter already routes', () => {
  assert.match(HELP_TEXT, /\/bind/)
  assert.match(HELP_TEXT, /\/stop/)
})

test('HELP_TEXT lists /train, which CommandRouter already routes', () => {
  assert.match(HELP_TEXT, /\/train/)
})

test('HELP_TEXT states the group rule: a user who only sees silence learns why', () => {
  assert.ok(HELP_TEXT.includes(GROUP_RULE))
})
