import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Caddy had no `log` directive at all, so a visitor to noema.art/www.noema.art/app.noema.art
// who never hit the app left no record on any disk. The Caddyfile now gives every site an
// access log at /var/log/caddy/access.log, and that path must be a host bind mount (not a
// named Docker volume) in both launch paths — deploy.sh's start_caddy and
// docker-compose.prod.yml's caddy service — so the log survives a container recreate the same
// way /var/log/hyperbot already does for the app. These are hand-written flags; this pins them.

// `import.meta.dirname` is undefined under tsx's CJS transform; only `import.meta.url` survives.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8')

test('Caddyfile gives noema.art, www.noema.art and app.noema.art an access log', () => {
  const caddyfile = read('Caddyfile')
  assert.match(caddyfile, /output file \/var\/log\/caddy\/access\.log/)

  for (const block of [
    'noema.art, www.noema.art {',
    'app.noema.art {',
  ]) {
    const start = caddyfile.indexOf(block)
    assert.notEqual(start, -1, `site block "${block}" not found`)
    const end = caddyfile.indexOf('\n}', start)
    const site = caddyfile.slice(start, end)
    assert.match(site, /import access_log|log\s*{/, `${block} has no access log`)
  }
})

test("deploy.sh's start_caddy bind-mounts a host path for the access log", () => {
  const script = read('deploy.sh')
  const joined = script.replace(/\\\n/g, ' ')
  const run = joined.split('\n').find(l => /docker run -d\b/.test(l) && /"\$\{CADDY_IMAGE\}"\s*$/.test(l.trim()))
  assert.ok(run, 'no docker run starts the caddy image')
  assert.match(run!, /-v\s+"\$\{CADDY_LOG_DIR\}":\/var\/log\/caddy\b/)
  assert.match(script, /CADDY_LOG_DIR="\/var\/log\/caddy"/)
  assert.match(script, /mkdir -p[^\n]*"\$\{CADDY_LOG_DIR\}"/)
})

test('docker-compose.prod.yml bind-mounts the same host path for the caddy service', () => {
  const compose = read('docker-compose.prod.yml')
  const caddy = compose.slice(compose.indexOf('\n  caddy:'))
  assert.match(caddy, /-\s+\/var\/log\/caddy:\/var\/log\/caddy\b/)
})
