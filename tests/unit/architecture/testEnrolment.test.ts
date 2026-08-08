import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, globSync } from 'node:fs'
import path from 'node:path'

// Every test file under tests/unit/ must be reachable from one of the two CI test jobs
// (test:hermetic or test:crystal, see .github/workflows/ci.yml). A file matched by neither
// script never runs anywhere and nothing reports it. This guard expands both scripts' glob
// patterns the same way the scripts themselves are invoked and diffs that against the real
// file set, so a new orphan fails CI instead of going unnoticed.

// Allowlisted exclusions: files that are intentionally not enrolled in either script.
const ALLOWLIST = [
  // Needs artifacts a CI runner does not have; 1 pass / 1 fail locally and exceeds 60s. Stays
  // out explicitly rather than silently — see docs/plan for noema-172.
  'tests/unit/arcanum/ArcanumProver.real.test.ts',
]

function extractPatterns(scriptCmd: string): string[] {
  const re = /'([^']+)'/g
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(scriptCmd))) out.push(m[1])
  return out
}

test('every tests/unit/**/*.test.ts file is enrolled in test:hermetic or test:crystal', () => {
  const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
  const hermeticPatterns = extractPatterns(pkg.scripts['test:hermetic'])
  const crystalPatterns = extractPatterns(pkg.scripts['test:crystal'])

  const enrolled = new Set<string>()
  for (const pattern of [...hermeticPatterns, ...crystalPatterns]) {
    for (const file of globSync(pattern)) enrolled.add(file)
  }

  const allFiles = globSync('tests/unit/**/*.test.ts')
  const allowlisted = new Set(ALLOWLIST)
  const orphans = allFiles.filter(f => !enrolled.has(f) && !allowlisted.has(f)).sort()

  assert.deepEqual(
    orphans,
    [],
    `${orphans.length} test file(s) are not enrolled in test:hermetic or test:crystal and never ` +
      `run in CI: ${orphans.join(', ')}. Add each to package.json's test:hermetic script (or ` +
      `test:crystal if it needs a live Mongo), or add it to the ALLOWLIST in this file with a reason.`
  )
})
