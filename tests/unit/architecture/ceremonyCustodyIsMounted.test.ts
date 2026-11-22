import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

// The trusted-setup ceremony is two things kept in two places. The transcript — who
// contributed, in what order, and the hash of the key each one produced — is a database
// record, and it outlives a deploy. The keys that record names are files on the
// sequencer's disk, and `ceremonyCustodyDir()` defaults to a directory INSIDE the built
// application tree, which on a container is part of the image and is replaced with it.
//
// So a routine deploy ends a ceremony. The record goes on publishing a chain head whose
// bytes the server no longer has; every download 503s and every upload is refused for
// building on a head the server cannot produce. Nothing turns red — the container is
// healthy, the transcript is intact, and the page reads "ceremony complete" over a
// /arcanum/circuit/zkey that answers nothing. It has happened, and the finished ceremony
// on noema.art went six weeks unserved behind exactly that shape of silence.
//
// The whole defence against it is a bind mount plus the variable that points at it, and
// both are hand-written lines in a shell script and a compose file that, until this test,
// nothing checked. They are easy to drop: a service added by copying `bot:` without its
// volumes, a `docker run` reordered, a rename of one variable and not the other. The
// failure is invisible until a contributor tries to download a head that is gone.
//
// The invariant is that the two lines AGREE, in each file: whatever starts the production
// app must both set CEREMONY_ZKEY_DIR and bind-mount a host directory at precisely that
// path, and the two files must name the same path as each other. A variable pointing at
// an unmounted directory is the in-image default wearing a different name, and a mount
// under a path nothing reads is custody nobody keeps.

// `import.meta.dirname` is undefined here: `test:hermetic` runs this file through tsx's
// CJS transform, where only `import.meta.url` survives.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * Expand `${NAME}` and `${NAME:-default}` against a table of assignments. Both files
 * reach the custody path through a variable, so a check on the literal text would pass on
 * a line that resolves somewhere else entirely — which is the only mistake worth catching.
 */
function expand(value: string, vars: Map<string, string>): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_m, name, fallback) =>
    vars.get(name) ?? fallback ?? '')
}

/** `NAME="value"` assignments at the top level of a shell script, resolved in order. */
function shellVars(script: string): Map<string, string> {
  const vars = new Map<string, string>()
  for (const line of script.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)="([^"]*)"$/.exec(line.trim())
    if (!m) continue
    // A self-referential default (`FOO="${FOO:-x}"`) must not read the name being
    // assigned, or every override would resolve to its own previous value.
    const prior = new Map(vars)
    prior.delete(m[1])
    vars.set(m[1], expand(m[2], prior))
  }
  return vars
}

/** The backslash-continued command containing `needle`, joined into one string. */
function continuedBlock(script: string, needle: string): string | null {
  const lines = script.split('\n')
  const at = lines.findIndex(l => l.includes(needle))
  if (at < 0) return null
  let start = at
  while (start > 0 && lines[start - 1].trimEnd().endsWith('\\')) start--
  let end = at
  while (end < lines.length - 1 && lines[end].trimEnd().endsWith('\\')) end++
  return lines.slice(start, end + 1).join('\n')
}

test('deploy.sh mounts the ceremony custody it points CEREMONY_ZKEY_DIR at', () => {
  const script = readFileSync(join(ROOT, 'deploy.sh'), 'utf8')
  const vars = shellVars(script)

  const run = continuedBlock(script, '--env CEREMONY_ZKEY_DIR=')
  assert.ok(
    run,
    'deploy.sh starts the app container without setting CEREMONY_ZKEY_DIR, so the sequencer ' +
      'keeps its trusted-setup keys inside the image and the next deploy destroys them. Add ' +
      '--env CEREMONY_ZKEY_DIR="${CEREMONY_DIR_IN_CONTAINER}" to the docker run.'
  )

  const declared = /--env CEREMONY_ZKEY_DIR="?([^"\s\\]+)"?/.exec(run!)
  assert.ok(declared, `could not read the CEREMONY_ZKEY_DIR value out of:\n${run}`)
  const custody = expand(declared![1], vars)
  assert.ok(custody.startsWith('/'), `CEREMONY_ZKEY_DIR resolved to ${JSON.stringify(custody)}, not a path`)

  const mounted = [...run!.matchAll(/-v "?([^"\s\\]+)"?/g)]
    .map(m => expand(m[1], vars))
    .filter(v => v.split(':')[1] === custody)

  assert.deepEqual(
    mounted.length > 0 ? [] : [custody],
    [],
    `deploy.sh sets CEREMONY_ZKEY_DIR=${custody} but bind-mounts nothing there, so ceremony ` +
      `custody lives in the container and a deploy ends the ceremony. Add ` +
      `-v "\${CEREMONY_DIR}:${custody}" to the same docker run.`
  )
})

