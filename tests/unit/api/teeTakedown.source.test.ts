// Source-text assertion, not a route test: `src/index.ts` only mounts routes inside `main()`,
// behind `await mongo.connect()`, and nothing in the test suite imports `src/index.ts` directly —
// exercising this over real HTTP would need either a live Mongo or a structural extraction of the
// route table, both bigger than the change this guards. Instead this reads the source file and
// asserts no static mount serves `tee/browser`. The pattern matches robustly (the `'/tee'` mount
// call, or the `tee/browser` path join) rather than pinning one exact byte string, so it survives
// incidental reformatting while still catching the mount coming back.
//
// This is NOT a substitute for the real check: the actual verification is a post-deploy probe of
// the live route (`curl https://noema.art/tee/` must not serve the console). This test only pins
// that the source no longer wires the mount.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const indexSource = fs.readFileSync(path.join(__dirname, '../../../src/index.ts'), 'utf8')

test('no static mount serves tee/browser', () => {
  const mountsTeeRoute = /app\.use\(\s*['"]\/tee['"]/.test(indexSource)
  const servesTeeBrowserDir = /['"]tee['"]\s*,\s*['"]browser['"]/.test(indexSource)
  assert.equal(mountsTeeRoute, false, "found an app.use('/tee', ...) mount in src/index.ts")
  assert.equal(servesTeeBrowserDir, false, "found a path.join(..., 'tee', 'browser', ...) reference in src/index.ts")
})
