import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CANON_VERBS } from '../../../../src/crystal/canonVerbs.js'
import { API_PROVIDERS } from '../../../../src/crystal/apiProviders.js'
import { CANONICAL_MODI, MODUS_CHATGPT } from '../../../../src/crystal/seeds/modi.js'

test('CANON_VERBS.chat resolves to a canonical seeded modus', () => {
  const target = CANONICAL_MODI.find(m => m.id === CANON_VERBS.chat)
  assert.ok(target, `${CANON_VERBS.chat} should exist in the seed set`)
  assert.equal(target!.canonica, true, `${CANON_VERBS.chat} should be canonica`)
})

test('modus.chatgpt is de-canonised but retained for historical actus', () => {
  assert.equal(MODUS_CHATGPT.canonica, false)
  assert.ok(CANONICAL_MODI.includes(MODUS_CHATGPT), 'still exported and seeded')
  assert.ok(MODUS_CHATGPT.contentHash.length > 0, 'still hashes — historical actus can still resolve it')
})

test('every API_PROVIDERS entry has a unique id, a non-empty authEnv, and at least one capability', () => {
  const ids = new Set<string>()
  for (const p of API_PROVIDERS) {
    assert.ok(!ids.has(p.id), `duplicate provider id ${p.id}`)
    ids.add(p.id)
    assert.ok(p.authEnv.length > 0, `${p.id} should have a non-empty authEnv`)
    assert.ok(Object.keys(p.capabilities).length > 0, `${p.id} should serve at least one capability`)
  }
})

test("modus.openrouter-chat's model port offers enumerated choices whose default is one of them", () => {
  const modus = CANONICAL_MODI.find(m => m.id === 'modus.openrouter-chat')
  assert.ok(modus, 'modus.openrouter-chat should be seeded')
  const modelPort = modus!.aditus.model
  assert.ok(modelPort?.optiones && modelPort.optiones.length > 0, 'model port should carry optiones')
  for (const o of modelPort!.optiones!) {
    assert.ok(o.value.length > 0, 'every optio should have a non-empty value')
    assert.ok(o.label.length > 0, 'every optio should have a non-empty label')
  }
  assert.ok(
    modelPort!.optiones!.some(o => o.value === modelPort!.default),
    'the port default should appear among its own optiones',
  )
})
