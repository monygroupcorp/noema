import type { JsonSchema, RouteSpec } from './types'

// ---------------------------------------------------------------------------
// Reusable schema fragments
// ---------------------------------------------------------------------------

/** The public `Run` projection (mirrors `types.ts#Run`). */
/** Where a run waiting for a warm pod stands in line — shared by the run and activity reads. */
export const QueuePlaceSchema: JsonSchema = {
  type: 'object',
  properties: {
    place: { type: 'number', description: "1-based position in the line, 1 being next." },
    depth: { type: 'number', description: 'How many runs are waiting on the same image, this one included.' },
  },
  required: ['place', 'depth'],
  description:
    'Where a run waiting for a warm pod stands in line. Present only while the run is ' +
    'queued — a run that dispatched straight onto a pod never carries it, and it is gone ' +
    'once the run is called forward. The line is per substrate image, not global.',
}

export const RunSchema: JsonSchema = {
  type: 'object',
  description: 'The public projection of a run (Actum). JSON-safe and stable.',
  properties: {
    id: { type: 'string', description: 'The run identifier.' },
    status: {
      type: 'string',
      enum: ['pending', 'running', 'complete', 'failed'],
      description: 'The run lifecycle status.',
    },
    modusId: { type: 'string', description: 'The flow (modus) this run executes.' },
    exitus: {
      type: 'object',
      additionalProperties: true,
      description: 'The outputs produced by the run — present only when available.',
    },
    failure: {
      type: 'object',
      description: 'Populated only when the run failed.',
      properties: {
        code: { type: 'string' },
        message: {
          type: 'string',
          description: 'The classified failure sentence — never raw internal text.',
        },
        stage: {
          type: 'string',
          enum: ['provision', 'ssh', 'bootstrap', 'download', 'execute'],
          description:
            "Where in the run's lifecycle it died. A closed enum carrying no free text, " +
            'so it is present for every caller. Absent when the recorded cause does not ' +
            'identify a stage — absent means the platform does not know, and the field ' +
            'never guesses. Branch on this rather than on `message` or `detail`.',
        },
        detail: {
          type: 'string',
          description:
            'OWNER-SCOPED: the recorded internal failure text, verbatim (GET /v1/runs/:id ' +
            'only). An operator artefact — pod ids, elapsed milliseconds, provider response ' +
            'bodies — provided so the payer can diagnose a run without a server log. ' +
            'Unstable by design: never parse it.',
        },
      },
      required: ['code', 'message'],
    },
    cost: { type: 'string', description: 'Impetus cost, serialised as a string.' },
    createdAt: {
      type: 'string',
      format: 'date-time',
      description: 'When the run started, as an ISO-8601 string.',
    },
    aditus: {
      type: 'object',
      additionalProperties: true,
      description:
        'OWNER-SCOPED: the stored effective input the run was cast with, echoed verbatim ' +
        '(including an unresolved "shuffle" seed sentinel if that\'s what was stored). ' +
        'Present only when populated.',
    },
    pinnedModels: {
      type: 'array',
      description: 'OWNER-SCOPED: the models pinned at cast time. Present only when populated.',
      items: { type: 'object', additionalProperties: true },
    },
    modusVersion: {
      type: 'string',
      description: 'OWNER-SCOPED: the cast-time modus version. Present only when populated.',
    },
    order: {
      type: 'object',
      additionalProperties: true,
      description:
        'The standing order this run belongs to, when it has one (training runs). See GET /v1/runs/:id/order.',
    },
    queue: QueuePlaceSchema,
  },
  required: ['id', 'status', 'modusId'],
}

export const RunOrderSchema: JsonSchema = {
  type: 'object',
  description: 'A standing order behind a run — the request, not the attempt.',
  properties: {
    id: { type: 'string', description: 'The order identifier.' },
    state: {
      type: 'string',
      enum: ['attempting', 'scheduled', 'fulfilled', 'stopped', 'cancelled'],
      description:
        'Where the request stands: an attempt running now (attempting), another one queued (scheduled), ' +
        'succeeded (fulfilled), ended without succeeding (stopped), or cancelled by the holder.',
    },
    reason: {
      type: 'string',
      enum: ['fulfilled', 'failed', 'exhausted', 'cancelled'],
      description: 'Why a terminal order ended. Absent while it is still live.',
    },
    attempts: { type: 'number', description: 'Attempts made so far, the first one included.' },
    attemptsRemaining: { type: 'number', description: 'Attempts the order may still make.' },
    nextAttemptAt: { type: 'string', format: 'date-time', description: 'When the next attempt is due, ISO-8601.' },
    until: { type: 'string', format: 'date-time', description: 'When the order stops trying regardless, ISO-8601.' },
    latestRunId: { type: 'string', description: 'The most recent attempt — the run to watch now.' },
  },
  required: ['id', 'state', 'attempts', 'attemptsRemaining'],
}

export const RunOrderEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { order: RunOrderSchema },
  required: ['order'],
}

export const RunEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { run: RunSchema },
  required: ['run'],
}

