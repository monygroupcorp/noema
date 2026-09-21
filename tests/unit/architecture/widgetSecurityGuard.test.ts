import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// `npm run guard:widget-security` holds the embed surface to three properties: every presented
// purse token is gated, the deployed embed records its framing, and the access code never rides
// the URL. Only the first of those is a pattern over source, and a pattern is exactly the kind of
// rule that rots into a green light — reword the line it matches and it goes on passing over a
// router that admits revoked codes. That is not hypothetical: the rule's first run found
// `querelaRouter` doing precisely that, three surfaces after the gate was declared to be
// everywhere, because the earlier sweep had grepped one directory.
//
// So this drives the shipped script against fabricated source trees (`--src`), both directions per
// rule: the defect is caught, and the correct shape is not. `--offline` throughout — the live half
// asks a deployment, and the hermetic suite has no network.

// `import.meta.dirname` is undefined under tsx's CJS transform, which is how `test:hermetic` runs
// this file; only `import.meta.url` survives. See siteTruthGuard.test.ts for the same note.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** The line all four real surfaces use to read a presented token. */
const READ = `const bursaToken = req.body?.bursaToken ?? (req.headers['x-bursa-token'] as string | undefined)`

/** A resolver that reads a token and hands back an identity, with `gate` between the two. */
function router(gate: string): string {
  return `export function make(deps: Deps) {\n`
    + `  async function auth(req: Request) {\n`
    + `    ${READ}\n`
    + `    if (bursaToken) {\n`
    + `      ${gate}\n`
    + `      return { bursaToken }\n`
    + `    }\n`
    + `    return deps.identity.resolve(req)\n`
    + `  }\n`
    + `  return auth\n`
    + `}\n`
}

/** Run the guard's static half over a tree of `path → source`, plus a widgetRouter. */
function guardOn(files: Record<string, string>, widget = 'const x = 1\n'): { code: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'widget-security-'))
  try {
    mkdirSync(join(dir, 'allocutio', 'api'), { recursive: true })
    writeFileSync(join(dir, 'allocutio', 'api', 'widgetRouter.ts'), widget)
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(dir, dirname(rel)), { recursive: true })
      writeFileSync(join(dir, rel), body)
    }
    const r = spawnSync(process.execPath, [
      join(ROOT, 'scripts', 'guard-widget-security.mjs'), '--offline', '--src', dir,
    ], { encoding: 'utf8' })
    return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

/** Three gated surfaces — the minimum the blindness rule demands — so a case can add a fourth. */
const THREE_GATED = {
  'allocutio/api/apiRouter.ts': router('await admitBursaToken(deps, bursaToken)'),
  'allocutio/api/storageRouter.ts': router('await admitBursaToken(deps, bursaToken)'),
  'allocutio/api/colloquiaRouter.ts': router('refuseTerminalPurse(await deps.bursarium.findByToken(bursaToken))'),
}

// ── Rule 1: every presentation is gated ──────────────────────────────────────

test('the real source tree passes the static half', () => {
  const r = spawnSync(process.execPath, [
    join(ROOT, 'scripts', 'guard-widget-security.mjs'), '--offline',
  ], { encoding: 'utf8' })
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
})

test('a router that reads x-bursa-token and never gates it is caught', () => {
  const r = guardOn({ ...THREE_GATED, 'api/querela/querelaRouter.ts': router('') })
  assert.equal(r.code, 1)
  assert.match(r.out, /querela\/querelaRouter\.ts:\d+ reads x-bursa-token/)
})

test('either gate satisfies the rule — admitBursaToken and refuseTerminalPurse both count', () => {
  assert.equal(guardOn(THREE_GATED).code, 0)
})

test('a gate that runs only AFTER the identity is returned does not count', () => {
  // The resolver hands back `{ bursaToken }` and gates on a later line, so the caller is already
  // authenticated. The rule reads the window between the read and the return for exactly this.
  const late = `export function make(deps: Deps) {\n`
    + `  async function auth(req: Request) {\n`
    + `    ${READ}\n`
    + `    if (bursaToken) return { bursaToken }\n`
    + `    await admitBursaToken(deps, bursaToken)\n`
    + `    return deps.identity.resolve(req)\n`
    + `  }\n`
    + `  return auth\n`
    + `}\n`
  const r = guardOn({ ...THREE_GATED, 'api/late/lateRouter.ts': late })
  assert.equal(r.code, 1)
  assert.match(r.out, /lateRouter\.ts:\d+ reads x-bursa-token/)
})

test('the browser app is not scanned — it SENDS the header and gates nothing', () => {
  const r = guardOn({ ...THREE_GATED, 'platforms/web/app/src/lib/api.ts': router('') })
  assert.equal(r.code, 0, r.out)
})

test('the rule says so when the read is reworded and it has gone blind', () => {
  // Every surface renamed the header, so the pattern matches nothing. A guard that matches
  // nothing passes everything, which is the one failure it must never report as success.
  const reworded = router('await admitBursaToken(deps, bursaToken)').replace(/x-bursa-token/, 'x-purse-token')
  const r = guardOn({ 'allocutio/api/apiRouter.ts': reworded })
  assert.equal(r.code, 1)
  assert.match(r.out, /found 0 place\(s\) reading x-bursa-token, expected at least 3/)
})

// ── Rule 3 (static): the access code is not read from the URL ────────────────

test('a widget router that reads the code from the query string is caught', () => {
  const r = guardOn(THREE_GATED, `const code = req.query.code\n`)
  assert.equal(r.code, 1)
  assert.match(r.out, /widgetRouter\.ts:\d+ reads the access code from the query string/)
})

test('the bracket spelling is caught too', () => {
  const r = guardOn(THREE_GATED, `const code = req.query['code']\n`)
  assert.equal(r.code, 1)
  assert.match(r.out, /reads the access code from the query string/)
})

test('other query parameters are not the access code — the theme ones stay allowed', () => {
  const r = guardOn(THREE_GATED, `const accent = safeColor(req.query.accent)\nconst mode = req.query.mode\n`)
  assert.equal(r.code, 0, r.out)
})

test("the browser's own legacy adoption is not a server read", () => {
  // `adopt()` runs in the page: it takes a legacy ?code= out of the URL and scrubs it. That is the
  // fix, not the defect, and it lives in the inlined client script inside this same file.
  const r = guardOn(THREE_GATED, `const JS = \`var u=new URL(location.href), q=u.searchParams.get('code');\`\n`)
  assert.equal(r.code, 0, r.out)
})
