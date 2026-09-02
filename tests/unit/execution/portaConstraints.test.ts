// =============================================================================
// noema-396 — the numeric legality a Porta declares, as a pure rule
// =============================================================================
//
// `Porta.min/max/step` is the whole expressiveness this seam has, and `step` is the load-bearing
// half: it is spacing measured FROM `min`, not JSON Schema's `multipleOf`. That is what lets
// `{min: 5, step: 17}` state MiniMax H3's "17k+5" exactly, and it is the one thing a reader is
// likeliest to get wrong — so it is pinned here from both directions (209 legal, 100 not).
//
// The renderer is tested alongside the checker on purpose: it is the SINGLE source of the rule's
// prose, feeding both the 422 message and the published JSON-Schema, so a change to one is a
// change to both.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  describeConstraint,
  findConstraintViolation,
  hasConstraint,
} from '../../../src/execution/portaConstraints.js'
import type { Forma } from '../../../src/types/modus.js'

/** The real H3 rule, the case this whole seam exists for. */
const H3: Forma = {
  prompt: { type: 'text', required: true },
  frames: { type: 'int', required: false, default: 209, min: 5, step: 17 },
}

// ── The rule itself ──────────────────────────────────────────────────────────

test('17k+5 is expressible exactly as min 5, step 17 — every legal H3 length passes', () => {
  for (let k = 0; k < 40; k++) {
    const frames = 17 * k + 5
    assert.equal(
      findConstraintViolation(H3, { frames }),
      undefined,
      `${frames} = 17*${k}+5 is a legal H3 clip length`,
    )
  }
})

test('a value off the step is refused, and the refusal names the port and the rule', () => {
  const v = findConstraintViolation(H3, { frames: 100 })
  assert.ok(v, 'frames: 100 is not 17k+5')
  assert.equal(v.porta, 'frames')
  assert.equal(v.value, 100)
  assert.match(v.regula, /5 or more/)
  assert.match(v.regula, /steps of 17/)
})

test('every value between two legal H3 lengths is refused — the step is not advisory', () => {
  for (let frames = 6; frames < 22; frames++) {
    assert.ok(findConstraintViolation(H3, { frames }), `${frames} sits between 5 and 22`)
  }
})

test('a value below the minimum is refused even when it lands on the step from zero', () => {
  // 0 is a multiple of 17 but is not 17k+5, and is below the floor besides. A `multipleOf`
  // reading of `step` would accept it; the offset reading this module implements does not.
  assert.ok(findConstraintViolation(H3, { frames: 0 }))
  assert.ok(findConstraintViolation(H3, { frames: 17 }))
  assert.ok(findConstraintViolation(H3, { frames: -12 }))
})

test('a maximum is inclusive on both sides of the bound', () => {
  const s: Forma = { n: { type: 'int', min: 0, max: 10 } }
  assert.equal(findConstraintViolation(s, { n: 10 }), undefined)
  assert.equal(findConstraintViolation(s, { n: 0 }), undefined)
  assert.ok(findConstraintViolation(s, { n: 11 }))
  assert.ok(findConstraintViolation(s, { n: -1 }))
})

test('a step with no min is spaced from zero', () => {
  const s: Forma = { n: { type: 'int', step: 4 } }
  assert.equal(findConstraintViolation(s, { n: 0 }), undefined)
  assert.equal(findConstraintViolation(s, { n: 32 }), undefined)
  assert.ok(findConstraintViolation(s, { n: 33 }))
})

test('a float port checks its bounds without rounding', () => {
  const s: Forma = { strength: { type: 'float', min: 0, max: 1 } }
  assert.equal(findConstraintViolation(s, { strength: 0.75 }), undefined)
  assert.ok(findConstraintViolation(s, { strength: 1.25 }))
  // An int port WOULD round this to 1 and pass; a float port must not.
  assert.ok(findConstraintViolation(s, { strength: 1.4 }))
})

test('a float step tolerates binary-float error rather than refusing a legal value', () => {
  const s: Forma = { strength: { type: 'float', min: 0, max: 1, step: 0.1 } }
  // 0.1 * 3 is 0.30000000000000004 in binary floating point.
  assert.equal(findConstraintViolation(s, { strength: 0.1 + 0.1 + 0.1 }), undefined)
})

