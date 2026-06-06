import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// Crystal (the ring core) is platform-neutral: it must NOT import the allocutio adapter layer.
// This guards the ring↔allocutio boundary mechanically so an agent can't recreate the drift the
// 2026-06-05 audit found (see docs/adr/0002-ring-allocutio-boundary.md).
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const p = path.join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : []
  })
}

test('crystal core does not import the allocutio adapter layer', () => {
  const crystalDir = path.join(process.cwd(), 'src', 'crystal')
  const offenders: string[] = []
  for (const file of walk(crystalDir)) {
    const src = readFileSync(file, 'utf8')
    // `import … from '…/allocutio/…'` or dynamic `import('…/allocutio/…')`
    if (/from\s+['"][^'"]*\/allocutio\//.test(src) || /import\(\s*['"][^'"]*\/allocutio\//.test(src)) {
      offenders.push(path.relative(process.cwd(), file))
    }
  }
  assert.deepEqual(offenders, [], `crystal/ must not import allocutio/ — the ring stays platform-neutral. Offenders: ${offenders.join(', ')}`)
})
