import type { JsonSchema, RouteSpec } from './types'

export const ProvisionStudioRequestSchema: JsonSchema = {
  type: 'object',
  description:
    'Lease a hosted warm studio. Everything is optional — the simplest call leases a default ' +
    'studio capped at the balance. Discover fundamentumId via GET /v1/fundamenta and models via ' +
    'GET /v1/models (no opaque ids).',
  properties: {
    fundamentumId: { type: 'string', description: 'Compute substrate to arm on (its runtime is inherited). Enumerate via GET /v1/fundamenta.' },
    models: { type: 'array', items: { type: 'string' }, description: 'Model ids (intellaId) to install live onto the studio. Enumerate via GET /v1/models.' },
    warmMs: { type: 'number', description: 'How long to hold the studio warm (ms).' },
    maxImpetus: { type: 'string', description: 'Hard spend cap = the session budget (impetus). The studio drain-terminates at the cap. Omitted → the full balance.' },
    runtime: { type: 'string', description: 'Override the on-pod runtime explicitly (else inherited from the fundamentum).' },
    options: {
      type: 'object',
      description: 'Optional per-provision settings.',
      properties: {
        webhookUrl: { type: 'string', description: 'Fire-and-forget POST when the studio is ready (or failed) — sugar over polling GET /v1/studios/:id.' },
      },
    },
  },
}

export const StudioViewSchema: JsonSchema = {
  type: 'object',
  description: 'A hosted studio. `studioId` is what POST /v1/runs { studioId } targets.',
  properties: {
    studioId: { type: 'string', description: 'The studio id (a Modo session) — pass as run.studioId.' },
    podId: { type: 'string', description: 'The underlying pod id.' },
    status: { type: 'string', description: 'Pod-derived liveness: idle | running | provisioning | draining | terminated.' },
    gpu: { type: 'string', description: 'GPU model the studio runs on.' },
    runtime: { type: 'string', description: 'On-pod runtime (ComfyUI / llama.cpp / …).' },
    imageRef: { type: 'string', description: 'The pod image reference.' },
    warmUntil: { type: 'string', format: 'date-time', description: 'When the warm window expires.' },
    budgetImpetus: { type: 'string', description: 'The authorized session budget (the maxImpetus cap), as a string.' },
    costPerHr: { type: 'number', description: "The pod's real hourly USD cost — the source of truth for warm-time billing." },
    impetusPerSecond: { type: 'string', description: 'Coarse burn-rate hint (impetus/sec); billing is per-window from costPerHr. Prefer costPerHr for an accurate rate.' },
  },
  required: ['studioId', 'status', 'budgetImpetus'],
}

export const StudioEnvelopeSchema: JsonSchema = {
  type: 'object',
  description: 'A newly leased studio.',
  properties: { studio: StudioViewSchema },
  required: ['studio'],
}

export const StudiosListSchema: JsonSchema = {
  type: 'object',
  description: "The caller's live studios.",
  properties: { studios: { type: 'array', items: StudioViewSchema } },
  required: ['studios'],
}

export const studiosRoutes: RouteSpec[] = [
    {
      method: 'POST',
      path: '/studios',
      summary: 'Lease a hosted warm studio (a persistent GPU session) for fast repeated runs. Returns a provisioning handle immediately; poll GET /v1/studios/:id (or set options.webhookUrl). maxImpetus is the session budget — the studio drain-terminates at the cap.',
      auth: true,
      request: ProvisionStudioRequestSchema,
      response: StudioEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/studios',
      summary: "List the authenticated caller's LIVE hosted studios. A studio that has gone terminal (released, or its pod reaped) drops off this list and stays readable at GET /v1/studios/:id.",
      auth: true,
      response: StudiosListSchema,
    },
    {
      method: 'GET',
      path: '/studios/:id',
      summary: "Fetch one of the caller's studios by id (owner-scoped) — poll its status (provisioning → idle) after provisioning. Ownership is the only gate: a studio you host reads back in every state, terminated included, so an id GET /v1/me/status reports is addressable here. A studio you do not host returns not_found.studio, indistinguishable from an id with no studio behind it.",
      auth: true,
      response: StudioEnvelopeSchema,
    },
    {
      method: 'DELETE',
      path: '/studios/:id',
      summary: 'End the lease deliberately (owner-scoped, idempotent): terminate the pod, close the session. Double-DELETE returns the same terminal view, 200; a stranger gets not_found.studio.',
      auth: true,
      response: StudioEnvelopeSchema,
    },
]