// ── Reading the submitted value the way the run will read it ─────────────────

test('a numeric string is read as its number — a JSON body may carry either', () => {
  assert.equal(findConstraintViolation(H3, { frames: '209' }), undefined)
  assert.ok(findConstraintViolation(H3, { frames: '100' }))
})

test('an int port is checked ROUNDED, because validateAditus rounds it downstream', () => {
  // 209.2 runs as 209, which is legal. Refusing it here would refuse a run that works.
  assert.equal(findConstraintViolation(H3, { frames: 209.2 }), undefined)
  assert.equal(findConstraintViolation(H3, { frames: 208.6 }), undefined)
  const v = findConstraintViolation(H3, { frames: 100.4 })
  assert.equal(v?.value, 100, 'the refusal reports the value as the run would have read it')
})

test('a value that is not a number at all cannot satisfy a rule, and is not echoed back', () => {
  for (const frames of ['abc', '', '   ', NaN, Infinity, {}]) {
    const v = findConstraintViolation(H3, { frames })
    assert.ok(v, `${JSON.stringify(frames)} is not a number`)
    assert.equal(v.porta, 'frames')
    assert.equal('value' in v, false, 'an unreadable value is never put in the error body')
  }
})

// ── The no-op guarantee: an unconstrained port behaves exactly as before ─────

test('a port declaring no constraint is never examined', () => {
  const s: Forma = {
    prompt: { type: 'text', required: true },
    frames: { type: 'int', required: false, default: 33 },
    strength: { type: 'float' },
  }
  assert.equal(hasConstraint(s.frames), false)
  assert.equal(findConstraintViolation(s, { frames: -9999, strength: 1e9, prompt: 'x' }), undefined)
})

test('a constraint on a non-numeric port is inert here — the catalog guard is what refuses it', () => {
  const s: Forma = { prompt: { type: 'text', min: 5, step: 17 } }
  assert.equal(findConstraintViolation(s, { prompt: 'not a number' }), undefined)
})

test('an absent value is not a violation — the port default applies later', () => {
  assert.equal(findConstraintViolation(H3, {}), undefined)
  assert.equal(findConstraintViolation(H3, { frames: undefined }), undefined)
  assert.equal(findConstraintViolation(H3, { frames: null }), undefined)
})

test('the first offending port is named, in declaration order', () => {
  const s: Forma = {
    a: { type: 'int', min: 0 },
    b: { type: 'int', min: 0 },
  }
  assert.equal(findConstraintViolation(s, { a: -1, b: -1 })?.porta, 'a')
  assert.equal(findConstraintViolation(s, { a: 1, b: -1 })?.porta, 'b')
})

// ── The prose, which the 422 and the published schema both quote ─────────────

test('the H3 rule renders as a sentence that shows the pattern', () => {
  assert.equal(
    describeConstraint(H3.frames),
    '5 or more, in steps of 17 from 5 (5, 22, 39, …)',
  )
})

test('each shape of constraint renders its own sentence, and nothing renders nothing', () => {
  assert.equal(describeConstraint({ type: 'int', min: 1 }), '1 or more')
  assert.equal(describeConstraint({ type: 'int', max: 8 }), '8 or less')
  assert.equal(describeConstraint({ type: 'int', min: 1, max: 8 }), 'between 1 and 8')
  assert.equal(describeConstraint({ type: 'int', step: 4 }), 'in steps of 4 from 0 (0, 4, 8, …)')
  assert.equal(
    describeConstraint({ type: 'int', min: 1, max: 9, step: 4 }),
    'between 1 and 9, in steps of 4 from 1 (1, 5, 9)',
  )
  assert.equal(describeConstraint({ type: 'int' }), undefined)
  assert.equal(describeConstraint({ type: 'int', default: 4 }), undefined)
})

test('the rendered examples stop at the maximum rather than naming illegal values', () => {
  assert.equal(describeConstraint({ type: 'int', min: 0, max: 5, step: 4 }), 'between 0 and 5, in steps of 4 from 0 (0, 4)')
})