/** The lines of one top-level compose service, by name. */
function composeService(compose: string, name: string): string[] {
  const lines = compose.split('\n')
  const at = lines.findIndex(l => l === `  ${name}:`)
  if (at < 0) return []
  const end = lines.findIndex((l, i) => i > at && /^  \S/.test(l))
  return lines.slice(at + 1, end < 0 ? lines.length : end)
}

test('docker-compose.prod.yml mounts the ceremony custody, at the path deploy.sh uses', () => {
  const compose = readFileSync(join(ROOT, 'docker-compose.prod.yml'), 'utf8')
  const bot = composeService(compose, 'bot')
  assert.ok(
    bot.length > 0,
    'docker-compose.prod.yml has no `bot:` service — the production app was renamed and this ' +
      'guard now proves nothing. Point it at whatever starts the sequencer.'
  )

  const entries = bot.map(l => l.trim()).filter(l => l.startsWith('- ')).map(l => expand(l.slice(2), new Map()))

  const declared = entries.find(e => e.startsWith('CEREMONY_ZKEY_DIR='))
  assert.ok(
    declared,
    'the bot service does not set CEREMONY_ZKEY_DIR, so it keeps the trusted-setup keys inside ' +
      'the image: `docker compose up` would hand the sequencer an empty custody under a ' +
      'transcript that still names every key it lost.'
  )
  const custody = declared!.slice('CEREMONY_ZKEY_DIR='.length)

  assert.ok(
    entries.some(e => e.split(':')[1] === custody),
    `the bot service sets CEREMONY_ZKEY_DIR=${custody} and mounts nothing there. Add a volume ` +
      `\${CEREMONY_DIR:-/opt/noema/ceremony}:${custody}.`
  )

  // deploy.sh and this file both start the same container against the same host state; a
  // box deployed one way and restarted the other must find its custody where it left it.
  // When deploy.sh names no path at all the test above says so in its own words, and
  // repeating it here as a mismatch would only bury it.
  const script = readFileSync(join(ROOT, 'deploy.sh'), 'utf8')
  const run = continuedBlock(script, '--env CEREMONY_ZKEY_DIR=')
  const declaredInDeploy = run && /--env CEREMONY_ZKEY_DIR="?([^"\s\\]+)"?/.exec(run)
  if (!declaredInDeploy) return

  assert.equal(
    custody,
    expand(declaredInDeploy[1], shellVars(script)),
    'docker-compose.prod.yml and deploy.sh point ceremony custody at different paths, so which ' +
      'keys the sequencer can find depends on which one last started it.'
  )
})

// The two tests above read the two files a deploy is written in, and between them that is
// every path by which custody is *configured*. It is not every path by which custody moves.
// The production `docker run` also carries --env-file, and a CEREMONY_ZKEY_DIR line in that
// file repoints custody with the mount still in place and both tests above still green —
// custody back inside the image under a variable that looks deliberate. `.env-example`
// recommended exactly that path for as long as the mount has existed.
//
// So deploy.sh refuses it, and this runs that refusal rather than reading it: the guard's own
// text is lifted out of the script and executed, because a test that greps for a guard proves
// the guard is present and nothing about what it does.

/** A shell function's text, from `name() {` to the `}` in column 0 that closes it. */
function shellFunction(script: string, name: string): string | null {
  const lines = script.split('\n')
  const at = lines.findIndex(l => l.startsWith(`${name}() {`))
  if (at < 0) return null
  const end = lines.findIndex((l, i) => i > at && l === '}')
  return end < 0 ? null : lines.slice(at, end + 1).join('\n')
}

