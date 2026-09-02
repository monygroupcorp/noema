// =============================================================================
// noema-396 — every declared numeric constraint in the catalog is a coherent one
// =============================================================================
//
// `Porta.min/max/step` is enforced at the run boundary, which means a wrong declaration refuses
// legal runs — the failure mode is invisible until a caller is turned away. These are the guards
// that make a wrong declaration fail here instead, at seed time:
//
//   • a constraint only means something on an 'int' / 'float' port, so declaring one anywhere else
//     is a silent no-op and must be caught rather than shipped;
//   • `step > 0` and `min <= max`, or the rule admits nothing;
//   • a port's own `default` must satisfy its own rule — the one value the platform picks on the
//     caller's behalf cannot be one the platform then refuses.
//
// Plus the H3 rule itself, pinned by value: `{min: 5, step: 17}` is the reason this seam exists,
// and 209 (= 17*12+5) is the default a run actually uses.
// =============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CANONICAL_ESSENTIAE } from '../../../../src/crystal/seeds/essentiae.js'
import { CANONICAL_MODI } from '../../../../src/crystal/seeds/modi.js'
import {
  CONSTRAINABLE_TYPES,
  findConstraintViolation,
  hasConstraint,
} from '../../../../src/execution/portaConstraints.js'
import type { Forma, Modus, Porta } from '../../../../src/types/modus.js'

/** Every seeded flow, and both halves of its schema — a constraint is wrong in either place. */
const FORMAE: Array<{ id: string; where: string; forma: Forma }> = []
for (const m of [...CANONICAL_ESSENTIAE, ...CANONICAL_MODI] as Modus[]) {
  if (m.aditus) FORMAE.push({ id: m.id, where: 'aditus', forma: m.aditus })
  if (m.exitus) FORMAE.push({ id: m.id, where: 'exitus', forma: m.exitus })
}

function eachConstrainedPorta(fn: (ctx: { at: string; porta: Porta; key: string }) => void): void {
  for (const { id, where, forma } of FORMAE) {
    for (const [key, porta] of Object.entries(forma)) {
      if (hasConstraint(porta)) fn({ at: `${id}.${where}.${key}`, porta, key })
    }
  }
}

test('a numeric constraint is only declared on a port that can carry one', () => {
  eachConstrainedPorta(({ at, porta }) => {
    assert.ok(
      CONSTRAINABLE_TYPES.has(porta.type),
      `${at} declares min/max/step on a '${porta.type}' port, where it is never checked. ` +
        `Constraints are meaningful on 'int' and 'float' only.`,
    )
  })
})

test('every declared constraint admits at least one value', () => {
  eachConstrainedPorta(({ at, porta }) => {
    if (porta.step !== undefined) {
      assert.ok(porta.step > 0, `${at} declares step ${porta.step}; a step must be positive`)
    }
    if (porta.min !== undefined && porta.max !== undefined) {
      assert.ok(porta.min <= porta.max, `${at} declares min ${porta.min} above max ${porta.max}`)
    }
  })
})

test("a port's own default satisfies its own rule", () => {
  eachConstrainedPorta(({ at, porta, key }) => {
    if (porta.default === undefined) return
    const violation = findConstraintViolation({ [key]: porta }, { [key]: porta.default })
    assert.equal(
      violation, undefined,
      `${at} defaults to ${String(porta.default)}, which its own constraint (${violation?.regula}) refuses`,
    )
  })
})

// ── The rule this item exists for, pinned by value ───────────────────────────

const H3_FLOWS = ['minimax-h3-t2v', 'minimax-h3-fl2v', 'minimax-h3-ref2v']

test('all three MiniMax H3 flows declare the real 17k+5 clip-length rule', () => {
  for (const id of H3_FLOWS) {
    const flow = CANONICAL_ESSENTIAE.find(e => e.id === id)
    assert.ok(flow, `seed ${id} is present`)
    const frames = flow.aditus?.frames
    assert.ok(frames, `${id} declares a frames port`)
    assert.equal(frames.min, 5, `${id}: legal H3 lengths start at 5`)
    assert.equal(frames.step, 17, `${id}: legal H3 lengths are spaced 17 apart (17k+5)`)
    assert.equal(frames.max, undefined, `${id}: no measured ceiling exists, so none is declared`)
    assert.equal(frames.default, 209, `${id}: 209 = 17*12+5, the rig-proven default`)
  }
})

test('the wan22 flows deliberately declare no frame rule', () => {
  // H3's rule was verified (n % 17 == 5, from the node's INPUT_TYPES and the rig scripts);
  // Wan2.2's was not. The only frame count anything has proven for Wan is its default 33, and
  // the latent node's step is advisory — an off-step length is floor-divided rather than
  // refused. A guessed `step: 4` would refuse runs that work today. Measure it on a pod first,
  // then declare it and change this test.
  for (const id of ['wan22-t2v', 'wan22-i2v']) {
    const flow = CANONICAL_ESSENTIAE.find(e => e.id === id)
    assert.ok(flow, `seed ${id} is present`)
    assert.equal(hasConstraint(flow.aditus.frames), false, `${id}: frames stays unconstrained`)
  }
})
