import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Cursor } from '../../../src/types/cursus.js'
import type { Modus } from '../../../src/types/modus.js'
import { Cursorum } from '../../../src/execution/Cursorum.js'

function makeModus(ministerium: string): Modus {
  return {
    id: 'mod-1', nomen: 'test modus', genus: 'atomicus',
    versio: '1.0.0', contentHash: 'abc',
    aditus: {}, exitus: {}, canonica: true,
    natum: new Date(), mutatum: new Date(),
    ministerium,
  }
}

function makeRunner(): Cursor {
  return {
    reserve: async () => 100n,
    run: async () => ({ exitus: {}, impetus: 100n }),
  }
}

test('resolves a registered runner by modus.ministerium', () => {
  const cursorum = new Cursorum()
  const runner = makeRunner()
  cursorum.register('openai', runner)

  const resolved = cursorum.resolve(makeModus('openai'))

  assert.strictEqual(resolved, runner)
})

test('resolves the correct runner when multiple are registered', () => {
  const cursorum = new Cursorum()
  const runpodRunner = makeRunner()
  const openaiRunner = makeRunner()
  cursorum.register('runpod', runpodRunner)
  cursorum.register('openai', openaiRunner)

  assert.strictEqual(cursorum.resolve(makeModus('runpod')), runpodRunner)
  assert.strictEqual(cursorum.resolve(makeModus('openai')), openaiRunner)
})

test('throws when no runner is registered for ministerium', () => {
  const cursorum = new Cursorum()

  assert.throws(
    () => cursorum.resolve(makeModus('unknown-service')),
    /unknown-service/,
  )
})

test('throws when modus has no ministerium', () => {
  const cursorum = new Cursorum()
  const modus = makeModus('')
  delete (modus as Partial<Modus>).ministerium

  assert.throws(
    () => cursorum.resolve(modus),
    /ministerium/,
  )
})

test('later registration overwrites earlier for the same key', () => {
  const cursorum = new Cursorum()
  const first = makeRunner()
  const second = makeRunner()
  cursorum.register('openai', first)
  cursorum.register('openai', second)

  assert.strictEqual(cursorum.resolve(makeModus('openai')), second)
})
