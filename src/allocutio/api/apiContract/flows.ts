import type { JsonSchema, RouteSpec } from './types'

export const FlowSummarySchema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    nomen: { type: 'string', description: 'The flow display name.' },
    versio: { type: 'string', description: 'The flow version.' },
    descriptio: { type: 'string', description: 'A flow-level routing line — what this flow is for and when to pick it over its siblings.' },
    categoria: { description: 'An optional catalog tag.' },
    modusGenus: {
      type: 'string',
      description: "The flow's canon verb, derived at query time from its aditus/exitus ports (see `resolveCanonVerb`, noema-054).",
      // Mirrors verbResolver.ts's `CanonVerb` union — the capability-map's 14 verbs plus `enhance`.
      enum: [
        'make', 'effect', 'animate', 'direct', 'render',
        'chat', 'describe', 'transcribe', 'speak', 'compose', 'foley',
        'sculpt', 'lift', 'scan',
        'enhance',
      ],
    },
  },
  required: ['id', 'nomen', 'versio', 'modusGenus'],
}

export const FlowsListSchema: JsonSchema = {
  type: 'object',
  properties: {
    flows: { type: 'array', items: FlowSummarySchema },
  },
  required: ['flows'],
}

export const FlowDescriptionSchema: JsonSchema = {
  type: 'object',
  description: "A flow's JSON-Schema description — read this before invoking; never guess inputs.",
  properties: {
    id: { type: 'string' },
    nomen: { type: 'string' },
    versio: { type: 'string' },
    input: {
      type: 'object',
      description: "The flow's input JSON-Schema (the shape of `aditus`).",
      additionalProperties: true,
    },
    output: {
      type: 'object',
      description: "The flow's output JSON-Schema — present when the flow declares one.",
      additionalProperties: true,
    },
    descriptio: { type: 'string', description: 'A flow-level routing line — what this flow is for and when to pick it over its siblings.' },
    categoria: { description: 'An optional catalog tag.' },
    fundamentumId: { description: 'An optional substrate reference.' },
  },
  required: ['id', 'nomen', 'versio', 'input'],
}

export const QuoteRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Estimate a run cost without dispatching. Provide a target (modusId or verb) and inputs.',
  properties: {
    modusId: { type: 'string', description: 'Explicit flow id to quote (wins over verb).' },
    verb: { type: 'string', description: 'A canon verb to resolve to a flow.' },
    aditus: {
      type: 'object',
      additionalProperties: true,
      description: "The flow's inputs — same shape as POST /runs aditus.",
    },
  },
}

export const QuoteResponseSchema: JsonSchema = {
  type: 'object',
  description: 'The estimated impetus cost for the run.',
  properties: {
    impetus: { type: 'string', description: 'Upper-bound reservation cost, serialised as a string.' },
  },
  required: ['impetus'],
}

export const SaveFlowRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Save a reusable owner-keyed flow derived from an owned run or a base flow.',
  properties: {
    fromRun: { type: 'string', description: 'Derive from an owned run (copies its modusId + aditus).' },
    modusId: { type: 'string', description: 'Derive from an explicit base flow id.' },
    name: { type: 'string', description: 'Human-readable name; yields a global-unique slug.' },
    aditus: { type: 'object', additionalProperties: true, description: 'Input defaults to bake into the saved flow.' },
    promptMode: { type: 'string', enum: ['open', 'pinned'] as const, description: 'Whether the prompt field is open or pinned.' },
    affix: {
      type: 'object',
      description: 'Prompt prefix/suffix to fold into every run of this flow.',
      properties: {
        prefix: { type: 'string' },
        suffix: { type: 'string' },
      },
    },
    pinnedModels: {
      type: 'array',
      description: 'Model pins baked into the saved flow.',
      items: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  },
  required: ['name'],
}

export const SaveFlowResponseSchema: JsonSchema = {
  type: 'object',
  description: 'The id of the newly created flow.',
  properties: { id: { type: 'string', description: 'The slug id of the saved flow.' } },
  required: ['id'],
}

export const BindRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Rebind a canon verb to a specific flow.',
  properties: { modusId: { type: 'string', description: 'The flow id to bind this verb to.' } },
  required: ['modusId'],
}

export const BindResponseSchema: JsonSchema = {
  type: 'object',
  description: 'The resulting verb → flow binding.',
  properties: {
    verb: { type: 'string', description: 'The verb that was rebound.' },
    modusId: { type: 'string', description: 'The flow it now resolves to.' },
  },
  required: ['verb', 'modusId'],
}

export const MyFlowsListSchema: JsonSchema = {
  type: 'object',
  properties: { flows: { type: 'array', items: FlowSummarySchema } },
  required: ['flows'],
}

export const flowsAndQuoteRoutes: RouteSpec[] = [
    {
      method: 'GET',
      path: '/flows',
      summary: 'List the runnable flows (discovery).',
      auth: false,
      response: FlowsListSchema,
    },
    {
      method: 'GET',
      path: '/flows/:id',
      summary: "Describe one flow's input/output JSON-Schema (discovery).",
      auth: false,
      response: FlowDescriptionSchema,
    },
    {
      method: 'POST',
      path: '/runs/quote',
      summary: 'Estimate a run cost (impetus) without dispatching — call before invoke to budget.',
      auth: true,
      request: QuoteRequestSchema,
      response: QuoteResponseSchema,
    },
]

export const flowManageRoutes: RouteSpec[] = [
    {
      method: 'POST',
      path: '/flows',
      summary: 'Save a reusable owner-keyed flow derived from an owned run (fromRun) or a base flow (modusId).',
      auth: true,
      request: SaveFlowRequestSchema,
      response: SaveFlowResponseSchema,
    },
    {
      method: 'PUT',
      path: '/me/bindings/:verb',
      summary: 'Rebind a canon verb (make, chat) to a specific flow for the authenticated caller.',
      auth: true,
      request: BindRequestSchema,
      response: BindResponseSchema,
    },
]

export const myFlowsRoute: RouteSpec[] = [
    {
      method: 'GET',
      path: '/me/flows',
      summary: "List the caller's own registered flows (owner-scoped discovery for the canvas node picker) — the public catalog's owner-filtered twin.",
      auth: true,
      response: MyFlowsListSchema,
    },
]
