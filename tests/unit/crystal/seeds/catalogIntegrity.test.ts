import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { CANONICAL_ESSENTIAE } from '../../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_FUNDAMENTA } from '../../../../src/crystal/seeds/fundamenta.js'
import { CANONICAL_INTELLAE } from '../../../../src/crystal/seeds/intellae.js'

// Hermetic catalog integrity: the references BETWEEN the three seed files resolve. Each file is
// well-formed on its own by construction (TypeScript), but nothing checked that an Essentia's
// fundamentumId names a real substrate, or that a weight manifest names a registered Intella —
// both are plain strings, and both fail at provision time on a real pod if they are wrong.
const WORKFLOWS = path.join(process.cwd(), 'src', 'crystal', 'workflows')

const files = readdirSync(WORKFLOWS).filter(f => f.endsWith('.json'))

const intellaIds = new Set(CANONICAL_INTELLAE.map(i => i.id))
const intellaeById = new Map(CANONICAL_INTELLAE.map(i => [i.id, i]))
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

test('ref2v does not inherit fl2va lengths (they are different checkpoints)', () => {
  // 209 frames runs on fl2va — t2v and fl2v both use it — and fails inside ComfyUI on ref2va
  // with a tensor shape error, after the pod, the weights and the model load are all paid for.
  // Verified on prod: ref2v completes at 124 and fails at 209. This pins the default so a future
  // tidy-up does not "unify" the three flows' geometry back into one number.
  const byId = new Map(CANONICAL_ESSENTIAE.map(e => [e.id, e]))
  const ref2v = byId.get('minimax-h3-ref2v')
  const fl2v = byId.get('minimax-h3-fl2v')
  assert.ok(ref2v && fl2v)
  assert.equal(ref2v.aditus.frames?.default, 124, 'ref2v defaults to the length proven on ref2va')
  assert.notEqual(
    ref2v.aditus.frames?.default, fl2v.aditus.frames?.default,
    'the two checkpoints do not accept the same lengths — a shared default is the bug this pins',
  )
  // No maximum: the real ceiling is somewhere in (124, 209] and nobody has bisected it.
  // Guessing one would refuse lengths that may work.
  assert.equal((ref2v.aditus.frames as { max?: number }).max, undefined)
})

test("a slot-mapped knob's baked graph value is its declared default", () => {
  // The slot map only writes a value the CALLER supplied: `_applySlotMap` skips an undefined
  // input, so an omitted optional knob runs at whatever the template JSON bakes into the graph,
  // NOT at the `Porta.default` the schema advertises. The two are the same number or they are a
  // lie — and on ref2v they diverged into a run that fails after the pod, the 56 GB weight pull
  // and the model load are all paid for: the seed said 124, the graph still said 209.
  //
  // Every knob, not just that one — the seam is generic, and this is the only thing standing
  // between a corrected default and a graph that quietly ignores it. The seed port is the
  // authority; a template that disagrees is the bug.
  const SEED_EXEMPT = (e: { seedInputKey?: string }, key: string) => key === (e.seedInputKey ?? 'input_seed')
  const KNOBS = new Set(['int', 'float'])
  for (const e of CANONICAL_ESSENTIAE) {
    if (!e.workflowTemplate) continue
    const file = path.join(WORKFLOWS, `${e.workflowTemplate}-v${e.workflowTemplateVersion ?? '1'}.json`)
    if (!existsSync(file)) continue
    const t = JSON.parse(readFileSync(file, 'utf8')) as {
      inputTemplate: Record<string, unknown>
      slotMap: Record<string, string>
    }
    for (const [pointer, key] of Object.entries(t.slotMap ?? {})) {
      const porta = e.aditus[key]
      // A seed is resolved for every run (`_resolveSeed`), so its slot is never left baked.
      if (!porta || !KNOBS.has(porta.type) || porta.default === undefined || SEED_EXEMPT(e, key)) continue
      let node: unknown = t.inputTemplate
      for (const seg of pointer.slice(1).split('/')) node = (node as Record<string, unknown>)?.[seg]
      assert.equal(node, porta.default,
        `'${e.id}' declares ${key}=${porta.default} but ${e.workflowTemplate} bakes ${JSON.stringify(node)} at ${pointer} — an omitted ${key} would run at the baked value`)
    }
  }
})

test("a manifest's download url is one the registry actually knows for that weight", () => {
  // A template's `requiredModels[].url` reads like the address the pod will fetch from. It is
  // not: `Compiler._resolveModels` looks the id up in the registry and, when the record carries
  // any source at all, OVERWRITES both url and dest with `sources[0].uri` / `dest`. So the
  // manifest entry is a fallback for an UNREGISTERED id, and for a registered one it is
  // documentation — documentation that is either true or a lie about what the pod will pull.
  //
  // The lie is expensive and silent: the pod provisions, pulls every other weight, and dies at
  // wget on the one address nobody could see was wrong, because the file beside the graph named
  // the right one. Pinned here because the two drifted apart in exactly that direction — a sweep
  // rewrote the registry's HuggingFace paths and left every manifest saying the old thing.
  //
  // Membership, not equality against `sources[0]`: a weight legitimately carries a mirror first
  // and a HuggingFace fallback second, and a manifest naming either of them is telling the truth
  // about where that weight lives. An id with no record is skipped — there the manifest url IS
  // the address, which is the fallback path this rule does not govern.
  for (const file of files) {
    const t = JSON.parse(readFileSync(path.join(WORKFLOWS, file), 'utf8')) as {
      requiredModels?: Array<{ id?: string; url?: string }>
    }
    for (const m of t.requiredModels ?? []) {
      if (!m.id || !m.url) continue
      const record = intellaeById.get(m.id)
      if (!record) continue
      const known = (record.sources ?? []).map(s => s.uri)
      assert.ok(known.includes(m.url),
        `${file} says '${m.id}' downloads from ${m.url}, but the registry — which wins at compile time — knows only ${known.join(', ')}`)
    }
  }
})
