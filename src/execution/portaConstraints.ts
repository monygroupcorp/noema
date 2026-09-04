// =============================================================================
// portaConstraints — the numeric legality a Porta declares, checked and rendered
// =============================================================================
//
// A `Porta` may declare `min` / `max` / `step` on an 'int' or 'float' port (noema-396). This
// module is the ONLY thing that reads them: a pure predicate the run entry point calls before
// anything is reserved, and a pure renderer that turns the same three numbers into the one
// sentence used by BOTH the refusal message and the published JSON-Schema — so the rule a caller
// is refused by and the rule a caller is shown can never drift apart.
//
// `step` is spacing measured FROM `min` (from 0 when `min` is unset) — the ComfyUI INPUT_TYPES
// sense, which is where these rules come from. That is what lets `{min: 5, step: 17}` state
// MiniMax H3's "17k+5" exactly. It is NOT JSON Schema's `multipleOf` unless `min` happens to be a
// multiple of `step`; see `aditusToJsonSchema` for what the published schema does about that.
//
// No I/O, no dependencies beyond the type. Pure and deterministic: given the same Forma and the
// same values it names the same first offending port every time (Forma declaration order).
// =============================================================================

import type { Forma, Porta } from '../types/modus.js'

/** The port types a numeric constraint is meaningful on. */
export const CONSTRAINABLE_TYPES = new Set(['int', 'float'])

/** Float `%` is not exact, so a step check needs a tolerance. Ints never reach it. */
const STEP_EPSILON = 1e-9

/** Does this port declare a numeric constraint at all? */
export function hasConstraint(porta: Porta): boolean {
  return porta.min !== undefined || porta.max !== undefined || porta.step !== undefined
}

/**
 * Render a port's constraint as one human sentence fragment — "5 or more, in steps of 17
 * (5, 22, 39, …)". Undefined when the port declares nothing.
 *
 * This is the single source of the rule's prose. The refusal message and the published schema
 * both call it, so a caller reading the docs and a caller reading a 422 are told the same thing.
 */
export function describeConstraint(porta: Porta): string | undefined {
  if (!hasConstraint(porta)) return undefined
  const { min, max, step } = porta

  const parts: string[] = []
  if (min !== undefined && max !== undefined) parts.push(`between ${min} and ${max}`)
  else if (min !== undefined) parts.push(`${min} or more`)
  else if (max !== undefined) parts.push(`${max} or less`)

  if (step !== undefined) {
    // Three legal values are enough to make the pattern unmistakable, and cheap to read. They
    // start at `min` because that is where the spacing is measured from — which is the whole
    // point of these two numbers together, and the half a bare "step" would leave ambiguous.
    const base = min ?? 0
    const shown = [base, base + step, base + 2 * step].filter((v) => max === undefined || v <= max)
    const more = max === undefined || base + 3 * step <= max
    const examples = shown.length > 0 ? ` (${shown.join(', ')}${more ? ', …' : ''})` : ''
    parts.push(`in steps of ${step} from ${base}${examples}`)
  }

  return parts.join(', ')
}

/** The first port whose submitted value violates its own declared rule. */
export interface ConstraintViolation {
  /** The offending aditus port key. */
  porta: string
  /** The rule it violated, as prose (`describeConstraint`). */
  regula: string
  /**
   * The offending value, AS THE RUN WOULD HAVE READ IT (an 'int' port is rounded, exactly as
   * `validateAditus` rounds it downstream) — present only when it read as a finite number. A
   * value that is not a number at all is omitted rather than echoed: the sibling refusal at this
   * boundary (`input.invalid_aditus` for an undeclared key) deliberately never puts a caller's
   * value in an error body, and an unreadable value carries no information a number would.
   */
  value?: number
}

/**
 * Find the first declared-constraint violation in a submitted aditus, or undefined when there is
 * none. Called at the run entry point, ABOVE any reservation.
 *
 * Rules:
 *   • Only 'int' / 'float' ports that actually declare something are examined. Every other port,
 *     and every unconstrained port, is untouched — this function is a strict no-op for them.
 *   • An ABSENT value (undefined/null) is not a violation. The port's own `default` applies later,
 *     and a default that violates its own rule is a catalog bug caught by the catalog guard, not a
 *     caller error to refuse a run over.
 *   • An 'int' value is checked ROUNDED, because `validateAditus` rounds it downstream: `209.2`
 *     runs as the legal `209`, so refusing it here would refuse a run that works.
 *   • A value that cannot be read as a finite number violates any constraint — a port with a
 *     legality rule cannot be satisfied by something that is not a number.
 */
export function findConstraintViolation(
  aditus: Forma,
  values: Record<string, unknown>,
): ConstraintViolation | undefined {
  for (const [key, porta] of Object.entries(aditus)) {
    if (!CONSTRAINABLE_TYPES.has(porta.type) || !hasConstraint(porta)) continue

    const raw = values[key]
    if (raw === undefined || raw === null) continue

    const regula = describeConstraint(porta) as string

    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || String(raw).trim() === '') return { porta: key, regula }

    const value = porta.type === 'int' ? Math.round(parsed) : parsed
    if (porta.min !== undefined && value < porta.min) return { porta: key, regula, value }
    if (porta.max !== undefined && value > porta.max) return { porta: key, regula, value }
    if (porta.step !== undefined && porta.step > 0) {
      const offset = value - (porta.min ?? 0)
      const remainder = Math.abs(offset % porta.step)
      const onStep = remainder <= STEP_EPSILON || Math.abs(remainder - porta.step) <= STEP_EPSILON
      if (!onStep) return { porta: key, regula, value }
    }
  }
  return undefined
}
