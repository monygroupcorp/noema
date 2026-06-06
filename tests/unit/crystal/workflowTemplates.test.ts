import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// Hermetic acceptance for every ComfyUI workflow template in src/crystal/workflows/. This is what
// makes "add a flow" agent-verifiable WITHOUT a real pod: an agent's new template JSON must pass
// these structural checks. (ComfyUI-graph *correctness* still needs a real-pod run — staging.)
const DIR = path.join(process.cwd(), 'src', 'crystal', 'workflows')
const files = readdirSync(DIR).filter(f => f.endsWith('.json'))

test('there is at least one workflow template', () => {
  assert.ok(files.length > 0, 'expected workflow templates in src/crystal/workflows/')
})

for (const file of files) {
  test(`workflow template ${file} is well-formed`, () => {
    const t = JSON.parse(readFileSync(path.join(DIR, file), 'utf8')) as {
      templateId: string; version: string
      inputTemplate: Record<string, unknown>
      slotMap: Record<string, string>
      requiredModels: Array<{ role?: string; id?: string; url?: string; dest?: string }>
    }

    // filename === <templateId>-v<version>.json (the registry resolves by this convention)
    assert.equal(file, `${t.templateId}-v${t.version}.json`, 'filename must match templateId-vVersion')
    assert.ok(t.inputTemplate && typeof t.inputTemplate === 'object', 'has inputTemplate (the ComfyUI graph)')
    assert.ok(t.slotMap && typeof t.slotMap === 'object', 'has slotMap')
    assert.ok(Array.isArray(t.requiredModels), 'has requiredModels[]')

    // every requiredModel declares role + id + dest (url is optional — a present model needs no URL)
    for (const m of t.requiredModels) {
      assert.ok(m.role && m.id && m.dest, `requiredModel needs role+id+dest: ${JSON.stringify(m)}`)
    }

    // every slotMap pointer is a JSON pointer that resolves to a real path in inputTemplate
    for (const pointer of Object.keys(t.slotMap)) {
      assert.ok(pointer.startsWith('/'), `slot pointer must be a JSON pointer (got '${pointer}')`)
      const segs = pointer.slice(1).split('/')
      let node: unknown = t.inputTemplate
      for (const seg of segs) {
        assert.ok(
          node && typeof node === 'object' && seg in (node as Record<string, unknown>),
          `slot pointer ${pointer} does not resolve in ${file} (missing segment '${seg}')`,
        )
        node = (node as Record<string, unknown>)[seg]
      }
    }
  })
}
