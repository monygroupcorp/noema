import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CANONICAL_ESSENTIAE } from '../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_FUNDAMENTA } from '../../../src/crystal/seeds/fundamenta.js'

// LoRA compatibility is DIRECTED (`Fundamentum.acceptsFamiliae`): a substrate can consume LoRAs
// trained for a neighbouring familia without that familia consuming its own in return. Because the
// relation is declared rather than derived, a new LoRA-capable flow that declares nothing is silently
// UNDER-inclusive — it resolves only its own derived familia. This guard makes that omission loud:
// every fundament reachable from a loraCapable flow must either declare `acceptsFamiliae` or appear
// in EXEMPT below with a written reason.
//
// The walk is not one hop. `loraCapable` lives on the workflow-template JSON while `acceptsFamiliae`
// lives on the Fundamentum, and several flows share one fundament — so the chain is
// essentia → workflowTemplate JSON → loraCapable, then essentia.fundamentumId → fundament.

const WORKFLOWS_DIR = path.join(process.cwd(), 'src', 'crystal', 'workflows')

/**
 * Fundamenta reachable from a loraCapable flow that intentionally accept ONLY their own derived
 * familia. Each entry states why. Removing a fundament's entry without adding a declaration (or the
 * reverse) fails this suite.
 */
const EXEMPT: Record<string, string> = {
  'flux-comfyui':
    'Native flux only. The directed rule runs the other way: a flux stack does not consume LoRAs ' +
    'trained for the Kontext edit stack.',
  'sd15-comfyui': 'Native sd15 only. No cross-familia acceptance ruling exists for sd15.',
  'sdxl-comfyui':
    'Native sdxl only. The sdxl-derived checkpoints all carry the sdxl familia, so there is no ' +
    'separate familia to accept and no directional rule to encode.',
  'chroma-comfyui': 'Native chroma only. No cross-familia acceptance ruling exists for chroma.',
  'z-image-turbo-comfyui':
    'Native zimage only — its own LoRA-compat key; flux and sdxl LoRAs do not apply.',
  'krea-turbo-comfyui': 'Native krea2 only. No cross-familia acceptance ruling exists for krea2.',
  'flux2-klein-4b-comfyui':
    'Native flux2 only. FLUX.2 is a separate architecture from FLUX.1; no acceptance across the two ' +
    'has been established.',
  'minimax-h3-comfyui':
    'Native minimax-h3 only. H3 is a video+audio DiT with its own text encoder; no image-model ' +
    'familia has a LoRA that could apply to it, and the fl2va/ref2va checkpoints share the one ' +
    'familia, so there is no second family to accept and no direction to encode. The baked 4-step ' +
    'turbo LoRAs deliberately carry NO familia — they are manifest weights, not rail-selectable.',
}

function loadTemplate(templateId: string, version: string): { loraCapable?: boolean } {
  const file = path.join(WORKFLOWS_DIR, `${templateId}-v${version}.json`)
  return JSON.parse(readFileSync(file, 'utf8')) as { loraCapable?: boolean }
}

/** Fundament ids reachable from a seeded flow whose workflow template is loraCapable. */
function loraCapableFundamentumIds(): string[] {
  const ids = new Set<string>()
  for (const essentia of CANONICAL_ESSENTIAE) {
    if (!essentia.workflowTemplate) continue
    const template = loadTemplate(essentia.workflowTemplate, essentia.workflowTemplateVersion ?? '1')
    if (!template.loraCapable) continue
    assert.ok(
      essentia.fundamentumId,
      `loraCapable flow ${essentia.id} declares no fundamentumId`,
    )
    ids.add(essentia.fundamentumId)
  }
  return Array.from(ids).sort()
}

test('the walk finds loraCapable flows at all (guard is not vacuous)', () => {
  const ids = loraCapableFundamentumIds()
  assert.ok(ids.length > 0, 'no loraCapable flow resolved — the essentia → template walk is broken')
})

test('every loraCapable flow fundament declares acceptsFamiliae or is exempt with a reason', () => {
  const undeclared: string[] = []
  for (const id of loraCapableFundamentumIds()) {
    const fundamentum = CANONICAL_FUNDAMENTA.find(f => f.id === id)
    assert.ok(fundamentum, `loraCapable flow points at unknown fundament ${id}`)
    if (fundamentum.acceptsFamiliae !== undefined) continue
    if (EXEMPT[id] !== undefined) {
      assert.ok(EXEMPT[id].trim().length > 20, `exemption for ${id} needs a written reason`)
      continue
    }
    undeclared.push(id)
  }
  assert.deepEqual(
    undeclared,
    [],
    'each fundament above is reachable from a loraCapable flow and neither declares ' +
      'acceptsFamiliae nor is listed in EXEMPT. Decide which LoRA familiae the flow consumes: ' +
      'declare the set on the Fundamentum, or add an EXEMPT entry stating that it takes only its own.',
  )
})

test('a declared acceptsFamiliae is a non-empty set of familia strings', () => {
  for (const fundamentum of CANONICAL_FUNDAMENTA) {
    const accepted = fundamentum.acceptsFamiliae
    if (accepted === undefined) continue
    assert.ok(Array.isArray(accepted) && accepted.length > 0, `${fundamentum.id}: acceptsFamiliae must be non-empty`)
    for (const familia of accepted) {
      assert.equal(typeof familia, 'string', `${fundamentum.id}: familia entries are strings`)
      assert.ok(familia.length > 0, `${fundamentum.id}: no empty familia string`)
    }
    assert.equal(new Set(accepted).size, accepted.length, `${fundamentum.id}: no duplicate familia`)
  }
})

test('no EXEMPT entry is stale', () => {
  const reachable = new Set(loraCapableFundamentumIds())
  const declared = new Set(
    CANONICAL_FUNDAMENTA.filter(f => f.acceptsFamiliae !== undefined).map(f => f.id),
  )
  const stale = Object.keys(EXEMPT).filter(id => !reachable.has(id) || declared.has(id)).sort()
  assert.deepEqual(
    stale,
    [],
    'these EXEMPT entries no longer describe a loraCapable-but-undeclared fundament — drop them so ' +
      'the exemption list keeps meaning what it says',
  )
})
