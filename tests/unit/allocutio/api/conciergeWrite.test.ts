import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  validateWriteProposal,
  validateMemoryDelta,
  CONCIERGE_PREFERENCE_KEYS,
  MEMORY_NOTE_MAX_CHARS,
  MEMORY_NOTES_MAX,
  MEMORY_DELTA_MAX_ADDS,
  WRITE_MAX_ACTUM_IDS,
  WRITE_MAX_TRACTUS_AXES,
  WRITE_MAX_TRACTUS_VALORES,
  WRITE_MAX_NUMERUS,
} from '../../../../src/allocutio/api/ConciergeAgent.js'

// The author ladder's grammar, unit by unit. The shape mirrors conciergeDestination.test.ts
// deliberately: a proposed write is validated exactly like a proposed destination, and every
// rejection below returns `undefined` — DROPPED, never an error and never a pass-through, so the
// reply text still delivers on its own.

// ---------------------------------------------------------------------------
// create_dataset
// ---------------------------------------------------------------------------

test('accepts a create_dataset naming runs the agent read this turn', () => {
  const w = validateWriteProposal({
    action: 'create_dataset',
    payload: { source: 'generation', name: 'Cold portraits', modality: 'image', actumIds: ['run_1', 'run_2'] },
  })
  assert.deepEqual(w, {
    action: 'create_dataset',
    payload: { source: 'generation', name: 'Cold portraits', modality: 'image', actumIds: ['run_1', 'run_2'] },
  })
})

// NON-VACUITY: `source: 'upload'` takes presigned mediaUrls the agent has no tool to mint, so a
// proposed one could only be an invented URL. It is not in the grammar.
test('rejects a create_dataset from uploads', () => {
  assert.equal(
    validateWriteProposal({
      action: 'create_dataset',
      payload: { source: 'upload', name: 'x', modality: 'image', mediaUrls: ['https://evil.example/a.png'] },
    }),
    undefined,
  )
})

test('rejects a create_dataset with an unknown modality', () => {
  assert.equal(
    validateWriteProposal({
      action: 'create_dataset',
      payload: { source: 'generation', name: 'x', modality: 'hologram', actumIds: ['run_1'] },
    }),
    undefined,
  )
})

test('rejects a create_dataset with no runs, or more than the card can show', () => {
  const base = { source: 'generation', name: 'x', modality: 'image' }
  assert.equal(validateWriteProposal({ action: 'create_dataset', payload: { ...base, actumIds: [] } }), undefined)
  assert.equal(
    validateWriteProposal({
      action: 'create_dataset',
      payload: { ...base, actumIds: Array.from({ length: WRITE_MAX_ACTUM_IDS + 1 }, (_, i) => `run_${i}`) },
    }),
    undefined,
  )
})

// A payload is never half-accepted: one bad id drops the whole proposal rather than minting a
// dataset from the ids that happened to parse.
test('rejects a create_dataset whose run id list holds a non-string', () => {
  assert.equal(
    validateWriteProposal({
      action: 'create_dataset',
      payload: { source: 'generation', name: 'x', modality: 'image', actumIds: ['run_1', 42] },
    }),
    undefined,
  )
})

// ---------------------------------------------------------------------------
// patch_collection_draft
// ---------------------------------------------------------------------------

test('accepts a patch_collection_draft carrying one field', () => {
  assert.deepEqual(
    validateWriteProposal({ action: 'patch_collection_draft', payload: { id: 'col_1', numerus: 50 } }),
    { action: 'patch_collection_draft', payload: { id: 'col_1', numerus: 50 } },
  )
})

test('accepts a patch_collection_draft carrying a trait grid, keeping only the fields a card renders', () => {
  const w = validateWriteProposal({
    action: 'patch_collection_draft',
    payload: {
      id: 'col_1',
      tractus: [
        {
          porta: 'prompt',
          label: 'Palette',
          // promptFragment/excludes/tags belong to the garden editor, not a chat card: dropped.
          valores: [{ value: 'cold', label: 'Cold', rarity: 0.25, promptFragment: 'ignored', tags: ['x'] }],
        },
      ],
    },
  })
  assert.deepEqual(w, {
    action: 'patch_collection_draft',
    payload: {
      id: 'col_1',
      tractus: [{ porta: 'prompt', label: 'Palette', valores: [{ value: 'cold', label: 'Cold', rarity: 0.25 }] }],
    },
  })
})

// NON-VACUITY: a patch naming no field is a card asking for a GO that changes nothing.
test('rejects a patch_collection_draft with an id and nothing else', () => {
  assert.equal(validateWriteProposal({ action: 'patch_collection_draft', payload: { id: 'col_1' } }), undefined)
})

test('rejects a patch_collection_draft whose supply is not a sane whole number', () => {
  for (const numerus of [0, -1, 1.5, WRITE_MAX_NUMERUS + 1, Number.NaN, '50']) {
    assert.equal(
      validateWriteProposal({ action: 'patch_collection_draft', payload: { id: 'col_1', numerus } }),
      undefined,
      `numerus ${String(numerus)} must be rejected`,
    )
  }
})

