import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { CANONICAL_ESSENTIAE } from '../../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_FUNDAMENTA } from '../../../../src/crystal/seeds/fundamenta.js'
import { CANONICAL_INTELLAE } from '../../../../src/crystal/seeds/intellae.js'

// Hermetic catalog integrity: the references BETWEEN the three seed files resolve. Each file is
// well-formed on its own by construction (TypeScript), but nothing checked that an Essentia's
// fundamentumId names a real substrate, or that a weight manifest names a registered Intella —
// both are plain strings, and both fail at provision time on a real pod if they are wrong.
const WORKFLOWS = path.join(process.cwd(), 'src', 'crystal', 'workflows')

const intellaIds = new Set(CANONICAL_INTELLAE.map(i => i.id))
const fundamentaById = new Map(CANONICAL_FUNDAMENTA.map(f => [f.id, f]))

test('every Fundamentum base weight names a registered Intella', () => {
  for (const f of CANONICAL_FUNDAMENTA) {
    for (const w of f.intellae ?? []) {
      assert.ok(intellaIds.has(w.id), `fundamentum '${f.id}' names unregistered weight '${w.id}'`)
    }
  }
})

test('every Essentia resolves its Fundamentum at the pinned version', () => {
  for (const e of CANONICAL_ESSENTIAE) {
    if (!e.fundamentumId) continue
    const f = fundamentaById.get(e.fundamentumId)
    assert.ok(f, `essentia '${e.id}' names unknown fundamentum '${e.fundamentumId}'`)
    if (e.fundamentumVersio) {
      assert.equal(f.versio, e.fundamentumVersio,
        `essentia '${e.id}' pins ${e.fundamentumId}@${e.fundamentumVersio} but the seed is @${f.versio}`)
    }
  }
})

test('every Essentia extra weight names a registered Intella', () => {
  for (const e of CANONICAL_ESSENTIAE) {
    for (const w of e.intellae ?? []) {
      assert.ok(intellaIds.has(w.id), `essentia '${e.id}' names unregistered weight '${w.id}'`)
    }
  }
})

test('every Essentia workflowTemplate exists on disk', () => {
  for (const e of CANONICAL_ESSENTIAE) {
    if (!e.workflowTemplate) continue
    const file = path.join(WORKFLOWS, `${e.workflowTemplate}-v${e.workflowTemplateVersion ?? '1'}.json`)
    assert.ok(existsSync(file), `essentia '${e.id}' names missing template ${path.basename(file)}`)
  }
})

test('every template slot maps to a real aditus on the flows that use it', () => {
  for (const e of CANONICAL_ESSENTIAE) {
    if (!e.workflowTemplate) continue
    const file = path.join(WORKFLOWS, `${e.workflowTemplate}-v${e.workflowTemplateVersion ?? '1'}.json`)
    if (!existsSync(file)) continue
    const t = JSON.parse(readFileSync(file, 'utf8')) as { slotMap: Record<string, string> }
    const keys = new Set(Object.keys(e.aditus))
    for (const [pointer, aditusKey] of Object.entries(t.slotMap ?? {})) {
      assert.ok(keys.has(aditusKey),
        `template ${e.workflowTemplate} slots '${aditusKey}' (${pointer}) which '${e.id}' does not accept`)
    }
  }
})

test('every required media aditus is slot-mapped, or the pod cannot receive the file', () => {
  const MEDIA = new Set(['image', 'video', 'audio'])
  for (const e of CANONICAL_ESSENTIAE) {
    if (!e.workflowTemplate) continue
    const file = path.join(WORKFLOWS, `${e.workflowTemplate}-v${e.workflowTemplateVersion ?? '1'}.json`)
    if (!existsSync(file)) continue
    const t = JSON.parse(readFileSync(file, 'utf8')) as { slotMap: Record<string, string> }
    const slotted = new Set(Object.values(t.slotMap ?? {}))
    for (const [key, porta] of Object.entries(e.aditus)) {
      if (!MEDIA.has(porta.type) || !porta.required) continue
      assert.ok(slotted.has(key),
        `essentia '${e.id}' requires media port '${key}' but no slot maps it into the graph`)
    }
  }
})
