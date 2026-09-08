import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// `npm run guard:site-truth` holds the published marketing pages to what `/v1` and the seeds
// actually carry. A guard like that fails silently in the worst way: if its regexes stop matching
// it goes green over a site full of invented product, and nothing says so.
//
// So this drives the shipped script against fabricated copy in a temp directory (`--app`), and
// asserts both directions per rule — the false claim is caught, the true one is not. The contract
// and the seeds always come from THIS repository, so a passing fixture is evidence the guard read
// the real surface and found the real thing, not evidence that its comparison set was empty.

// `import.meta.dirname` is undefined here: `test:hermetic` runs this file through tsx's CJS
// transform, where only `import.meta.url` survives. It read as undefined, `join` threw at import
// time, and the whole file counted as ONE failing test — so the guard this exists to prove was
// never run by the suite that is supposed to prove it, and the suite was red for saying so.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** Copy for the five surfaces; anything omitted gets harmless filler. */
type Site = { about?: string; features?: string; guide?: string; pricing?: string; footer?: string }

function guardOn(site: Site): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'site-truth-'))
  try {
    mkdirSync(join(dir, 'content', 'blog'), { recursive: true })
    mkdirSync(join(dir, 'screens'), { recursive: true })
    writeFileSync(join(dir, 'content', 'about.md'), site.about ?? '# About\n')
    writeFileSync(join(dir, 'content', 'features.md'), site.features ?? '# Features\n')
    writeFileSync(join(dir, 'content', 'blog', 'guide.md'), site.guide ?? '# Guide\n')
    writeFileSync(join(dir, 'screens', 'Pricing.tsx'), site.pricing ?? 'export function Pricing() { return null }\n')
    writeFileSync(join(dir, 'screens', 'SiteFooter.tsx'), site.footer ?? 'export function SiteFooter() { return null }\n')
    const r = spawnSync('node', ['scripts/guard-site-truth.mjs', '--app', dir], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the site as it stands names nothing the system does not have', () => {
  const r = spawnSync('node', ['scripts/guard-site-truth.mjs'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
})

test('an endpoint the contract does not serve is caught, one it does is not', () => {
  const invented = guardOn({ guide: 'Swap your base URL and call `POST /v1/chat/completions`.\n' })
  assert.equal(invented.code, 1, invented.out)
  assert.match(invented.out, /\/v1\/chat\/completions/, invented.out)

  const real = guardOn({ guide: 'Discover flows with `GET /v1/flows`, then `POST /v1/runs`.\n' })
  assert.equal(real.code, 0, `a path the contract serves must pass:\n${real.out}`)
})

test('a path parameter is matched however the copy spells it', () => {
  const spellings = guardOn({
    guide: 'Poll `GET /v1/runs/<id>`, stream `GET /v1/runs/{runId}/stream`, cancel `POST /v1/runs/:id/cancel`.\n',
  })
  assert.equal(spellings.code, 0, spellings.out)
})

test('an auth header no securityScheme declares is caught, a declared one is not', () => {
  const invented = guardOn({ features: 'Authenticate with a `x-noema-secret` header.\n' })
  assert.equal(invented.code, 1, invented.out)
  assert.match(invented.out, /x-noema-secret/, invented.out)

  // The header /features actually names. It was undeclared for as long as the page named it.
  const declared = guardOn({ features: 'Authenticate with a purse token in an `x-bursa-token` header.\n' })
  assert.equal(declared.code, 0, `the purse header must be declared in the contract:\n${declared.out}`)
})

test('a modality nothing runs is caught, the ones that run are not', () => {
  for (const claim of ['Every modality: text, image, video and embeddings.', 'Now with text-to-speech.']) {
    const { code, out } = guardOn({ features: claim })
    assert.equal(code, 1, `should have been caught: ${claim}\n${out}`)
  }

  const shipped = guardOn({
    features: 'Text generation, image generation, video generation, text-to-music and 3D.\n',
  })
  assert.equal(shipped.code, 0, `the shipped modalities must pass:\n${shipped.out}`)
})

test('a deletion promise erasure does not keep is caught on the widest surfaces', () => {
  const promise = guardOn({ footer: 'export const tag = "Your runs are kept for you until you erase your account."' })
  assert.equal(promise.code, 1, promise.out)
  assert.match(promise.out, /deletion/, promise.out)

  const honest = guardOn({
    footer: 'export const tag = "Run records are retained; erasing your account severs them from you rather than deleting them."',
  })
  assert.equal(honest.code, 0, honest.out)
})

test('describing run records without saying they are retained is caught', () => {
  const silent = guardOn({ about: 'We keep your runs as your own history.\n' })
  assert.equal(silent.code, 1, silent.out)
  assert.match(silent.out, /retained/, silent.out)
})

test('a screen is judged on its copy, not on the comment explaining its copy', () => {
  // The footer comment quotes the deletion promise in order to warn the next editor off it.
  const commented = guardOn({
    footer: [
      '// "Kept until you erase your account" read as a deletion promise erasure does not keep.',
      'export const tag = "Run records are retained; erasure severs them from you."',
    ].join('\n'),
  })
  assert.equal(commented.code, 0, `a comment is not published copy:\n${commented.out}`)
})

test('anonymous funding must say the depositing address is kept', () => {
  const silent = guardOn({ about: 'Fund anonymously from a shielded wallet and stay anonymous.\n' })
  assert.equal(silent.code, 1, silent.out)
  assert.match(silent.out, /depositing address/, silent.out)

  const honest = guardOn({
    about: 'Fund anonymously from a shielded wallet; the depositing address still reaches us and we keep it for sanctions screening.\n',
  })
  assert.equal(honest.code, 0, honest.out)
})
