import type { Forma } from '../types/modus.js'

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document'])

/**
 * validateAditus — enforces a Modus.aditus Forma schema against runtime values
 * at the point where user form input enters the system.
 *
 * - Strips keys not declared in schema
 * - Throws on missing required fields (no default)
 * - Applies defaults for absent fields that have one
 * - Coerces values to declared types (text, int, float, bool, media)
 * - Passes through unknown types as-is (future-proof)
 * - Omits optional absent fields with no default (no undefined pollution)
 * - Special case: text fields with Array values pass through as-is (messages[])
 */
export function validateAditus(
  schema: Forma,
  values: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, porta] of Object.entries(schema)) {
    const rawValue = values[key]
    const isAbsent = rawValue === undefined || rawValue === null

    // Missing field — check required / default
    if (isAbsent) {
      if (porta.default !== undefined) {
        result[key] = porta.default
        continue
      }
      if (porta.required === true) {
        throw new Error(`aditus: required field "${key}" is missing`)
      }
      // Optional, no default — omit entirely
      continue
    }

    // Field is present — coerce by type
    result[key] = coerce(key, porta.type, rawValue)
  }

  return result
}

function coerce(key: string, type: string, value: unknown): unknown {
  switch (type) {
    case 'text': {
      // Special case: arrays pass through as-is (messages[] conversation threading)
      if (Array.isArray(value)) return value
      return String(value)
    }

    case 'int': {
      const n = Number(value)
      if (!Number.isFinite(n) || String(value).trim() === '') {
        throw new Error(`aditus: field "${key}" must be an integer, got "${String(value)}"`)
      }
      return Math.round(n)
    }

    case 'float': {
      const n = Number(value)
      if (!Number.isFinite(n) || String(value).trim() === '') {
        throw new Error(`aditus: field "${key}" must be a float, got "${String(value)}"`)
      }
      return n
    }

    case 'bool': {
      // A boolean port must reach the cursor as a real boolean. Cursors read these ports with an
      // identity check (`aditus.flag !== false`, the default-on opt-out shape), so a coercion
      // that yields a non-boolean inverts the port's meaning: the 'text' arm above would map
      // `false` to the string 'false', which is `!== false` and therefore reads as ON.
      //
      // Accepted: a real boolean, or the exact strings 'true' / 'false' (trimmed,
      // case-insensitive) that an HTML form or a query string produces for one. Anything else is
      // rejected rather than guessed, the same way 'int' rejects a non-number — a boolean port
      // that quietly reads an unrecognised value as `true` is the outcome this case exists to
      // prevent.
      if (typeof value === 'boolean') return value
      const s = String(value).trim().toLowerCase()
      if (s === 'true') return true
      if (s === 'false') return false
      throw new Error(`aditus: field "${key}" must be a boolean, got "${String(value)}"`)
    }

    default: {
      if (MEDIA_TYPES.has(type)) {
        const s = String(value)
        if (s === '') {
          throw new Error(`aditus: field "${key}" must be a non-empty URL string`)
        }
        return s
      }
      // Unknown type — pass through as-is
      return value
    }
  }
}
