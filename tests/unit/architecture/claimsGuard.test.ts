import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// `npm run guard:claims` keeps unhedged privacy absolutes out of the tree. Nothing tested the
// guard itself, and both halves of it were wrong in a way that only a test would have shown.
//
//   • The denylist spelled one phrase hyphenated. The site footer said it with spaces, on every
//     page, and the guard read past it for as long as it was there.
//   • The hedge was matched per LINE. "Direct-to-commitment deposits, where we never see the
//     funding wallet, are on the roadmap" is a true, hedged sentence, and it passed or failed on
//     where its author pressed Enter — so /pricing carried a hand-placed line break and a comment
//     asking the next editor not to reflow it. A guard a formatter can break gets worked around.
//
// So this runs the shipped script, against real files in the tree, and asserts both directions:
// what it must catch, and what it must let through. The fixture is written into the repo (the
// guard reads `git ls-files --others`, so an untracked file is scanned) and removed afterwards.

// `import.meta.dirname` is undefined here: `test:hermetic` runs this file through tsx's CJS
// transform, where only `import.meta.url` survives. It read as undefined, `join` threw at import
// time, and the whole file counted as ONE failing test — so the guard this exists to prove was
// never run by the suite that is supposed to prove it, and the suite was red for saying so.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const FIXTURE = join(ROOT, 'tests', 'unit', 'architecture', 'claims-guard-fixture.txt')

/** Run the guard over a tree containing `body` as an untracked file. Returns its report. */
function guardOn(body: string): { code: number; out: string } {
  writeFileSync(FIXTURE, body)
  try {
    const r = spawnSync('node', ['scripts/guard-claims.mjs'], { cwd: ROOT, encoding: 'utf8' })
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` }
  } finally {
    unlinkSync(FIXTURE)
  }
}

test('the tree as it stands carries no unhedged absolute', () => {
  const r = spawnSync('node', ['scripts/guard-claims.mjs'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
})

// The hyphen pairs are the point: each of these differs from its neighbour only in the separator,
// and the spaced spelling of the first pair is the one that shipped in the footer.
test('a denied absolute is caught however its separator is spelled', () => {
  for (const phrase of [
    'Your work is privacy by construction.',
    'Your work is privacy-by-construction.',
    'Military-grade encryption throughout.',
    'Military grade encryption throughout.',
  ]) {
    const { code, out } = guardOn(phrase)
    assert.equal(code, 1, `should have been caught: ${phrase}\n${out}`)
    assert.match(out, /claims-guard-fixture\.txt/, out)
  }
})

test('a hedge earns its sentence, not merely its line', () => {
  const wrapped =
    'Direct-to-commitment deposits, where\nwe never see the funding wallet, are on the roadmap.\n'
  const { code, out } = guardOn(wrapped)
  assert.equal(code, 0, `a hedged sentence must pass however it wraps:\n${out}`)
})

test('a hedge in the NEXT paragraph does not excuse this one', () => {
  const distant = 'We never see the funding wallet.\n\nSomething else entirely is on the roadmap.\n'
  const { code } = guardOn(distant)
  assert.equal(code, 1, 'a blank line ends the sentence, so the hedge must not reach back')
})

test('an unhedged absolute is reported with its file and line', () => {
  const { code, out } = guardOn('first line\nsecond line\nWe never see your prompts.\n')
  assert.equal(code, 1)
  assert.match(out, /claims-guard-fixture\.txt:3: we never see/i, out)
})
