import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// The web app renders its marketing pages and its guides from markdown it reads at BUILD time —
// `import.meta.glob('../content/blog/*.md')` and friends. A file that is not in the Docker build
// context is not a broken build: the glob simply resolves to fewer entries, the bundle compiles,
// every test passes, and the page ships empty.
//
// That happened. `.dockerignore` drops `**/*.md` and un-ignored `src/platforms/web/app/src/
// content/*.md`. A `*` never crosses a `/`, so the three published guides in `content/blog/`
// were excluded from the context, and https://noema.art/blog served its "Nothing published yet"
// empty state over them — for six days, with no red anywhere, because every local build and
// every test sees the working tree, where the files are right there.
//
// So the invariant is stated per DIRECTORY, which is also how the app globs: every directory
// under `content/` that holds markdown must be named by its own `!…/*.md` line. No `**`, no
// matcher re-implemented here that could be wrong in the same way the ignore file was — just the
// literal line, which means adding a content folder fails this test with the line to paste.

// `import.meta.dirname` is undefined here: `test:hermetic` runs this file through tsx's CJS
// transform, where only `import.meta.url` survives.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CONTENT = join(ROOT, 'src', 'platforms', 'web', 'app', 'src', 'content')

/** Every directory at or under `dir` that directly holds a `.md` file. */
function markdownDirs(dir: string): string[] {
  const entries = readdirSync(dir, { withFileTypes: true })
  const here = entries.some(e => e.isFile() && e.name.endsWith('.md')) ? [dir] : []
  const below = entries.filter(e => e.isDirectory()).flatMap(e => markdownDirs(join(dir, e.name)))
  return [...here, ...below]
}

/** The `!`-prefixed lines of `.dockerignore`, comments and blanks dropped. */
function negations(): Set<string> {
  const lines = readFileSync(join(ROOT, '.dockerignore'), 'utf8').split('\n')
  return new Set(lines.map(l => l.trim()).filter(l => l.startsWith('!')))
}

test('every web-app content directory is un-ignored for the Docker build context', () => {
  const dirs = markdownDirs(CONTENT)

  // Without this the test goes green on a moved or empty content tree, which is precisely the
  // silence it exists to break.
  assert.ok(
    dirs.length > 0,
    `no markdown found under ${relative(ROOT, CONTENT)} — the content tree moved, and this guard ` +
      `now proves nothing. Point CONTENT at where it went.`
  )

  const required = dirs.map(d => `!${relative(ROOT, d).split(sep).join(posix.sep)}/*.md`)
  const have = negations()
  const missing = required.filter(line => !have.has(line))

  assert.deepEqual(
    missing,
    [],
    `.dockerignore drops **/*.md, so these content directories never reach the image and the ` +
      `pages they feed ship empty. Add to .dockerignore:\n${missing.join('\n')}`
  )
})
