import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// ModelImporter.import()'s docstring sits on the CSAM-gate method. noema-192 (#288) made a scan
// non-pass non-fatal — the import proceeds and previews stay origin-referenced instead of being
// refused — but the docstring kept describing the earlier fail-closed-then-throw behaviour. A
// comment claiming fail-closed / refusal on this exact method misleads the reader who is checking
// whether the gate is safe.

const MODEL_IMPORTER_PATH = path.join(process.cwd(), 'src/crystal/ModelImporter.ts')

// The phrases under test span multiple `*`-prefixed comment lines, so a naive `includes` on the
// raw file text cannot match them. Strip each line's leading `\s*\*\s?` and join with single
// spaces before matching.
function normalizeComment(src: string): string {
  return src
    .split('\n')
    .map(line => line.replace(/^\s*\*\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
}

test('ModelImporter.import() docstring does not claim the pre-noema-192 fail-closed re-host sequence', () => {
  const normalized = normalizeComment(readFileSync(MODEL_IMPORTER_PATH, 'utf8'))

  assert.ok(
    !normalized.includes('CSAM-scans any preview media (fail-closed) then re-hosts it'),
    'ModelImporter.ts import() docstring still claims the scan is fail-closed and unconditionally ' +
      're-hosts previews — noema-192 made the re-host conditional on the verdict (pass re-hosts, ' +
      'non-pass leaves previews origin-referenced); this docstring sits on the CSAM-gate method and ' +
      'must describe the current behaviour',
  )
})

test('ModelImporter.import() docstring does not claim a refused import on scan non-pass', () => {
  const normalized = normalizeComment(readFileSync(MODEL_IMPORTER_PATH, 'utf8'))

  assert.ok(
    !normalized.includes('Throws `ModelImportError` on a refused import'),
    'ModelImporter.ts import() docstring still claims a refused import throws ModelImportError — ' +
      'since noema-192 a scan non-pass does not refuse the import (only a missing owner identity or ' +
      'an unresolvable URL does); this docstring sits on the CSAM-gate method and a false refusal ' +
      'claim misleads the reader checking whether the gate is safe',
  )
})

test('ModelImporter.import() docstring states the non-fatal scan rule', () => {
  const normalized = normalizeComment(readFileSync(MODEL_IMPORTER_PATH, 'utf8'))

  assert.ok(
    normalized.includes('does not refuse the import'),
    'ModelImporter.ts import() docstring should state that a scan non-pass does not refuse the ' +
      'import (noema-192) — this is the load-bearing correction on the CSAM-gate method',
  )
})