test('rejects a trait grid wider or deeper than a person reads before pressing GO', () => {
  const axis = (n: number) => ({ porta: `p${n}`, valores: [{ value: 'v' }] })
  assert.equal(
    validateWriteProposal({
      action: 'patch_collection_draft',
      payload: { id: 'col_1', tractus: Array.from({ length: WRITE_MAX_TRACTUS_AXES + 1 }, (_, i) => axis(i)) },
    }),
    undefined,
  )
  assert.equal(
    validateWriteProposal({
      action: 'patch_collection_draft',
      payload: {
        id: 'col_1',
        tractus: [
          { porta: 'prompt', valores: Array.from({ length: WRITE_MAX_TRACTUS_VALORES + 1 }, (_, i) => ({ value: `v${i}` })) },
        ],
      },
    }),
    undefined,
  )
})

test('rejects a rarity outside 0..1', () => {
  for (const rarity of [-0.1, 1.1, 'often']) {
    assert.equal(
      validateWriteProposal({
        action: 'patch_collection_draft',
        payload: { id: 'col_1', tractus: [{ porta: 'prompt', valores: [{ value: 'cold', rarity }] }] },
      }),
      undefined,
      `rarity ${String(rarity)} must be rejected`,
    )
  }
})

// ---------------------------------------------------------------------------
// set_preference
// ---------------------------------------------------------------------------

test('accepts every listed preference key', () => {
  for (const key of CONCIERGE_PREFERENCE_KEYS) {
    const value = key === 'telegramDeliverAs' ? 'album' : 'something'
    assert.deepEqual(
      validateWriteProposal({ action: 'set_preference', payload: { key, value } }),
      { action: 'set_preference', payload: { key, value } },
      `${key} must be proposable`,
    )
  }
})

// NON-VACUITY: the adult-content gate and the privacy gate are the point of the allowlist. They
// are a click the PERSON makes on their own settings screen, never a thing an agent talks
// someone into.
test('rejects the gates the person clicks for themselves', () => {
  for (const key of ['spicyMode', 'ageAttestation', 'privateOutputs']) {
    assert.equal(validateWriteProposal({ action: 'set_preference', payload: { key, value: true } }), undefined)
  }
})

test('rejects a telegramDeliverAs outside its enum', () => {
  assert.equal(
    validateWriteProposal({ action: 'set_preference', payload: { key: 'telegramDeliverAs', value: 'carousel' } }),
    undefined,
  )
})

test('rejects a set_preference with an empty or absent value', () => {
  assert.equal(validateWriteProposal({ action: 'set_preference', payload: { key: 'style', value: '   ' } }), undefined)
  assert.equal(validateWriteProposal({ action: 'set_preference', payload: { key: 'style' } }), undefined)
})

// ---------------------------------------------------------------------------
// the allowlist itself
// ---------------------------------------------------------------------------

test('rejects an unlisted action however well-formed its payload', () => {
  assert.equal(
    validateWriteProposal({ action: 'create_run', payload: { modusId: 'flux.txt2img', aditus: { prompt: 'a cat' } } }),
    undefined,
  )
})

test('rejects malformed input shapes without throwing', () => {
  for (const bad of [undefined, null, 'not-an-object', 42, [], { action: 'set_preference' }, { payload: {} }]) {
    assert.equal(validateWriteProposal(bad), undefined)
  }
})

// A payload key the validator does not name never survives, so nothing can be applied that the
// card did not show: the card renders the payload the validator RETURNED, key by key.
test('an unknown payload key does not survive into the validated payload', () => {
  const w = validateWriteProposal({
    action: 'set_preference',
    payload: { key: 'style', value: 'noir', andAlso: 'privateOutputs' },
  })
  assert.deepEqual(w, { action: 'set_preference', payload: { key: 'style', value: 'noir' } })
})

// ---------------------------------------------------------------------------
// the memory delta
// ---------------------------------------------------------------------------

test('accepts an addition and a removal', () => {
  assert.deepEqual(
    validateMemoryDelta({ add: ['prefers cold, desaturated palettes'], remove: ['works in English'] }),
    { add: ['prefers cold, desaturated palettes'], remove: ['works in English'] },
  )
})

test('a delta with nothing to apply is dropped', () => {
  assert.equal(validateMemoryDelta({}), undefined)
  assert.equal(validateMemoryDelta({ add: [], remove: [] }), undefined)
  assert.equal(validateMemoryDelta(undefined), undefined)
})

// NON-VACUITY: a turn learns a thing or two, not a dossier.
test('rejects a delta adding more than one turn\'s worth', () => {
  assert.equal(
    validateMemoryDelta({ add: Array.from({ length: MEMORY_DELTA_MAX_ADDS + 1 }, (_, i) => `note ${i}`) }),
    undefined,
  )
})

test('rejects a delta removing more than a full list', () => {
  assert.equal(
    validateMemoryDelta({ remove: Array.from({ length: MEMORY_NOTES_MAX + 1 }, (_, i) => `note ${i}`) }),
    undefined,
  )
})

// A malformed entry drops the WHOLE delta rather than applying the half that parsed: a partially
// written memory is harder to notice, and harder to correct, than none at all.
test('one over-long or non-string note drops the whole delta', () => {
  assert.equal(validateMemoryDelta({ add: ['fine', 'x'.repeat(MEMORY_NOTE_MAX_CHARS + 1)] }), undefined)
  assert.equal(validateMemoryDelta({ add: ['fine', 42] }), undefined)
  assert.equal(validateMemoryDelta({ add: ['fine', '   '] }), undefined)
})

test('rejects malformed delta shapes without throwing', () => {
  for (const bad of ['note', 42, [], { add: 'a note' }, { remove: 'a note' }]) {
    assert.equal(validateMemoryDelta(bad), undefined)
  }
})
