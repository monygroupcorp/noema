import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  loadUpstreamCatalog, runnableToday, upstreamTemplateTable, weightKey, weightKeyOfPath,
} from '../../../src/crystal/upstreamTemplates.js'
import type { Intella } from '../../../src/types/intelligendi.js'

// The pinned Comfy-Org catalogue, and crystal's claim on it. Hermetic: the catalogue is committed,
// the registry is a seed file, and the join between them is arithmetic. Nothing here reaches the
// network — `upstream-templates.ts diff` is what asks upstream anything, and it is a duty, not a test.
const WORKFLOWS = path.join(process.cwd(), 'src', 'crystal', 'workflows')

test('the pin names a repo and a full commit sha', () => {
  const c = loadUpstreamCatalog()
  assert.match(c.commit, /^[0-9a-f]{40}$/, 'commit is a full sha')
  assert.equal(c.repo, 'https://github.com/Comfy-Org/workflow_templates')
  assert.ok(c.templates.length > 100, `expected a real catalogue, got ${c.templates.length} templates`)
})

test('every catalogue entry carries a name, a category and a kind', () => {
  for (const t of loadUpstreamCatalog().templates) {
    assert.ok(t.name, 'template has a name')
    assert.ok(t.category, `${t.name} has a category`)
    assert.ok(['local', 'hybrid', 'api', 'weightless'].includes(t.kind), `${t.name} kind=${t.kind}`)
    // Only a `local` or `hybrid` template downloads weights; the other two are defined by not doing so.
    if (t.kind === 'api' || t.kind === 'weightless') {
      assert.equal(t.models.length, 0, `${t.name} is ${t.kind} but declares weights`)
    } else {
      assert.ok(t.models.length > 0, `${t.name} is ${t.kind} but declares no weights`)
    }
    for (const m of t.models) assert.match(m.url, /^https:\/\//, `${t.name}: ${m.name} has a url`)
  }
})

test('a weight is identified by directory CLASS, so unet and diffusion_models are one place', () => {
  assert.equal(weightKey('unet', 'a.safetensors'), weightKey('diffusion_models', 'a.safetensors'))
  assert.equal(weightKeyOfPath('clip/t5.safetensors'), weightKeyOfPath('text_encoders/t5.safetensors'))
  assert.notEqual(weightKeyOfPath('vae/a.safetensors'), weightKeyOfPath('loras/a.safetensors'))
})

test('coverage is n/a for everything the pod cannot run, and a real verdict for what it can', () => {
  for (const r of upstreamTemplateTable()) {
    if (r.kind === 'local') {
      assert.ok(['all', 'partial', 'none'].includes(r.coverage), `${r.name} coverage=${r.coverage}`)
    } else {
      assert.equal(r.coverage, 'n/a', `${r.name} is ${r.kind} and must not read as runnable`)
    }
  }
})

test('a template covered by the registry names an Intella for every weight it needs', () => {
  for (const r of runnableToday()) {
    for (const m of r.models) {
      assert.notEqual(m.match, 'none', `${r.name} reads as covered but ${m.name} matched nothing`)
      assert.ok(m.intellaId, `${r.name}: ${m.name} matched without naming an Intella`)
    }
  }
})

test('coverage answers to the registry it is given, not to a baked list', () => {
  const only: Intella[] = [{
    id: 'intella.test-only', nomen: 'test', license: 'apache-2.0', commercialUse: 'yes',
    genus: 'model', architectura: 'dit', parametri: 1, sources: [],
    dest: 'unet/z_image_turbo_bf16.safetensors', sizeGb: 1, versio: '1.0.0',
    canonica: true, natum: new Date('2026-01-01'),
  }]
  const rows = upstreamTemplateTable({ intellae: only })
  const z = rows.find(r => r.name === 'image_z_image_turbo')
  assert.ok(z, 'the z-image turbo template is in the pin')
  assert.equal(z.coverage, 'partial', 'one weight of three held reads as partial')
  assert.equal(z.models.find(m => m.name === 'z_image_turbo_bf16.safetensors')?.match, 'path')
})

// ── crystal's side of the join ───────────────────────────────────────────────

const files = readdirSync(WORKFLOWS).filter(f => f.endsWith('.json'))
const catalogNames = new Set(loadUpstreamCatalog().templates.map(t => t.name))

for (const file of files) {
  test(`workflow ${file} records where it stands against upstream`, () => {
    const t = JSON.parse(readFileSync(path.join(WORKFLOWS, file), 'utf8')) as {
      upstream?: { template: string | null; note?: string }
    }
    assert.ok(t.upstream, `${file} declares no 'upstream' — name the template it comes from, or null with a note`)
    if (t.upstream.template === null) {
      assert.ok(t.upstream.note, `${file} claims no upstream counterpart but does not say why`)
    } else {
      assert.ok(
        catalogNames.has(t.upstream.template),
        `${file} names upstream template '${t.upstream.template}', which is not in the pinned catalogue`,
      )
    }
  })
}

test('no draft workflows remain — a graph is shipped or it is gone', () => {
  const stray = readdirSync(WORKFLOWS).filter(f => f.includes('.draft.') || f === 'drafts')
  assert.deepEqual(stray, [], `drafts came back: ${stray.join(', ')}`)
})