export const SettledRunSchema: JsonSchema = {
  type: 'object',
  description: 'A settled run in the owner\'s spend history. JSON-safe.',
  properties: {
    id: { type: 'string', description: 'The run (Actum) identifier.' },
    modusId: { type: 'string', description: 'The flow (modus) this run executed.' },
    modusLabel: { type: 'string', description: 'Human label of the modus at settle (falls back to modusId).' },
    status: { type: 'string', enum: ['settled'], description: 'Always "settled" — completus runs only.' },
    cost: { type: 'string', description: 'Impetus cost, serialised as a string.' },
    costUsd: { type: 'number', description: 'USD cost DERIVED on read (cost × IMPETUS_USD_RATE) — never a persisted FMV.' },
    settledAt: { type: 'string', format: 'date-time', description: 'When the run settled, ISO-8601.' },
    createdAt: { type: 'string', format: 'date-time', description: 'When the run started, ISO-8601.' },
  },
  required: ['id', 'modusId', 'modusLabel', 'status', 'cost', 'costUsd'],
}

export const RunsPageSchema: JsonSchema = {
  type: 'object',
  description: 'A page of settled spend history plus the owner\'s lifetime running total.',
  properties: {
    runs: { type: 'array', items: SettledRunSchema, description: 'Settled runs, newest first.' },
    nextCursor: { type: 'string', description: 'Opaque cursor for the next page; absent on the last page.' },
    runningTotal: {
      type: 'object',
      description: 'Lifetime spend across ALL settled runs (not just this page).',
      properties: {
        impetus: { type: 'string', description: 'Total impetus spent, serialised as a string.' },
        usd: { type: 'number', description: 'Total USD, derived at the platform reference rate.' },
      },
      required: ['impetus', 'usd'],
    },
  },
  required: ['runs', 'runningTotal'],
}

export const RunsRequestSchema: JsonSchema = {
  type: 'object',
  description:
    'Invoke a flow. Provide a target (one of modusId or verb) and the inputs (aditus). ' +
    'Anonymous callers may carry a `commitment`; web3 callers a `web3` bundle.',
  properties: {
    modusId: { type: 'string', description: 'Explicit flow id to run (wins over verb).' },
    verb: { type: 'string', description: 'A canon verb to resolve to a flow.' },
    aditus: {
      type: 'object',
      additionalProperties: true,
      description: "The flow's inputs, keyed per its input JSON-Schema (see GET /v1/flows/:id).",
    },
    pinnedModels: {
      type: 'array',
      description: 'Optional per-run model pins.',
      items: { type: 'object', additionalProperties: true },
    },
    computeStrategy: { type: 'string', description: 'Optional compute-strategy override.' },
    gpuClass: { type: 'string', description: 'Optional GPU-class override.' },
    maxImpetus: { type: 'string', description: 'Hard spend cap — admission refuses if the estimated reservation exceeds this value.' },
    studioId: { type: 'string', description: 'Target an existing warm studio (a Modo session) instead of cold-provisioning a pod.' },
    options: {
      type: 'object',
      description: 'Per-run observation options.',
      properties: {
        webhookUrl: {
          type: 'string',
          format: 'uri',
          description: 'Fire-and-forget completion POST target — receives the terminal run event.',
        },
      },
    },
    commitment: { type: 'string', description: 'Anonymous arcanum spend commitment (auth).' },
    web3: {
      type: 'object',
      description: 'A web3 signature bundle (auth).',
      properties: {
        address: { type: 'string' },
        signature: { type: 'string' },
        nonce: { type: 'string' },
      },
      required: ['address', 'signature', 'nonce'],
    },
  },
  required: ['aditus'],
}

export const runsCoreRoutes: RouteSpec[] = [
    {
      method: 'POST',
      path: '/runs',
      summary: 'Invoke a flow and return its run handle.',
      auth: true,
      request: RunsRequestSchema,
      response: RunEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/runs/:id',
      summary: 'Fetch a run by id (poll for completion).',
      auth: true,
      response: RunEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/runs/:id/cancel',
      summary:
        'Stop an in-flight run and settle it (owner-scoped, idempotent): the pod is terminated and the ' +
        'locked credits are released — the run is not charged. Returns the terminal run view, the same ' +
        'projection GET /v1/runs/:id returns; a cancelled run reads status "failed". Cancelling a run that ' +
        'has already settled returns that run unchanged, 200; a stranger gets not_found.run.',
      auth: true,
      response: RunEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/runs/:id/order',
      summary:
        'The standing order behind a run — the request, not the attempt. A training run that fails on ' +
        'infrastructure stays scheduled: the order attempts again hourly until it lands or its window ' +
        'closes. Returns { order: null } for a run that has none.',
      auth: true,
      response: RunOrderEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/runs/:id/order/revoke',
      summary:
        'Cancel the standing order behind a run — no further attempts will be made. Idempotent; the ' +
        'attempt already in flight is unaffected.',
      auth: true,
      response: RunOrderEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/runs/:id/stream',
      summary:
        'Server-Sent Events stream of run events (an initial snapshot, then progress/stage/complete/failed ' +
        'frames). Content-Type: text/event-stream; the stream ends on the terminal event.',
      auth: true,
    },
]
