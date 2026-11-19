import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Every deploy removes the previous app container. Under docker's default json-file log
// driver the container's log is deleted with it, so anything that happened before the last
// deploy can no longer be read from logs. The app containers therefore log to the host
// journal, which keeps them across deploys under journald's own rotation. These are
// hand-written flags in two shell scripts and a compose file; this pins all three.

// `import.meta.dirname` is undefined under tsx's CJS transform; only `import.meta.url` survives.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')

/** The `docker run` invocation (continuation lines joined) whose last argument names the app image. */
function appDockerRun(script: string): string {
  const joined = script.replace(/\\\n/g, ' ')
  const runs = joined.split('\n').filter(l => /docker run -d\b/.test(l) && /"\$\{IMAGE\}"\s*(>>|$)/.test(l.trim()))
  assert.equal(runs.length, 1, 'exactly one docker run starts the app image')
  return runs[0]!
}

for (const [file, tag] of [['deploy.sh', 'noema'], ['deploy-staging.sh', 'noema-staging']] as const) {
  test(`${file} starts the app with the journald log driver, tagged ${tag}`, () => {
    const run = appDockerRun(read(file))
    assert.match(run, /--log-driver journald\b/)
    assert.match(run, new RegExp(`--log-opt tag=${tag}(\\s|$)`))
    assert.doesNotMatch(run, /--log-opt max-(size|file)=/, 'json-file options left behind')
  })
}

test('docker-compose.prod.yml logs both app services to journald', () => {
  const compose = read('docker-compose.prod.yml')
  const common = compose.slice(compose.indexOf('x-common:'), compose.indexOf('\nservices:'))
  assert.match(common, /logging:\s*\n\s+driver: journald\s*\n\s+options:\s*\n\s+tag: noema\s*\n/)
  const staging = compose.slice(compose.indexOf('\n  staging:'), compose.indexOf('\n  caddy:'))
  assert.match(staging, /logging:\s*\n\s+driver: journald\s*\n\s+options:\s*\n\s+tag: noema-staging\s*\n/)
  const bot = compose.slice(compose.indexOf('\n  bot:'), compose.indexOf('\n  staging:'))
  assert.match(bot, /<<: \*common/, 'bot inherits the common logging block')
  assert.doesNotMatch(bot, /logging:/, 'bot overrides the common logging block')
})
