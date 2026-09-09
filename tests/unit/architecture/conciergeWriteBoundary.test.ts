import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  CONCIERGE_WRITE_ACTIONS,
  CONCIERGE_PREFERENCE_KEYS,
  validateWriteProposal,
  validateMemoryDelta,
} from '../../../src/allocutio/api/ConciergeAgent.js'

// =============================================================================
// WRITE boundary — the author ladder, the one ruled exception to the concierge's
// read-only invariant. The exception is a GRAMMAR, not a capability: a turn may
// NAME a write, exactly as it may name a NAVIGATE destination, and the CLIENT
// performs it on the user's own GO. That distinction is what this guard holds:
//
//   (1) the validators are pure and synchronous — they reach no tool, no
//       `deps`/`api`/`ctx`, and await nothing, so nothing on this path can be
//       edited into a call that writes;
//   (2) ConciergeAgent never references the CrystalApi write methods the three
//       actions ultimately reach, so the module cannot perform its own proposal;
//   (3) the allowlist is exactly three actions wide — widening it is a doctrine
//       change, so a fourth has to be written into this guard's own list by hand
//       before it goes green again;
//   (4) `set_preference` never reaches the three gates the person clicks for
//       themselves: the adult-content pair (spicyMode / ageAttestation) and
//       privateOutputs.
//
// The read-only invariant proper — no write tool in TOOL_SPECS, no write case in
// executeTool — is held next door in conciergeReadOnly.test.ts, and stays there;
// this file guards only what the ladder ADDED.
// =============================================================================

const AGENT = path.join(process.cwd(), 'src', 'allocutio', 'api', 'ConciergeAgent.ts')

/** Strip line and block comments so the module's docblocks — which NAME these methods in order to
 *  forbid them — are not themselves read as a breach. Same treatment as conciergeReadOnly's. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** This guard's OWN confirmed list of proposable writes. Deliberately NOT sourced from the export:
 *  the test below cross-checks the export against this list, so an action ADDED to the allowlist
 *  requires a human to record it here before the guard passes again. */
const CONFIRMED_WRITE_ACTIONS = ['create_dataset', 'patch_collection_draft', 'set_preference']

/** CrystalApi methods the three actions ultimately reach. The CLIENT calls these, from the user's
 *  own session, on GO; the agent module must not name one at all. */
const WRITE_REFERENCES = ['createDataset', 'patchCollectionDraft', 'patchCollectionTractus', 'setGeneratio']

test('the write validators are pure, synchronous, and reach no deps/api/ctx', () => {
  const src = readFileSync(AGENT, 'utf8')
  for (const name of ['validateWriteProposal', 'validateMemoryDelta']) {
    const m = src.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n}\\n`))
    assert.ok(m, `${name} not found in ConciergeAgent.ts`)
    const body = m![0]
    assert.ok(!/\bawait\b/.test(body), `${name} must not await anything (no I/O)`)
    assert.ok(!/\bdeps\.|\bapi\.|\bctx\./.test(body), `${name} must not reach into deps/api/ctx`)
  }
})

test('the write validators return synchronously, never a Promise', () => {
  const w = validateWriteProposal({ action: 'set_preference', payload: { key: 'style', value: 'noir' } })
  const d = validateMemoryDelta({ add: ['works in Portuguese'] })
  assert.ok(!(w instanceof Promise), 'validateWriteProposal must not be async')
  assert.ok(!(d instanceof Promise), 'validateMemoryDelta must not be async')
})

test('ConciergeAgent references no write method of its own', () => {
  const code = stripComments(readFileSync(AGENT, 'utf8'))
  const offenders = WRITE_REFERENCES.filter((name) => new RegExp(`\\b${name}\\b`).test(code))
  assert.deepEqual(
    offenders,
    [],
    'ConciergeAgent may NAME a write, never perform one — the client executes it on the user\'s GO. ' +
      `Found: ${offenders.join(', ')}`,
  )
})

test('the proposable-write allowlist is exactly the three confirmed actions', () => {
  assert.deepEqual(
    [...CONCIERGE_WRITE_ACTIONS].sort(),
    [...CONFIRMED_WRITE_ACTIONS].sort(),
    'The concierge\'s proposable-write set no longer matches this guard\'s confirmed list. Widening ' +
      'it is a doctrine change, not a code change: record the ruling, then update this list. ' +
      `Exported: ${[...CONCIERGE_WRITE_ACTIONS].sort().join(', ')} | Guard: ${[...CONFIRMED_WRITE_ACTIONS].sort().join(', ')}`,
  )
})

// NON-VACUITY: an action that is not on the allowlist must be dropped, whatever its payload.
test('an action outside the allowlist is dropped, never passed through', () => {
  for (const action of ['create_run', 'delete_dataset', 'provision_studio', 'set_preference ', 'SET_PREFERENCE']) {
    assert.equal(
      validateWriteProposal({ action, payload: { key: 'style', value: 'noir' } }),
      undefined,
      `"${action}" must not survive validation`,
    )
  }
})

test('set_preference never reaches a gate the person clicks for themselves', () => {
  // The adult-content pair and the privacy gate. `autoApplyModels` and `memoryNotes` are excluded
  // too — both have their own editor, and neither is a one-scalar setting a card could show whole.
  for (const key of ['spicyMode', 'ageAttestation', 'privateOutputs', 'autoApplyModels', 'memoryNotes']) {
    assert.ok(
      !CONCIERGE_PREFERENCE_KEYS.includes(key),
      `"${key}" must not be in CONCIERGE_PREFERENCE_KEYS`,
    )
    assert.equal(
      validateWriteProposal({ action: 'set_preference', payload: { key, value: true } }),
      undefined,
      `a set_preference naming "${key}" must be dropped`,
    )
  }
})

// The ladder's memory half makes one promise the code cannot re-check at runtime: a note is
// "erased with the account". That promise is a property of WHERE the field lives — `memoryNotes`
// is declared on `Generatio`, which lives in `consuetudines`, which `MeEraser` hard-deletes by
// anima. Move the field to a store the eraser does not reach and the promise silently becomes
// false, with nothing failing. This is the test that fails instead.
test('memoryNotes lives on Generatio, in a collection the account eraser hard-deletes', () => {
  const consuetudo = readFileSync(path.join(process.cwd(), 'src', 'types', 'consuetudo.ts'), 'utf8')
  const generatio = consuetudo.slice(
    consuetudo.indexOf('export interface Generatio'),
    consuetudo.indexOf('export const MEMORY_NOTE_MAX_CHARS'),
  )
  assert.ok(generatio.length > 0, 'could not locate the Generatio interface — the guard has lost its anchor')
  assert.match(
    stripComments(generatio),
    /\bmemoryNotes\?:\s*string\[\]/,
    'memoryNotes must be declared on Generatio: that is what puts it in `consuetudines`, and ' +
      'therefore inside what MeEraser deletes with the account.',
  )

  const eraser = stripComments(readFileSync(path.join(process.cwd(), 'src', 'crystal', 'MeEraser.ts'), 'utf8'))
  assert.match(
    eraser,
    /\bconsuetudinum\.deleteByAnima\(/,
    'MeEraser must hard-delete `consuetudines` by anima — that deletion IS the memory-note promise.',
  )
})
