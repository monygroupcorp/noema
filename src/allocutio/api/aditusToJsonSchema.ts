// =============================================================================
// aditusToJsonSchema — pure projection of a Forma into JSON Schema
// =============================================================================
//
// The HTTP API adapter needs to advertise a modus's input/output shape in a
// language external clients understand. JSON Schema (draft-2020-12 style) is
// that lingua franca. This module is a PURE, dependency-free projection: a
// `Forma` (Record<string, Porta>) in, a plain JSON-Schema object out.
//
// No edits to existing code; nothing here imports a runtime dependency.
// =============================================================================

import type { Forma, Porta } from '../../types/modus.js'
import { describeConstraint } from '../../execution/portaConstraints.js'

/** A minimal JSON-Schema object (draft-2020-12 style). */
export interface JsonSchema {
  type: 'object'
  properties: Record<string, JsonSchemaProperty>
  required?: string[]
}

/** The JSON-Schema fragment for a single property (one Porta). */
export interface JsonSchemaProperty {
  type: 'string' | 'integer' | 'number'
  format?: 'uri'
  default?: unknown
  description?: string
  title?: string
  /** Enumerated choices carried through from the Porta, unmodified. Advisory only — the
   *  UI renders a select from these, but the value is not validated against the list. */
  optiones?: Array<{ value: string; label: string }>
  /** JSON Schema `minimum` — the port's declared inclusive lower bound (`Porta.min`). */
  minimum?: number
  /** JSON Schema `maximum` — the port's declared inclusive upper bound (`Porta.max`). */
  maximum?: number
  /**
   * JSON Schema `multipleOf`, emitted ONLY when the port's step really is a multiple rule —
   * i.e. `min` is unset or is itself a multiple of `step`. MiniMax H3's `{min: 5, step: 17}`
   * is NOT (legal lengths are 17k+5, not 17k), so no `multipleOf` is emitted for it: a wrong
   * standard keyword is worse than an absent one, because an off-the-shelf validator would
   * reject every legal H3 clip length.
   */
  multipleOf?: number
  /**
   * The port's step, spaced from `minimum` (`Porta.step`). Non-standard, like `optiones`:
   * draft-2020-12 cannot express an OFFSET step, so a generic validator will ignore this and
   * under-reject. The API is the authority — this keyword and the rule sentence appended to
   * `description` are how a caller learns the real rule before spending on a run.
   */
  step?: number
}

/**
 * Map a single Porta's canonical type name to its JSON-Schema fragment.
 *   text          → { type: 'string' }
 *   int           → { type: 'integer' }
 *   float         → { type: 'number' }
 *   image|video|audio → { type: 'string', format: 'uri' }
 *   unknown       → { type: 'string' }
 */
function portaTypeToSchema(type: string): JsonSchemaProperty {
  switch (type) {
    case 'text':
      return { type: 'string' }
    case 'int':
      return { type: 'integer' }
    case 'float':
      return { type: 'number' }
    case 'image':
    case 'video':
    case 'audio':
    case '3d':
      return { type: 'string', format: 'uri' }
    default:
      return { type: 'string' }
  }
}

/** Build the full JSON-Schema fragment for one Porta. */
function portaToProperty(porta: Porta): JsonSchemaProperty {
  const property = portaTypeToSchema(porta.type)
  if (porta.default !== undefined) property.default = porta.default
  if (porta.label !== undefined) property.title = porta.label
  if (porta.optiones !== undefined) property.optiones = porta.optiones

  // A declared numeric constraint (noema-396) is published, not just enforced: the point of
  // declaring it is that a caller reads it BEFORE spending ~28 minutes of pod time discovering
  // it. `minimum`/`maximum` are exact standard keywords; `multipleOf` is emitted only when the
  // step really is a multiple rule; `step` carries the offset case a generic validator cannot
  // express, and the rendered sentence goes into `description` for the many callers (agents
  // especially) that read prose rather than keywords. Rendered by the SAME function the refusal
  // message uses, so the docs and the 422 can never disagree.
  const regula = describeConstraint(porta)
  if (porta.min !== undefined) property.minimum = porta.min
  if (porta.max !== undefined) property.maximum = porta.max
  if (porta.step !== undefined) {
    property.step = porta.step
    if (porta.min === undefined || porta.min % porta.step === 0) property.multipleOf = porta.step
  }

  const description =
    porta.description !== undefined && regula !== undefined ? `${porta.description} Must be ${regula}.`
    : regula !== undefined ? `Must be ${regula}.`
    : porta.description
  if (description !== undefined) property.description = description

  return property
}

/**
 * Project a Forma (input or output schema) into a JSON-Schema object.
 * Pure: no mutation of the input, no side effects.
 */
export function aditusToJsonSchema(aditus: Forma): JsonSchema {
  const properties: Record<string, JsonSchemaProperty> = {}
  const required: string[] = []

  for (const [key, porta] of Object.entries(aditus)) {
    // Skip internal routing keys (`__capability`, legacy `__spaceUrl`, …). They
    // carry a default and are consumed by the cursor — never something an external
    // client (or the Concierge/agent surface) should see or supply.
    if (key.startsWith('__')) continue
    properties[key] = portaToProperty(porta)
    if (porta.required === true) required.push(key)
  }

  const schema: JsonSchema = { type: 'object', properties }
  if (required.length > 0) schema.required = required
  return schema
}

/** A minimal modus shape for describeFlow — only the fields it reads. */
export interface DescribableModus {
  id: string
  nomen: string
  versio: string
  aditus: Forma
  exitus?: Forma
  [k: string]: unknown
}

/** The public description of a flow for the HTTP API "describe" endpoint. */
export interface FlowDescription {
  id: string
  nomen: string
  versio: string
  input: JsonSchema
  output?: JsonSchema
  /** Flow-level routing line — what this flow is for and when to pick it over its
   *  siblings. Passed through read-only from `Modus.descriptio`; absent when unset. */
  descriptio?: unknown
  categoria?: unknown
  fundamentumId?: unknown
  /** The flow's model-family compatibility key (e.g. 'flux', 'sdxl', 'sd15'), derived
   *  read-only from the flow's weight manifest by the `describeFlow()` call site in
   *  CrystalApi.ts — absent when no family could be determined. Lets the web client
   *  filter the model catalog (`GET /v1/models?basis=`) to the LoRAs compatible with
   *  this flow, for the live trigger-word highlight in the composer. */
  familia?: string
}

/** Useful meta keys passed through from the modus when present. */
const PASSTHROUGH_META = ['descriptio', 'categoria', 'fundamentumId'] as const

/**
 * Describe a flow for the HTTP API: id/nomen/versio + JSON-Schema input
 * (always) and output (when exitus present), plus a small set of useful
 * passthrough meta. Pure.
 */
export function describeFlow(modus: DescribableModus): FlowDescription {
  const description: FlowDescription = {
    id: modus.id,
    nomen: modus.nomen,
    versio: modus.versio,
    input: aditusToJsonSchema(modus.aditus),
  }
  if (modus.exitus !== undefined) {
    description.output = aditusToJsonSchema(modus.exitus)
  }
  for (const key of PASSTHROUGH_META) {
    if (modus[key] !== undefined) description[key] = modus[key]
  }
  return description
}