/** deploy.sh's own in-container custody path, so this test cannot drift from the script. */
function custodyPathInDeploy(script: string): string {
  const run = continuedBlock(script, '--env CEREMONY_ZKEY_DIR=')
  const declared = run && /--env CEREMONY_ZKEY_DIR="?([^"\s\\]+)"?/.exec(run)
  assert.ok(declared, 'deploy.sh sets no CEREMONY_ZKEY_DIR on its docker run')
  return expand(declared![1], shellVars(script))
}

/** Run deploy.sh's preflight against an `.env`, or against no `.env` at all when null. */
function runCustodyGuard(envFileBody: string | null): { status: number, out: string } {
  const script = readFileSync(join(ROOT, 'deploy.sh'), 'utf8')
  const fn = shellFunction(script, 'assert_custody_not_repointed')
  assert.ok(
    fn,
    'deploy.sh has no assert_custody_not_repointed — a .env line can move ceremony custody ' +
      'back inside the image, and the next deploy ends the ceremony with every file this ' +
      'test reads unchanged.'
  )

  const dir = mkdtempSync(join(tmpdir(), 'ceremony-custody-'))
  const envFile = join(dir, '.env')
  if (envFileBody !== null) writeFileSync(envFile, envFileBody)

  const r = spawnSync('bash', ['-c', [
    'set -euo pipefail',
    `ENV_FILE=${JSON.stringify(envFile)}`,
    `CEREMONY_DIR_IN_CONTAINER=${JSON.stringify(custodyPathInDeploy(script))}`,
    `log() { printf '%s\\n' "$1"; }`,
    fn!,
    'assert_custody_not_repointed',
  ].join('\n')], { encoding: 'utf8' })

  rmSync(dir, { recursive: true, force: true })
  return { status: r.status ?? -1, out: `${r.stdout}${r.stderr}` }
}

test('deploy.sh lets a box whose .env leaves ceremony custody alone deploy', () => {
  const mounted = custodyPathInDeploy(readFileSync(join(ROOT, 'deploy.sh'), 'utf8'))
  for (const [what, body] of [
    ['no .env file at all', null],
    ['an .env that says nothing about custody', 'BOT_TOKEN=x\nMONGO_PASS=y\n'],
    ['an .env naming the mounted path', `BOT_TOKEN=x\nCEREMONY_ZKEY_DIR=${mounted}\n`],
    ['a commented-out line, as .env-example ships it', '# CEREMONY_ZKEY_DIR=/usr/src/app/storage/ceremony\n'],
  ] as [string, string | null][]) {
    const r = runCustodyGuard(body)
    assert.equal(r.status, 0, `deploy.sh refused to deploy with ${what}:\n${r.out}`)
  }
})

test('deploy.sh refuses a box whose .env moves ceremony custody off the mount', () => {
  // The path .env-example used to recommend, which is inside the image.
  const r = runCustodyGuard('BOT_TOKEN=x\nCEREMONY_ZKEY_DIR=/usr/src/app/storage/ceremony\n')
  assert.notEqual(
    r.status, 0,
    'deploy.sh deployed a box whose .env points ceremony custody inside the image. The mount ' +
      'is still there and unused; the next deploy takes the trusted-setup keys with it.'
  )
  assert.match(r.out, /\/usr\/src\/app\/storage\/ceremony/,
    `the refusal does not name the path that caused it:\n${r.out}`)
  assert.match(r.out, /CEREMONY_ZKEY_DIR/, `the refusal does not name the variable:\n${r.out}`)

  // `CEREMONY_ZKEY_DIR=` is not "unset" to docker — it is the empty string, which
  // ceremonyCustodyDir() passes through (`??` catches null, not ''), leaving custody at no
  // path at all. A bare `CEREMONY_ZKEY_DIR` takes whatever the host exports.
  for (const line of ['CEREMONY_ZKEY_DIR=', 'CEREMONY_ZKEY_DIR']) {
    const empty = runCustodyGuard(`${line}\n`)
    assert.notEqual(empty.status, 0,
      `deploy.sh accepted \`${line}\` in .env, which does not resolve to the mount:\n${empty.out}`)
  }
})
