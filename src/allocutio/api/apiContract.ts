// =============================================================================
// apiContract — the single declarative source of truth for the `/v1` surface.
// =============================================================================
//
// ONE source of truth (this file) → everything else is GENERATED from it:
// the OpenAPI document, the markdown reference, the served `GET /v1/openapi.json`.
// Hand-maintaining parallel copies is forbidden; a CI drift-check
// (`gen:api-docs` + `git diff --exit-code`) fails the build if the committed
// docs diverge from what this contract produces.
//
// Pure data — no behaviour, no I/O. The route handlers in `apiRouter.ts` are the
// runtime implementation of the operations described here; this file is their
// machine-readable description. Keep the two in lock-step: a route added/changed
// without updating this contract (and regenerating docs) breaks the gate.
//
// The DYNAMIC catalog (which flows/models exist) is deliberately NOT here — that
// is discovered live via `GET /v1/flows` / `GET /v1/flows/:id`. This contract
// describes only the STATIC surface: which operations exist + their I/O shapes.
// =============================================================================

/** A minimal JSON-Schema node — enough to describe the request/response bodies. */
export interface JsonSchema {
  type?: string
  format?: string
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: readonly string[]
  additionalProperties?: boolean | JsonSchema
  nullable?: boolean
  example?: unknown
}

/** One query-string parameter on a `RouteSpec`. */
export interface QueryParamSpec {
  name: string
  description: string
  schema: JsonSchema
  /** Defaults to false — most query params are optional filters. */
  required?: boolean
}

/** One HTTP operation on the `/v1` surface. */
export interface RouteSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** The path, RELATIVE to the `/v1` mount (e.g. `/runs`, `/runs/:id`). */
  path: string
  summary: string
  /** Whether a resolved caller identity (a credential) is required. */
  auth: boolean
  /** Query-string parameters this operation accepts, in addition to any path params. */
  query?: QueryParamSpec[]
  /** The request-body schema, when the operation takes one. */
  request?: JsonSchema
  /** The success-response schema. */
  response?: JsonSchema
}

/** One request-error the surface can return (mirrors `errors.ts`). */
export interface ErrorCodeSpec {
  code: string
  httpStatus: number
  retryable?: boolean
}

/** The declarative `/v1` contract: routes + the request-error taxonomy. */
export interface ApiContract {
  version: 'v1'
  routes: RouteSpec[]
  errorCodes: ErrorCodeSpec[]
}

// ---------------------------------------------------------------------------
// Reusable schema fragments
// ---------------------------------------------------------------------------

/** The public `Run` projection (mirrors `types.ts#Run`). */
const RunSchema: JsonSchema = {
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
        message: { type: 'string' },
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
  },
  required: ['id', 'status', 'modusId'],
}

/**
 * A standing order (mirrors `types.ts#RunOrder`): what the caller ASKED FOR, as distinct
 * from any one attempt at it. A training request survives an infrastructure failure — the
 * order keeps attempting, hourly, until it lands or its window closes.
 */
const RunOrderSchema: JsonSchema = {
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

/** The `{ order }` envelope returned by the order operations. `null` when the run has none. */
const RunOrderEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { order: RunOrderSchema },
  required: ['order'],
}

/** The `{ run }` envelope returned by the run operations. */
const RunEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { run: RunSchema },
  required: ['run'],
}

/** One row of settled spend history (mirrors `types.ts#SettledRun`). */
const SettledRunSchema: JsonSchema = {
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

/** The response for `GET /v1/me/runs` — a page of settled runs + the lifetime running total. */
const RunsPageSchema: JsonSchema = {
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

/** The door back to what one run produced — id references into the canonical asset stores. */
const ActivityDoorSchema: JsonSchema = {
  type: 'object',
  description: 'The way back to a run\'s artifact. Every field is optional; a field the run did not produce is absent.',
  properties: {
    modelId: { type: 'string', description: 'The registered model (Intella) id a training run produced.' },
    datasetId: { type: 'string', description: 'The dataset the run trained on, captioned, or decomposed.' },
    captionsetId: { type: 'string', description: 'The captionset the run produced or decomposed.' },
    mediaUrl: { type: 'string', description: 'First media URL among the run\'s outputs, when one is trivially present.' },
  },
}

/** One row of the owner's activity read. */
const ActivityRowSchema: JsonSchema = {
  type: 'object',
  description: 'One run in the owner\'s activity — in-flight or settled — with a door to its artifact.',
  properties: {
    actumId: { type: 'string', description: 'The run (Actum) identifier.' },
    kind: {
      type: 'string',
      enum: ['training', 'caption', 'decompose', 'generation'],
      description: 'What the run produced. Resolved from a modusId table; "generation" is the catch-all.',
    },
    modusId: { type: 'string', description: 'The flow (modus) the run executed.' },
    modusLabel: { type: 'string', description: 'Human label of the modus, when the index row carries one.' },
    status: { type: 'string', enum: ['running', 'settled'], description: 'In-flight, or settled successfully.' },
    createdAt: { type: 'string', format: 'date-time', description: 'When the run started, ISO-8601.' },
    settledAt: { type: 'string', format: 'date-time', description: 'When the run settled, ISO-8601. Absent while in flight.' },
    door: ActivityDoorSchema,
  },
  required: ['actumId', 'kind', 'modusId', 'status'],
}

/** The response for `GET /v1/me/activity` — a page of the owner's runs, newest first. */
const ActivityPageSchema: JsonSchema = {
  type: 'object',
  description: 'A page of the owner\'s activity: in-flight and settled runs merged newest-first.',
  properties: {
    activity: { type: 'array', items: ActivityRowSchema, description: 'Activity rows, newest first.' },
    nextCursor: { type: 'string', description: 'Opaque cursor for the next page of settled rows; absent on the last page.' },
  },
  required: ['activity'],
}

/** The request body for `POST /v1/runs`. */
const RunsRequestSchema: JsonSchema = {
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

/** A compact flow summary (mirrors `CrystalApi.FlowSummary`). */
const FlowSummarySchema: JsonSchema = {
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

/** The `{ flows }` envelope returned by `GET /v1/flows`. */
const FlowsListSchema: JsonSchema = {
  type: 'object',
  properties: {
    flows: { type: 'array', items: FlowSummarySchema },
  },
  required: ['flows'],
}

/** One flow's input/output description (mirrors `aditusToJsonSchema.FlowDescription`). */
const FlowDescriptionSchema: JsonSchema = {
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

/** The request body for `POST /v1/runs/quote`. */
const QuoteRequestSchema: JsonSchema = {
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

/** The response body for `POST /v1/runs/quote`. */
const QuoteResponseSchema: JsonSchema = {
  type: 'object',
  description: 'The estimated impetus cost for the run.',
  properties: {
    impetus: { type: 'string', description: 'Upper-bound reservation cost, serialised as a string.' },
  },
  required: ['impetus'],
}

/** One compute substrate entry (mirrors `CrystalApi.listFundamenta` item shape). */
const FundamentumCardSchema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    nomen: { type: 'string', description: 'Display label.' },
    versio: { type: 'string', description: 'Semantic version.' },
    runtime: { type: 'string', description: 'On-pod runtime (e.g. ComfyUI).' },
    imageId: { type: 'string', description: 'Docker image id.' },
    imageVersion: { type: 'string', description: 'Docker image version.' },
    vramGb: { type: 'number', description: 'Minimum VRAM in GB.' },
  },
  required: ['id', 'versio', 'imageId', 'imageVersion'],
}

/** The `{ fundamenta }` envelope returned by `GET /v1/fundamenta`. */
const FundamentaListSchema: JsonSchema = {
  type: 'object',
  properties: {
    fundamenta: { type: 'array', items: FundamentumCardSchema },
  },
  required: ['fundamenta'],
}

/** One model catalog card (mirrors `CrystalApi.ModelCard`). */
const ModelCardSchema: JsonSchema = {
  type: 'object',
  properties: {
    intellaId: { type: 'string' },
    nomen: { type: 'string', description: 'Display name.' },
    genus: { type: 'string', description: 'Weight class (lora, checkpoint, vae, …).' },
    basis: { type: 'string', description: 'Base model family this weight is compatible with.' },
    trigger: { type: 'string', description: 'Trigger words (LoRA only).' },
    description: { type: 'string', description: 'Human-readable description.' },
    access: { type: 'string', enum: ['public', 'private'], description: "Resolvability of the caller's own model (GET /me/models only)." },
    license: { type: 'string', description: "License id, e.g. 'apache-2.0' (owner/admin views)." },
    commercialUse: { type: 'string', enum: ['yes', 'no', 'conditional', 'unknown'], description: 'Whether this model may be promoted to the public (commercial) catalog (owner/admin views).' },
    slug: { type: 'string', description: 'ComfyUI LoRA filename token for explicit <lora:slug:weight> syntax (LoRA only).' },
    defaultWeight: { type: 'number', description: 'Recommended application weight when the caller does not specify one (LoRA only).' },
    samples: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, prompt: { type: 'string' } }, required: ['url'] }, description: 'Preview samples: image URL + the prompt it was rendered from.' },
    tags: { type: 'array', items: { type: 'object', properties: { tag: { type: 'string' }, source: { type: 'string' } }, required: ['tag'] }, description: 'Discovery/classification tags.' },
  },
  required: ['intellaId', 'nomen', 'genus'],
}

/** The `{ models }` envelope returned by `GET /v1/models`. */
const ModelsListSchema: JsonSchema = {
  type: 'object',
  properties: {
    models: { type: 'array', items: ModelCardSchema },
  },
  required: ['models'],
}

/** The `{ model }` envelope returned by `POST /v1/models/import`. */
const ModelImportResponseSchema: JsonSchema = {
  type: 'object',
  properties: {
    model: ModelCardSchema,
  },
  required: ['model'],
}

/** The request body for `POST /v1/models/import` (import a model/LoRA by URL). */
const ModelImportRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Import a model/LoRA by URL as a private, owner-scoped model — usable in your flows at once; never on the public catalogue until a separate publish promotion passes moderation.',
  properties: {
    url: { type: 'string', description: 'A Civitai page (or ?modelVersionId), a HuggingFace repo, or a direct .safetensors/.ckpt link.' },
    genus: { type: 'string', enum: ['lora', 'model'], description: 'For a direct-file URL where the origin can\'t be scraped to infer it. Default lora.' },
  },
  required: ['url'],
}

/** The request body for `PUT /v1/models/:id/license` (admin license clearance/backfill). */
const ModelLicenseRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Admin: set a model\'s license clearance so the public-catalog gate treats it correctly. Provide an explicit license/commercialUse, or reclassify:true to re-derive from the base string.',
  properties: {
    license: { type: 'string', description: "License id to record, e.g. 'apache-2.0', 'stability-community'." },
    commercialUse: { type: 'string', enum: ['yes', 'no', 'conditional', 'unknown'], description: 'The commercial-catalog verdict (the operator\'s clearance decision).' },
    reclassify: { type: 'boolean', description: "Re-derive license + verdict from the model's recorded base string (bulk-fix legacy imports)." },
  },
}

/** The request body for `POST /v1/flows` (save a reusable owner-keyed flow). */
const SaveFlowRequestSchema: JsonSchema = {
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

/** The response body for `POST /v1/flows`. */
const SaveFlowResponseSchema: JsonSchema = {
  type: 'object',
  description: 'The id of the newly created flow.',
  properties: { id: { type: 'string', description: 'The slug id of the saved flow.' } },
  required: ['id'],
}

/** The request body for `PUT /v1/me/bindings/:verb`. */
const BindRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Rebind a canon verb to a specific flow.',
  properties: { modusId: { type: 'string', description: 'The flow id to bind this verb to.' } },
  required: ['modusId'],
}

/** The response body for `PUT /v1/me/bindings/:verb`. */
const BindResponseSchema: JsonSchema = {
  type: 'object',
  description: 'The resulting verb → flow binding.',
  properties: {
    verb: { type: 'string', description: 'The verb that was rebound.' },
    modusId: { type: 'string', description: 'The flow it now resolves to.' },
  },
  required: ['verb', 'modusId'],
}

/** The response body for `GET /v1/me/status`. */
const StatusViewSchema: JsonSchema = {
  type: 'object',
  description: "The caller's account snapshot — balance, in-flight gens, studios.",
  properties: {
    balanceImpetus: { type: 'string', description: 'Spendable impetus balance, serialised as a string.' },
    balanceUsd: { type: 'number', description: 'USD-equivalent balance (informational).' },
    gens: { type: 'array', description: 'In-flight generation entries.', items: { type: 'object', additionalProperties: true } },
    studios: { type: 'array', description: 'Active studio entries.', items: { type: 'object', additionalProperties: true } },
    joinable: { type: 'array', description: 'Joinable studio invites.', items: { type: 'object', additionalProperties: true } },
    takenAt: { type: 'string', format: 'date-time', description: 'When the snapshot was taken.' },
  },
  required: ['balanceImpetus', 'balanceUsd', 'gens', 'studios', 'joinable', 'takenAt'],
}

/** The owner's presentation skin (Profile). */
const AppearanceSchema: JsonSchema = {
  type: 'object',
  description: "The owner's presentation skin — all fields optional.",
  properties: {
    avatarUrl: { type: 'string', description: 'PFP / avatar image URL.' },
    bannerUrl: { type: 'string', description: 'Banner image URL.' },
    backgroundUrl: { type: 'string', description: 'Background image URL.' },
    accent: { type: 'string', description: 'One signal color (hex).' },
    look: { type: 'string', description: "Signature look tag (e.g. 'clean' | 'n64' | 'vapor' | 'editorial')." },
  },
}

/** The owner's cross-cutting generation defaults (Preferences). */
const GeneratioSchema: JsonSchema = {
  type: 'object',
  description: "The owner's cross-cutting generation defaults, applied at cast time — all optional.",
  properties: {
    style: { type: 'string', description: 'Prepended to the prompt when the flow has a prompt input.' },
    negativePrompt: { type: 'string', description: "Fills a flow's negative-prompt input when the caller didn't provide one." },
    outputFormat: { type: 'string', description: 'Preferred output encoding (stored; runner-applied where supported).' },
    telegramDeliverAs: { type: 'string', enum: ['album', 'individual'], description: 'Telegram delivery shape (consumed by the Telegram adapter).' },
    autoApplyModels: { type: 'array', items: { type: 'string' }, description: 'Models (intellaId) to auto-apply as pinnedModels. Stored; cast-time application pending model resolution.' },
    defaultProjectId: { type: 'string', description: 'Default project (Provincia id) new work files into. Stored; cast-time auto-filing pending.' },
    spicyMode: { type: 'boolean', description: 'Adult ("spicy") mode. When ON — and an 18+ attestation is on file — permits adult-rated models, routes concierge chat to willing OpenRouter models, and relaxes SFW-forcing default negatives. Default-absent = OFF. Enabling requires a recorded 18+ attestation (POST /v1/me/attestation) — this PUT rejects with auth.forbidden otherwise.' },
    ageAttestation: {
      type: 'object',
      description: 'One-time self-declared 18+ attestation (a click-through fact, NOT KYC/ID verification). Required on file before spicyMode may be enabled. Recorded via POST /v1/me/attestation; preserved across a Preferences replace.',
      properties: { attestedAt: { type: 'number', description: 'Epoch-ms timestamp of the attestation.' } },
      required: ['attestedAt'],
    },
    privateOutputs: { type: 'boolean', description: 'Private generation. When ON, the outputs of NEW runs are written to a bucket with no public binding; the run record carries an opaque marker and an owner-scoped run read returns a short-lived expiring link instead. Default-absent = OFF (outputs are public). Forward-only: objects already written stay where they are. Requires the deployment to have a private-outputs bucket — this PUT rejects with internal.unavailable otherwise.' },
  },
}

/** The `{ attestation }` response for `POST /v1/me/attestation` — the recorded 18+ self-attestation. */
const AttestationResponseSchema: JsonSchema = {
  type: 'object',
  description: "The caller's recorded 18+ self-attestation (a click-through fact, not KYC).",
  properties: {
    attestation: {
      type: 'object',
      properties: { attestedAt: { type: 'number', description: 'Epoch-ms timestamp of the attestation.' } },
      required: ['attestedAt'],
    },
  },
  required: ['attestation'],
}

/** The response body for `GET /v1/me` — the caller's account settings. */
const SecretPresenceSchema: JsonSchema = {
  type: 'object',
  description: 'BYO gated-origin credential connect state, per provider.',
  properties: {
    civitai: { type: 'string', enum: ['connected', 'absent'], description: 'Civitai token connect state.' },
    huggingface: { type: 'string', enum: ['connected', 'absent'], description: 'HuggingFace token connect state.' },
  },
  required: ['civitai', 'huggingface'],
}

const MeViewSchema: JsonSchema = {
  type: 'object',
  description: "The caller's identity + balance + owner-keyed account settings — appearance + generation defaults + verb bindings.",
  properties: {
    animaId: { type: 'string', description: 'The caller\'s anima id, when identified. Absent for an anonymous/purse caller.' },
    username: { type: 'string', description: 'The caller\'s fiat username, when they authenticated with a password persona. Absent for wallet-only, telegram-only, or anonymous/purse callers.' },
    appearance: AppearanceSchema,
    generatio: GeneratioSchema,
    bindings: { type: 'array', items: BindResponseSchema, description: 'The verb→flow overrides the owner has set.' },
    secrets: SecretPresenceSchema,
    secretsAvailable: { type: 'boolean', description: 'Whether this deployment can store BYO secrets (a secret store is wired). false → connecting is unavailable here; hide/disable the panel.' },
    admin: { type: 'boolean', description: 'Whether this caller is the platform administrator (the moderation reviewer). Gates the feed-review surface + approve/reject/confirm-csam controls. true only on the platform session.' },
    balanceImpetus: { type: 'string', description: 'Spendable impetus balance, serialised as a string. Same source GET /v1/me/status reports.' },
    balanceUsd: { type: 'number', description: 'USD-equivalent balance (informational). Same source as GET /v1/me/status.' },
  },
  required: ['bindings', 'secrets', 'secretsAvailable', 'admin', 'balanceImpetus', 'balanceUsd'],
}

/** The request body for `PUT /v1/me/secrets/:provider`. */
const PutSecretRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Connect a BYO gated-origin credential. The token is sealed at rest at once and never echoed back.',
  properties: {
    token: { type: 'string', description: 'The provider API token/key (Civitai key or HuggingFace token).' },
    idleDays: { type: 'number', description: 'Idle-expiry window in days (default 90). The secret is forgotten after this long without a real use.' },
  },
  required: ['token'],
}

/** The response body for `PUT/DELETE /v1/me/secrets/:provider`. */
const SecretViewSchema: JsonSchema = {
  type: 'object',
  description: 'Connect/disconnect result. Never includes the token.',
  properties: {
    provider: { type: 'string', enum: ['civitai', 'huggingface'], description: 'The provider affected.' },
    status: { type: 'string', enum: ['connected', 'absent'], description: 'The resulting connect state.' },
    expiresAt: { type: 'string', description: 'Idle-expiry deadline (ISO) — present when connected.' },
    warning: { type: 'string', description: 'Deanonymization caution — present for anonymous (purse) callers.' },
  },
  required: ['provider', 'status'],
}

/** The `{ affines }` request/response for `GET/PUT /v1/me/affines/:modusId`. */
const AffinesEnvelopeSchema: JsonSchema = {
  type: 'object',
  description: "Per-flow input defaults (`{ inputKey: value }`) applied under the cast-time aditus.",
  properties: { affines: { type: 'object', additionalProperties: true, description: 'Input-key → default value map.' } },
  required: ['affines'],
}

/** The request body for `POST /v1/studios`. */
const ProvisionStudioRequestSchema: JsonSchema = {
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

/** One studio (leased or live) — the projection both /studios ops return. */
const StudioViewSchema: JsonSchema = {
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

/** The response body for `POST /v1/studios`. */
const StudioEnvelopeSchema: JsonSchema = {
  type: 'object',
  description: 'A newly leased studio.',
  properties: { studio: StudioViewSchema },
  required: ['studio'],
}

/** The response body for `GET /v1/studios`. */
const StudiosListSchema: JsonSchema = {
  type: 'object',
  description: "The caller's live studios.",
  properties: { studios: { type: 'array', items: StudioViewSchema } },
  required: ['studios'],
}

/** A single trait option within an axis (mirrors `collectio.ts#TraitValor`). */
const TraitValorSchema: JsonSchema = {
  type: 'object',
  description: 'One option within a trait axis.',
  properties: {
    value: { description: 'The aditus value injected when this option is selected.' },
    label: { type: 'string', description: 'Human-facing display name (falls back to String(value)).' },
    rarity: { type: 'number', description: 'Probability weight for weighted-random selection (default 0.5; higher = more common).' },
    promptFragment: { type: 'string', description: 'Text woven into the assembled prompt when this option wins.' },
    excludes: { type: 'array', items: { type: 'string' }, description: 'Labels in OTHER axes this option blocks.' },
    tags: { type: 'array', items: { type: 'string' }, description: 'Theme tags for group-level mutual exclusion.' },
  },
  required: ['value'],
}

/** One axis of variation in the parameter grid (mirrors `collectio.ts#Tractus`). */
const TractusSchema: JsonSchema = {
  type: 'object',
  description: 'One axis of variation — the aditus port to vary and its options.',
  properties: {
    porta: { type: 'string', description: 'The aditus port key this axis varies (e.g. background, outfit).' },
    label: { type: 'string', description: 'Human-facing category label (falls back to porta).' },
    valores: { type: 'array', items: TraitValorSchema, description: 'The options for this axis.' },
  },
  required: ['porta', 'valores'],
}

/** The request body for `POST /v1/collectiones`. */
const CollectRequestSchema: JsonSchema = {
  type: 'object',
  description:
    'Start a Collection — expand one flow over a Tractus[] parameter grid into `total` pieces. ' +
    'The base modus may be atomic or a compositus pipeline.',
  properties: {
    modusId: { type: 'string', description: 'The flow expanded across the grid. Required unless `draft: true` — a draft may be created without it and set it later via PATCH /v1/collectiones/:id/tractus.' },
    total: { type: 'number', description: 'Target number of pieces to generate. Required unless `draft: true` — a draft may be created without it and set it later via PATCH /v1/collectiones/:id/tractus.' },
    tractus: { type: 'array', items: TractusSchema, description: 'The axes of variation (the parameter grid). Required unless `draft: true` — a draft may be created without it and set it later via PATCH /v1/collectiones/:id/tractus.' },
    aditusBase: {
      type: 'object',
      additionalProperties: true,
      description: 'Base aditus applied to every piece (e.g. `_basePrompt` with `{{porta}}` tokens).',
    },
    concurrentia: { type: 'number', description: 'Max concurrent pieces in flight (default 3).' },
    nomen: { type: 'string', description: 'Optional human name for the collection.' },
    descriptio: { type: 'string', description: 'Optional working note on what this collection is.' },
    dna: { type: 'boolean', description: 'Opt-in DNA uniqueness — no two pieces share a trait combination (across non-bypassDNA axes). Default false.' },
    reviewEnabled: { type: 'boolean', description: 'Hold every completed piece for review before it counts toward the drop (approve/reject in curation). Omit → the platform default applies.' },
    draft: { type: 'boolean', description: 'Create as a DRAFT — author tractus (garden/rules) without firing. Start it later with POST /:id/fire. Omit/false → create + fire in one shot.' },
    teamId: { type: 'string', description: 'Own this collection by a team (Sodalitas) the caller is a member of — snapshots an equal-weight owners split.' },
  },
}

/** The request body for `PATCH /v1/collectiones/:id/tractus` (draft authoring). */
const PatchTractusRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Replace a draft Collection’s trait axes/values/rules, and (since a draft may now be created without them) its base flow + supply. Re-derives the provenance hash; rejected once the collection is fired. Omitted fields are left untouched.',
  properties: {
    tractus: { type: 'array', items: TractusSchema, description: 'The full new set of axes of variation (replaces the existing grid).' },
    modusId: { type: 'string', description: 'The draft’s base flow.' },
    numerus: { type: 'number', description: 'The draft’s target supply (piece count).' },
  },
}

/** The rarity-report response for `GET /v1/collectiones/:id/rarity`. */
const RarityReportSchema: JsonSchema = {
  type: 'object',
  description: 'Imagined (target) vs realized rarity per trait axis — drift is expected at low N.',
  properties: {
    totalPieces: { type: 'number', description: 'Produced pieces the realized figures are computed over.' },
    axes: {
      type: 'array',
      description: 'One entry per trait axis.',
      items: {
        type: 'object',
        properties: {
          trait_type: { type: 'string', description: 'The axis label (matches the NFT trait_type).' },
          valores: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                value: { type: 'string', description: 'The attribute value as stamped on pieces.' },
                targetRarity: { type: 'number', description: 'Target share: the weight normalised within its axis [0,1].' },
                realizedCount: { type: 'number', description: 'Produced pieces that got this value.' },
                realizedRarity: { type: 'number', description: 'realizedCount / totalPieces [0,1].' },
              },
              required: ['value', 'targetRarity', 'realizedCount', 'realizedRarity'],
            },
          },
        },
        required: ['trait_type', 'valores'],
      },
    },
  },
  required: ['totalPieces', 'axes'],
}

/** The `{ rarity }` envelope returned by `GET /v1/collectiones/:id/rarity`. */
const RarityEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { rarity: RarityReportSchema },
  required: ['rarity'],
}

/** The public `Collection` projection (mirrors `types.ts#Collection`). */
const CollectionSchema: JsonSchema = {
  type: 'object',
  description: 'The public projection of a Collectio (a generated collection / batch). JSON-safe and stable.',
  properties: {
    id: { type: 'string' },
    nomen: { type: 'string', description: 'The collection display name.' },
    status: {
      type: 'string',
      enum: ['draft', 'pending', 'running', 'complete', 'cancelled'],
      description: 'The collection lifecycle status. `draft` = authored but not yet fired (tractus still editable).',
    },
    modusId: { type: 'string', description: 'The flow (modus) expanded across the grid.' },
    total: { type: 'number', description: 'Target piece count (the size of the run).' },
    provenanceHash: { type: 'string', description: 'Content-address of the generative config (`sha256:<hex>`) — the NFT provenance hash.' },
    tractus: { type: 'array', items: TractusSchema, description: 'The trait axes + values (the parameter grid) — exposed for the garden/rules authoring surfaces. Frozen once fired.' },
    reviewEnabled: { type: 'boolean', description: 'Whether each piece is held for review before it counts.' },
    paused: { type: 'boolean', description: 'Dispatching new pieces is held (in-flight pieces still finish). Present + true only while paused. Survives a restart.' },
    owners: {
      type: 'array',
      description: 'Per-artifact ownership split (team-owned collections only) — weights sum to 1.',
      items: {
        type: 'object',
        properties: { animaId: { type: 'string' }, weight: { type: 'number' } },
        required: ['animaId', 'weight'],
      },
    },
    inFlight: { type: 'number', description: 'Pieces dispatched but not yet settled — provisioning or executing. Returned by the single-collection GET only (the run screen’s poll target), not by the list endpoint.' },
    pendingReview: { type: 'number', description: 'Pieces GENERATED and awaiting a reviewer’s decision. Real work that does not yet count toward `total`: approving one moves it to `completed`, rejecting one moves it to `rejected`. Always 0 when `reviewEnabled` is off.' },
    completed: { type: 'number', description: 'Pieces GENERATED AND ACCEPTED — approved by a reviewer when `reviewEnabled` is on, every successful generation when it is off. This is what counts toward `total`.' },
    failed: { type: 'number', description: 'Pieces that failed to generate so far.' },
    rejected: { type: 'number', description: 'Pieces a reviewer rejected so far — the piece generated, and a replacement is dispatched for it (distinct from failed).' },
    cost: { type: 'string', description: 'Total impetus across completed pieces, serialised as a string.' },
    createdAt: { type: 'string', format: 'date-time', description: 'When the collection started.' },
    completedAt: { type: 'string', format: 'date-time', description: 'When it finished (or was cancelled).' },
  },
  required: ['id', 'status', 'modusId', 'total', 'provenanceHash', 'completed', 'pendingReview', 'failed', 'rejected'],
}

/** The `{ collection }` envelope returned by the collection operations. */
const CollectionEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { collection: CollectionSchema },
  required: ['collection'],
}

/** One generated piece in the curation queue (`GET /v1/collectiones/:id/pieces`). */
const CollectionPieceSchema: JsonSchema = {
  type: 'object',
  description: "A generated collection piece — the Actum's output media + stamped attributes + review state.",
  properties: {
    actumId: { type: 'string', description: 'The piece Actum id (pass to approve/reject).' },
    review: { type: 'string', enum: ['pending', 'approved', 'rejected', 'none'], description: 'Review state (none = review not enabled).' },
    output: { type: 'object', additionalProperties: true, description: "The Actum's exitus (media URL under its declared Porta key)." },
    attributes: {
      type: 'array',
      description: 'The trait attributes stamped on this piece.',
      items: { type: 'object', properties: { trait_type: { type: 'string' }, value: { type: 'string' } }, required: ['trait_type', 'value'] },
    },
  },
  required: ['actumId', 'review'],
}

/** The `{ pieces }` envelope returned by `GET /v1/collectiones/:id/pieces`. */
const CollectionPiecesSchema: JsonSchema = {
  type: 'object',
  properties: { pieces: { type: 'array', items: CollectionPieceSchema } },
  required: ['pieces'],
}

/** The `{ collections }` envelope returned by `GET /v1/collectiones`. */
const CollectionsListSchema: JsonSchema = {
  type: 'object',
  properties: { collections: { type: 'array', items: CollectionSchema } },
  required: ['collections'],
}

/** The public `Team` projection (mirrors `types.ts#Team`). */
const TeamSchema: JsonSchema = {
  type: 'object',
  description: 'A team (Sodalitas) — a fellowship of Animae that co-owns work.',
  properties: {
    id: { type: 'string' },
    nomen: { type: 'string', description: 'The team display name.' },
    members: { type: 'array', items: { type: 'string' }, description: 'Member Anima ids (includes the founder).' },
    founder: { type: 'string', description: "The founder's Anima id." },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'nomen', 'members', 'founder', 'createdAt'],
}

/** The `{ team }` envelope returned by the single-team operations. */
const TeamEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { team: TeamSchema },
  required: ['team'],
}

/** The `{ teams }` envelope returned by `GET /v1/teams`. */
const TeamsListSchema: JsonSchema = {
  type: 'object',
  properties: { teams: { type: 'array', items: TeamSchema } },
  required: ['teams'],
}

/** The request body for `POST /v1/teams`. */
const CreateTeamRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Create a team. The caller becomes the founder and first member.',
  properties: {
    nomen: { type: 'string', description: 'The team display name.' },
    members: { type: 'array', items: { type: 'string' }, description: 'Additional member Anima ids to seed.' },
  },
  required: ['nomen'],
}

/** The request body for `POST /v1/teams/:id/members`. */
const AddMemberRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Add a member to a team.',
  properties: { animaId: { type: 'string', description: 'The Anima id to add.' } },
  required: ['animaId'],
}

/** A bare acknowledgement returned by the review operations. */
const OkSchema: JsonSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
}

// ── Projects (Provincia) ────────────────────────────────────────────────────────

/** The public `Project` projection (mirrors `types.ts#Project`). */
const ProjectSchema: JsonSchema = {
  type: 'object',
  description: 'A project (Provincia) — an account-owned workspace lens. Holdings are id references, never copies: filing an asset here does not change who may read that asset.',
  properties: {
    id: { type: 'string' },
    owner: { type: 'string', description: "The owning Anima id (the project's hard ownership boundary)." },
    name: { type: 'string', description: 'The project display name.' },
    desc: { type: 'string', description: 'Optional description.' },
    glyph: { type: 'string', description: 'Presentation glyph.' },
    color: { type: 'string', description: 'Presentation color.' },
    datasetIds: { type: 'array', items: { type: 'string' }, description: 'Filed dataset ids.' },
    modelIds: { type: 'array', items: { type: 'string' }, description: 'Filed model (Intella) ids.' },
    collectionIds: { type: 'array', items: { type: 'string' }, description: 'Filed collection ids.' },
    teamId: { type: 'string', description: 'Optional referenced Team (Sodalitas) id — every member of it may read the project and file assets into it. An overlay on the owner, not a second owner.' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'owner', 'name', 'datasetIds', 'modelIds', 'collectionIds', 'createdAt', 'updatedAt'],
}

/** The `{ project }` envelope returned by the single-project operations. */
const ProjectEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { project: ProjectSchema },
  required: ['project'],
}

/** The `{ projects }` envelope returned by `GET /v1/me/projects`. */
const ProjectsListSchema: JsonSchema = {
  type: 'object',
  properties: { projects: { type: 'array', items: ProjectSchema } },
  required: ['projects'],
}

/** The request body for `POST /v1/me/projects`. */
const CreateProjectRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Create a project owned by the caller.',
  properties: {
    name: { type: 'string', description: 'The project display name.' },
    desc: { type: 'string', description: 'Optional description.' },
    glyph: { type: 'string', description: 'Presentation glyph.' },
    color: { type: 'string', description: 'Presentation color.' },
    teamId: { type: 'string', description: 'Optional Team (Sodalitas) to reference for the shared member set.' },
  },
  required: ['name'],
}

/** The request body for `PATCH /v1/me/projects/:id`. */
const UpdateProjectRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Patch project metadata. Omitted fields are left unchanged; teamId null clears the reference.',
  properties: {
    name: { type: 'string' },
    desc: { type: 'string' },
    glyph: { type: 'string' },
    color: { type: 'string' },
    teamId: { type: 'string', description: 'Set/clear the referenced Team (Sodalitas).' },
  },
}

/** The request body for `POST /v1/me/projects/:id/holdings`. */
const FileAssetRequestSchema: JsonSchema = {
  type: 'object',
  description: 'File an asset reference into the project (idempotent).',
  properties: {
    kind: { type: 'string', enum: ['dataset', 'model', 'collection'], description: 'Which holding list.' },
    assetId: { type: 'string', description: "The asset's id." },
  },
  required: ['kind', 'assetId'],
}

// ── Tabulae (canvas workspaces, ADR-0008 follow-up) ───────────────────────────

/** A node placed on the canvas (`TabulaNodus`). */
const TabulaNodusSchema: JsonSchema = {
  type: 'object',
  description: 'A node placed on the canvas — references the Modus/Essentia it represents.',
  properties: {
    id: { type: 'string', description: "Unique within this Tabula's nodi." },
    modusId: { type: 'string', description: 'FK → Modus or Essentia this node represents.' },
    x: { type: 'number', description: 'Canvas x position.' },
    y: { type: 'number', description: 'Canvas y position.' },
    aditus: { type: 'object', description: "Per-node input overrides — become the published Modus's Porta.default values." },
  },
  required: ['id', 'modusId', 'x', 'y', 'aditus'],
}

/** A connection between two nodes on the canvas (`TabulaVinculum`). */
const TabulaVinculumSchema: JsonSchema = {
  type: 'object',
  description: 'A wire between two nodes — fonte (source) port → scopus (target) port.',
  properties: {
    id: { type: 'string' },
    fonteNodusId: { type: 'string', description: 'FK → TabulaNodus.id (source).' },
    fontePorta: { type: 'string', description: 'Output port name on the source node.' },
    scopusNodusId: { type: 'string', description: 'FK → TabulaNodus.id (target).' },
    scopusPorta: { type: 'string', description: 'Input port name on the target node.' },
    discordantia: { type: 'boolean', description: "True when the source/target port types don't match (flagged in the UI; publish rejects it)." },
  },
  required: ['id', 'fonteNodusId', 'fontePorta', 'scopusNodusId', 'scopusPorta', 'discordantia'],
}

/** The `Tabula` — a canvas workspace (mirrors `types/tabula.ts#Tabula`). */
const TabulaSchema: JsonSchema = {
  type: 'object',
  description: 'A canvas workspace — the authoring layer above a published Modus.',
  properties: {
    id: { type: 'string' },
    nomen: { type: 'string', description: "The workspace's title." },
    descriptio: { type: 'string', description: 'Optional description for the marketplace listing.' },
    auctor: { type: 'object', description: 'The owning identity — { animaId } | { commitment } | { bursaToken }.' },
    nodi: { type: 'array', items: TabulaNodusSchema },
    vincula: { type: 'array', items: TabulaVinculumSchema },
    modusId: { type: 'string', description: 'FK → Modus. Set once this Tabula has been published.' },
    status: { type: 'string', enum: ['draft', 'published', 'archivata'] },
    visibilitas: { type: 'string', enum: ['privata', 'communis', 'publica'] },
    fonteId: { type: 'string', description: 'FK → Tabula this workspace was forked from, if any.' },
    templateId: { type: 'string', description: 'FK → the master Tabula this workspace derives from, if any.' },
    followTemplate: { type: 'boolean' },
    natum: { type: 'string', format: 'date-time' },
    mutatum: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'nomen', 'auctor', 'nodi', 'vincula', 'status', 'visibilitas', 'natum', 'mutatum'],
}

/** The `{ tabula }` envelope returned by the single-Tabula operations. */
const TabulaEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { tabula: TabulaSchema },
  required: ['tabula'],
}

/** The `{ tabulae }` envelope returned by `GET /v1/tabulae`. */
const TabulaeListSchema: JsonSchema = {
  type: 'object',
  properties: { tabulae: { type: 'array', items: TabulaSchema } },
  required: ['tabulae'],
}

/** The request body for `POST /v1/tabulae`. */
const CreateTabulaRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Create a draft Tabula owned by the caller.',
  properties: {
    nomen: { type: 'string', description: "The workspace's title." },
    descriptio: { type: 'string' },
    visibilitas: { type: 'string', enum: ['privata', 'communis', 'publica'], description: "Defaults to 'privata'." },
  },
  required: ['nomen'],
}

/** The request body for `PUT /v1/tabulae/:id`. */
const UpdateTabulaRequestSchema: JsonSchema = {
  type: 'object',
  description: "Patch the Tabula's graph/metadata. Omitted fields are left unchanged.",
  properties: {
    nomen: { type: 'string' },
    descriptio: { type: 'string' },
    nodi: { type: 'array', items: TabulaNodusSchema },
    vincula: { type: 'array', items: TabulaVinculumSchema },
    visibilitas: { type: 'string', enum: ['privata', 'communis', 'publica'] },
  },
}

/** The response body for `POST /v1/tabulae/:id/publish`. */
const PublishTabulaResponseSchema: JsonSchema = {
  type: 'object',
  properties: { modusId: { type: 'string', description: 'The registered compositus Modus id — immediately runnable via POST /v1/runs.' } },
  required: ['modusId'],
}

/** The `{ flows }` envelope returned by `GET /v1/me/flows`. */
const MyFlowsListSchema: JsonSchema = {
  type: 'object',
  properties: { flows: { type: 'array', items: FlowSummarySchema } },
  required: ['flows'],
}

// ── Publishing (Editio) ───────────────────────────────────────────────────────

/** A reference to the canonical artifact an Editio puts forth. */
const ArtifactRefSchema: JsonSchema = {
  type: 'object',
  description: 'The canonical artifact being published (referenced, never copied).',
  properties: {
    kind: { type: 'string', enum: ['actum', 'intella', 'collectio'], description: 'Which artifact kind.' },
    id: { type: 'string', description: "The artifact's id." },
  },
  required: ['kind', 'id'],
}

/** The request body for `POST /v1/editiones`. */
const PublishRequestSchema: JsonSchema = {
  type: 'object',
  description:
    'Publish an artifact (an Actum for build-order #1) to a destination under a visibility/custody policy. ' +
    'Public surfaces (feed/marketplace) return a `pending` Edition and settle asynchronously through the ' +
    "moderation gate. Unspecified fields default from the caller's Anima publishing prefs.",
  properties: {
    artifact: ArtifactRefSchema,
    destination: { type: 'string', description: "Adapter key (e.g. 'feed'). Defaults from prefs, then 'feed'." },
    visibility: { type: 'string', enum: ['private', 'unlisted', 'feed', 'marketplace'], description: 'Public-exposure surface.' },
    custody: { type: 'string', enum: ['ours', 'theirs', 'both'], description: 'Who holds the bytes/metadata.' },
    license: { type: 'string', description: "License tag — 'catalog' (our liability) | a BYO license id. Defaults from prefs, then 'catalog' for platform-canonical artifacts." },
    teamId: { type: 'string', description: 'Snapshot an equal-weight rights split from a team (Sodalitas) the caller is a member of. Mutually exclusive with owners.' },
    owners: {
      type: 'array',
      description: 'Explicit rights split — animaId → weight, weights must sum to 1. Mutually exclusive with teamId. Snapshotted on the Editio as the canonical who-earns record (drives the model-royalty split).',
      items: { type: 'object', properties: { animaId: { type: 'string' }, weight: { type: 'number' } }, required: ['animaId', 'weight'] },
    },
  },
  required: ['artifact'],
}

/** The public `Edition` projection (mirrors `types.ts#Edition`). */
const EditionSchema: JsonSchema = {
  type: 'object',
  description: 'The public projection of an Editio — a publication record referencing a canonical artifact.',
  properties: {
    id: { type: 'string' },
    artifact: ArtifactRefSchema,
    destination: { type: 'string', description: "Adapter key — 'feed' | 'r2' | 'huggingface' | 'mint' | …" },
    visibility: { type: 'string', enum: ['private', 'unlisted', 'feed', 'marketplace'] },
    custody: { type: 'string', enum: ['ours', 'theirs', 'both'] },
    status: { type: 'string', enum: ['pending', 'published', 'rejected', 'failed', 'retracted'], description: 'Lifecycle: pending → published | rejected | failed; retracted on unpublish.' },
    reviewOutcome: { type: 'string', enum: ['pending', 'approved', 'rejected'], description: 'Human-review outcome when the moderation gate held this publication: pending (awaiting a reviewer) | approved (cleared → publishes) | rejected. Absent on the normal path.' },
    externalRef: { type: 'string', description: "The destination's handle — feed post id / HF repo / token id / R2 url." },
    owners: {
      type: 'array',
      description: 'Rights split snapshot (team-owned only) — weights sum to ~1.',
      items: { type: 'object', properties: { animaId: { type: 'string' }, weight: { type: 'number' } }, required: ['animaId', 'weight'] },
    },
    license: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'artifact', 'destination', 'visibility', 'custody', 'status', 'createdAt', 'updatedAt'],
}

/** The `{ edition }` envelope returned by the publish operations. */
const EditionEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { edition: EditionSchema },
  required: ['edition'],
}

/** The `{ editions }` envelope returned by the review queue. */
const EditionListEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { editions: { type: 'array', items: EditionSchema } },
  required: ['editions'],
}

/** One entry in the public feed (`GET /v1/feed`). */
const FeedItemSchema: JsonSchema = {
  type: 'object',
  description: "A published feed entry — the Editio plus the referenced artifact's produced output.",
  properties: {
    editionId: { type: 'string', description: 'The Editio id (the feed entry id).' },
    artifact: ArtifactRefSchema,
    output: { type: 'object', additionalProperties: true, description: "The artifact's produced output (an Actum's exitus media), when resolvable." },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['editionId', 'artifact', 'createdAt'],
}

/** The `{ feed }` envelope returned by `GET /v1/feed`. */
const FeedListSchema: JsonSchema = {
  type: 'object',
  properties: { feed: { type: 'array', items: FeedItemSchema } },
  required: ['feed'],
}

/** The error envelope every failed request carries (mirrors `errors.ts#ApiErrorBody`). */
const ErrorEnvelopeSchema: JsonSchema = {
  type: 'object',
  description: 'The uniform request-error envelope.',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'A stable `category.specific` code to branch on.' },
        message: { type: 'string' },
        retryable: { type: 'boolean', description: 'Whether the same call may succeed if retried.' },
        retryAfter: { type: 'number', description: 'Suggested back-off in seconds.' },
        details: { type: 'object', additionalProperties: true },
      },
      required: ['code', 'message'],
    },
  },
  required: ['error'],
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

const DepositConfigSchema: JsonSchema = {
  type: 'object',
  description: 'Static config for the buy-credits/deposit UI.',
  properties: {
    depositAddress: { type: 'string', description: 'CreditVault address to send deposits to (same on mainnet + Base).' },
    pointsPerUsd: { type: 'number', description: 'Canonical impetus points per 1 USD (≈ 2967).' },
    defaultFundingRatePct: { type: 'number', description: 'Default funding rate as a percent (70 = 70% of USD value converts to points).' },
    chains: { type: 'array', description: 'Supported chains.', items: { type: 'object', properties: { chainId: { type: 'number' }, name: { type: 'string' } } } },
  },
  required: ['depositAddress', 'pointsPerUsd', 'defaultFundingRatePct', 'chains'],
}
const DepositQuoteRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Quote how many impetus points a deposit would buy, right now (informational; the on-chain credit is authoritative and equal).',
  properties: {
    chainId: { type: 'string', description: "Chain id ('1' mainnet, '8453' Base)." },
    token: { type: 'string', description: 'Token address; 0x000…000 for native ETH.' },
    amount: { type: 'string', description: 'Deposit amount in RAW base units (wei for ETH, token-decimals for ERC-20), as a string.' },
  },
  required: ['chainId', 'token', 'amount'],
}
const DepositQuoteResponseSchema: JsonSchema = {
  type: 'object',
  description: 'The points a deposit would be credited (== what the webhook credits for the same input). Gas is NOT deducted.',
  properties: {
    chainId: { type: 'string' },
    token: { type: 'string' },
    amountRaw: { type: 'string', description: 'Echoed raw base units quoted.' },
    grossUsd: { type: 'string', description: 'Gross USD FMV, formatted (e.g. "3.000000").' },
    grossUsdMicro: { type: 'string', description: 'Exact gross USD FMV in micro-USD.' },
    fundingRatePct: { type: 'number', description: 'Per-asset funding rate applied (e.g. 70).' },
    pointsQuoted: { type: 'string', description: 'Impetus points the deposit would be credited.' },
    depositAddress: { type: 'string' },
  },
  required: ['pointsQuoted', 'grossUsd', 'fundingRatePct', 'depositAddress'],
}

const MyDepositsResponseSchema: JsonSchema = {
  type: 'object',
  description: "The authenticated caller's own on-chain deposits, scoped to their linked wallets — real depositum status for the settle-watch UI.",
  properties: {
    deposits: {
      type: 'array',
      description: 'Newest-first.',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          chainId: { type: 'string' },
          txHash: { type: 'string', description: 'On-chain transaction hash.' },
          valor: { type: 'string', description: 'Amount in base units (wei / token-decimals), as a string.' },
          status: { type: 'string', enum: ['detectum', 'confirmatum', 'processatum', 'praesolutum', 'fractum'], description: 'detectum (seen) · confirmatum (confirmed, awaiting/parked credit) · processatum (credited) · praesolutum (settled on the pre-cutover plane — recorded here, never credited here) · fractum (failed).' },
          natum: { type: 'string', format: 'date-time', description: 'When the deposit was first detected.' },
        },
        required: ['id', 'chainId', 'txHash', 'valor', 'status', 'natum'],
      },
    },
  },
  required: ['deposits'],
}

const CheckoutRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Buy a fixed credit pack with fiat via Stripe Checkout. The pack is server-authoritative: the impetus credited is the pack constant, never a client-supplied figure. Requires an identified account (a card de-anonymizes; an anon purse is rejected).',
  properties: {
    packId: {
      type: 'string',
      enum: ['starter_10', 'standard_25', 'plus_50', 'studio_100'],
      description: 'The credit pack SKU to purchase. Fixed USD price → fixed impetus (starter_10 $10→30,000; standard_25 $25→82,500; plus_50 $50→180,000; studio_100 $100→390,000). No funding haircut.',
    },
    successUrl: { type: 'string', description: 'Optional redirect URL on completed payment; falls back to the server default.' },
    cancelUrl: { type: 'string', description: 'Optional redirect URL on abandoned checkout; falls back to the server default.' },
  },
  required: ['packId'],
}
const CheckoutResponseSchema: JsonSchema = {
  type: 'object',
  description: 'The hosted Stripe Checkout session to redirect the caller to. Credit is applied only later, by the signature-verified webhook, when the payment completes.',
  properties: {
    url: { type: 'string', description: 'The Stripe-hosted checkout URL to redirect the caller to.' },
    sessionId: { type: 'string', description: 'The Stripe Checkout Session id.' },
  },
  required: ['url', 'sessionId'],
}

const RevenueReportSchema: JsonSchema = {
  type: 'object',
  description: 'Admin revenue report: company-wide trailing-12mo USD revenue vs the tightest active conditional-license cap (the tripwire, ADR-0012/0013 §5).',
  properties: {
    asOf: { type: 'string', description: 'ISO timestamp the trailing window was computed against.' },
    trailingUsdRevenueMicro: { type: 'string', description: 'Trailing-12mo USD revenue in micro-USD (exact).' },
    trailingUsdRevenue: { type: 'string', description: 'Trailing-12mo USD revenue, formatted.' },
    band: { type: 'string', enum: ['clear', 'watch', 'warn', 'breach'], description: 'Live band of revenue against the binding cap.' },
    bindingCapUsd: { type: 'number', nullable: true, description: 'Tightest active conditional cap (whole USD), or null when dormant.' },
    activeConditionalLicenses: { type: 'array', items: { type: 'string' }, description: 'Conditional license ids currently reachable in the public catalog.' },
    lastAlertedBand: { type: 'string', enum: ['clear', 'watch', 'warn', 'breach'], nullable: true, description: 'The last band the scheduled evaluator alerted/persisted.' },
  },
  required: ['asOf', 'trailingUsdRevenue', 'band', 'activeConditionalLicenses'],
}

/** One caption pass over (some or all of) a dataset's media (mirrors `types/dataset.ts#Captionset`). */
const CaptionsetSchema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    method: { type: 'string', description: "How the captions were produced, e.g. 'Florence-2', 'WD14', 'manual'." },
    coverage: { type: 'string', description: 'How much of the media this pass covers, e.g. "12/12". Derived server-side from the captions present over the media count; a coverage supplied by the caller is ignored.' },
    captions: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Caption text per media item, keyed by media id (never by position — media is append-only). Sparse: a media item with no caption in this pass has no key. Absent on captionsets written before this field existed.',
    },
  },
  required: ['id', 'name', 'method', 'coverage'],
}

/** The request body for `POST /v1/data/datasets/:id/captionsets`. */
const AddCaptionsetRequestSchema: JsonSchema = {
  type: 'object',
  description:
    'Attach a caption pass to a dataset. A captionset already carrying this id is replaced rather ' +
    'than duplicated, so re-running a caption pass converges instead of accumulating. `coverage` is ' +
    'derived server-side and is not read from this body.',
  properties: {
    id: { type: 'string', description: 'Caption-pass id. Re-using an existing id replaces that captionset.' },
    name: { type: 'string' },
    method: { type: 'string', description: "How the captions were produced, e.g. 'Florence-2', 'WD14', 'manual'." },
    captions: {
      type: 'object',
      additionalProperties: { type: 'string' },
      description: 'Caption text keyed by media id. Every key must be a media item on this dataset; every value must be non-empty.',
    },
  },
  required: ['id', 'name', 'method'],
}

/** The request body for `PATCH /v1/data/datasets/:id/captionsets/:captionsetId/captions/:mediaId`. */
const SetCaptionRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Replace the caption text for one media item within one caption pass.',
  properties: {
    caption: { type: 'string', description: 'The new caption text. Non-empty.' },
  },
  required: ['caption'],
}

/** One media item in a dataset (mirrors `types/dataset.ts#DatasetMediaItem`). */
const DatasetMediaItemSchema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    url: {
      type: 'string',
      description:
        'Fetchable URL for this media item. Media produced by a run with private outputs is stored as a durable reference and resolved on every read into a short-lived presigned link, so this field is always fetchable and never needs presigning by the caller. Treat it as expiring: re-read the dataset rather than persisting the link.',
    },
    source: { type: 'string', enum: ['upload', 'generation'] },
    actumId: { type: 'string', description: "FK -> Actum. Present iff source === 'generation'." },
    addedAt: { type: 'string', format: 'date-time' },
    addedBy: {
      type: 'string',
      description:
        'FK -> Anima. Who added this item — the contributor. Resolved from the authenticated caller at ingestion, never from the request body. Absent on items written before attribution was recorded.',
    },
  },
  required: ['id', 'url', 'source', 'addedAt'],
}

/** One media-set snapshot (mirrors `types/dataset.ts#DatasetVersion`). */
const DatasetVersionSchema: JsonSchema = {
  type: 'object',
  properties: {
    v: { type: 'string' },
    count: { type: 'number' },
    when: { type: 'string', format: 'date-time' },
  },
  required: ['v', 'count', 'when'],
}

/** The FULL rich Dataset shape (mirrors `types/dataset.ts#Dataset`). */
const DatasetSchema: JsonSchema = {
  type: 'object',
  description: 'A training dataset: media + captionsets + versions. The training-data primitive.',
  properties: {
    id: { type: 'string' },
    owner: { type: 'string', description: 'FK -> Anima, the owning identity.' },
    sodalitasId: {
      type: 'string',
      description:
        'FK -> Sodalitas (the Team this dataset is shared with, set as teamId at creation). Every member may read it and contribute to it — append media, attach or edit captionsets. An overlay, not a second owner: archiving and restoring the dataset or one of its media items stay with owner. Absent means owner-only.',
    },
    access: {
      type: 'object',
      description:
        "Single-axis access. { kind: 'public' } makes the dataset readable and usable (e.g. as a Muse session's mother) by anyone — see GET /v1/data/datasets/public. It is a READ grant only: appending media, attaching or editing a captionset still require ownership or team membership regardless of access. Absent means owner-only (plus sodalitasId's team, if set).",
      properties: {
        kind: { type: 'string', enum: ['public', 'private'] },
      },
    },
    name: { type: 'string' },
    modality: { type: 'string', enum: ['image', 'video', 'audio', '3d'] },
    custody: { type: 'string', enum: ['sealed', 'local', 'remote'] },
    media: { type: 'array', items: DatasetMediaItemSchema },
    captionsets: { type: 'array', items: CaptionsetSchema },
    versions: { type: 'array', items: DatasetVersionSchema },
    natum: { type: 'string', format: 'date-time' },
    mutatum: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'owner', 'name', 'modality', 'custody', 'media', 'captionsets', 'versions', 'natum', 'mutatum'],
}

/** The thin DatasetSummary projection (mirrors `types/dataset.ts#DatasetSummary` /
 *  `lib/api.ts`'s existing client-side `DatasetSummary`). */
const DatasetSummarySchema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    images: { type: 'number' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'name'],
}

/** The `{ datasets, nextCursor? }` envelope returned by both dataset list operations. */
const DatasetsListSchema: JsonSchema = {
  type: 'object',
  properties: {
    datasets: { type: 'array', items: DatasetSchema },
    nextCursor: { type: 'string', description: 'Opaque cursor for the next page; absent on the last page.' },
  },
  required: ['datasets'],
}

const DatasetSummariesListSchema: JsonSchema = {
  type: 'object',
  properties: {
    datasets: { type: 'array', items: DatasetSummarySchema },
    nextCursor: { type: 'string', description: 'Opaque cursor for the next page; absent on the last page.' },
  },
  required: ['datasets'],
}

/** The request body for `POST /v1/data/datasets` — the two v1 ingestion paths (Q2), or neither
 *  (an empty dataset, populated afterwards through the append route). */
const CreateDatasetRequestSchema: JsonSchema = {
  type: 'object',
  description:
    "Create a Dataset. `source: 'upload'` ingests media already dropped via " +
    "`POST /storage/uploads/sign` (mediaUrls); `source: 'generation'` seeds media from the " +
    "caller's own completed Acta (actumIds). Omit `source` to create the dataset EMPTY and add " +
    'media afterwards through `POST /v1/data/datasets/:id/media`; mediaUrls or actumIds ' +
    'supplied without a source are rejected. A source naming neither path is rejected, as is a ' +
    'declared source whose media list is empty. ' +
    'An optional `teamId` shares the dataset with a Team (Sodalitas) the caller belongs to.',
  properties: {
    source: {
      type: 'string',
      enum: ['upload', 'generation'],
      description: 'Omit to create an empty dataset.',
    },
    name: { type: 'string' },
    modality: { type: 'string', enum: ['image', 'video', 'audio', '3d'] },
    custody: { type: 'string', enum: ['sealed', 'local', 'remote'], description: 'Defaults to local.' },
    teamId: {
      type: 'string',
      description:
        'Share the dataset with a Team (Sodalitas) the caller is a member of — every member may then read it and contribute to it. Stored on the dataset as sodalitasId. A team the caller does not belong to is reported as not found.',
    },
    mediaUrls: { type: 'array', items: { type: 'string' }, description: "Required and non-empty when source === 'upload'." },
    actumIds: { type: 'array', items: { type: 'string' }, description: "Required and non-empty when source === 'generation'." },
  },
  required: ['name', 'modality'],
}

/** The request body for `POST /v1/data/datasets/:id/media` — the same discriminated ingestion
 *  shape as creation, minus the fields that describe the dataset itself. */
const AddDatasetMediaRequestSchema: JsonSchema = {
  type: 'object',
  description:
    "Append media to an existing dataset. Same two ingestion paths as creation: `source: " +
    "'upload'` takes media already dropped via `POST /storage/uploads/sign` (mediaUrls), " +
    "`source: 'generation'` resolves media from the caller's own completed Acta (actumIds). " +
    'Append-only — the supplied items are added after the media already present, and nothing ' +
    'existing is replaced, reordered or removed.',
  properties: {
    source: { type: 'string', enum: ['upload', 'generation'] },
    mediaUrls: { type: 'array', items: { type: 'string' }, description: "Required when source === 'upload'." },
    actumIds: { type: 'array', items: { type: 'string' }, description: "Required when source === 'generation'." },
  },
  required: ['source'],
}

/** The `{ dataset }` envelope returned by `POST /v1/data/datasets`. */
const DatasetEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { dataset: DatasetSchema },
  required: ['dataset'],
}

// ---------------------------------------------------------------------------
// Muse sessions — a dataset break-off with its own floor and piece ledger
// ---------------------------------------------------------------------------

/** One categorized prompt fragment (mirrors `crystal/muse/taxonomy.ts#Fragment`). */
const MuseFragmentSchema: JsonSchema = {
  type: 'object',
  description: 'A categorized, reusable prompt fragment lifted from a caption.',
  properties: {
    category: { type: 'string', description: 'Which slot the fragment fills (subject, style, lighting, …).' },
    text: { type: 'string', description: 'The fragment itself — a short, prompt-ready phrase.' },
    source: { type: 'string', description: 'The moodboard entry it came from.' },
    trigger: { type: 'string', description: 'The model binding for that source (e.g. a LoRA trigger word).' },
  },
  required: ['category', 'text', 'source', 'trigger'],
}

/** One fragment's floor state. */
const MuseFloorEntrySchema: JsonSchema = {
  type: 'object',
  description:
    "A fragment's state on the session floor. The floor is an ARRAY of entries rather than an " +
    'object keyed by fragment: a fragment identity is `category:text`, which is free text and is ' +
    'not usable as a field name.',
  properties: {
    key: { type: 'string', description: "The fragment's stable identity: its category and its text." },
    enabled: { type: 'boolean', description: 'False takes the fragment out of the draw while leaving it on the floor.' },
    weight: { type: 'number', description: 'Draw weight against its pool-mates, clamped server-side to the sampler bounds.' },
  },
  required: ['key', 'enabled', 'weight'],
}

/** One recorded piece and the lineage that produced it. */
const MusePieceSchema: JsonSchema = {
  type: 'object',
  description: 'A piece the session produced, with the fragments that produced it.',
  properties: {
    runId: { type: 'string', description: 'The run that produced the piece.' },
    rollIndex: { type: 'number', description: 'Which roll of the session this was.' },
    fragments: { type: 'array', items: MuseFragmentSchema, description: 'The lineage — one fragment per category the roll filled.' },
    reaction: { type: 'string', enum: ['up', 'down', 'note'], description: 'What the user said about the piece, if anything.' },
    saved: { type: 'boolean', description: 'Whether the piece has been put back into the set — its media is in the session\'s own dataset.' },
    dismissed: { type: 'boolean' },
  },
  required: ['runId', 'rollIndex', 'fragments', 'saved', 'dismissed'],
}

/** One model on a session's stored stack. */
const MuseNozzleEntrySchema: JsonSchema = {
  type: 'object',
  description:
    'One model on the stored stack. The name rides alongside the id because it is what a resume has ' +
    "left to say with when the model is no longer offered. An absent weight means the model's own " +
    'default, which is what a bare trigger word means to the resolver.',
  properties: {
    intellaId: { type: 'string', description: 'FK -> Intella, the model itself.' },
    nomen: { type: 'string', description: "The model's name, as it stood when the stack was committed." },
    trigger: { type: 'string', description: 'The trigger word that applies the model.' },
    weight: { type: 'number', description: "An explicit weight. Absent for the model's own default." },
  },
  required: ['intellaId', 'nomen', 'trigger'],
}

/** What a session fires its draw through. */
const MuseSetupSchema: JsonSchema = {
  type: 'object',
  description:
    'What the session fires its draw THROUGH: the flow, the run shape, the model stack and the ' +
    'standing affix. Held on the session so a returning client comes back to the engine it assembled ' +
    'rather than to a default one. Every field is optional — a setup is assembled one control at a ' +
    'time. It carries NO acknowledgement of the infinite-mode disclosure and no view state: an ' +
    'acknowledgement is consent for one sitting, so this shape has no field for it and a request body ' +
    'carrying one is stored without it.',
  properties: {
    modusId: { type: 'string', description: 'FK -> Modus, the flow the session fires at.' },
    mode: { type: 'string', enum: ['batched', 'infinite'], description: 'A fixed number of pieces, or until it is stopped.' },
    cap: { type: 'number', description: 'Batched only: how many pieces one launch fires. At least 1.' },
    nozzle: { type: 'array', items: MuseNozzleEntrySchema, description: 'The model stack, in the order it was stacked.' },
    prefix: { type: 'string', description: 'The standing instruction that leads every prompt fired on this nozzle.' },
    suffix: { type: 'string', description: 'The standing instruction that trails every prompt fired on this nozzle.' },
  },
}

/** One roll the caller kept: the prompt as it stood, and its paid/free verdict. */
const MuseKeptRollSchema: JsonSchema = {
  type: 'object',
  description:
    'A rolled prompt the caller kept. The verdict rides along because it is not recoverable ' +
    'afterwards — whether a prompt fires as a paid run is decided by what it drew and what it ' +
    'was rolled against, and both move.',
  properties: {
    prompt: { type: 'string', description: 'The prompt as it was kept, edits included.' },
    paid: { type: 'boolean', description: 'Whether firing this prompt would be a paid run.' },
  },
  required: ['prompt', 'paid'],
}

/** The request body for `POST /v1/data/muse/sessions/:id/kept`. */
const KeepMuseRollRequestSchema: JsonSchema = {
  type: 'object',
  description:
    'Keep one rolled prompt against the session. Append-only: keeping the same prompt twice ' +
    'stores it twice, because keeping is an explicit act and collapsing two of them would ' +
    'discard one the caller made on purpose. Nothing is spent on this call — the prompt is ' +
    'kept, not fired.',
  properties: {
    prompt: { type: 'string', description: 'The prompt to keep. Required and non-empty.' },
    paid: { type: 'boolean', description: 'Whether firing this prompt would be a paid run.' },
  },
  required: ['prompt', 'paid'],
}

/** A Muse session as this surface returns it. */
const MuseSessionSchema: JsonSchema = {
  type: 'object',
  description:
    'A Muse session: a break-off of a dataset with its own copies of that dataset\'s fragments, ' +
    'its own floor, and its own piece ledger. The mother dataset is the starter and is never ' +
    'written to by the session.',
  properties: {
    id: { type: 'string' },
    owner: { type: 'string', description: 'FK -> Anima, the owning identity.' },
    motherDatasetId: { type: 'string', description: 'FK -> Dataset, the dataset the session broke off from.' },
    sessionDatasetId: { type: 'string', description: "FK -> Dataset, the session's own dataset — where the pieces saved out of this session land. Absent until the first save mints it." },
    fragments: { type: 'array', items: MuseFragmentSchema, description: 'Every fragment on the floor, in display order.' },
    floor: { type: 'array', items: MuseFloorEntrySchema },
    pieces: { type: 'array', items: MusePieceSchema },
    setup: MuseSetupSchema,
    keptRolls: {
      type: 'array',
      items: MuseKeptRollSchema,
      description:
        'The rolls the caller kept, in the order they kept them. Always present: a session that ' +
        'has kept none returns an empty list.',
    },
    natum: { type: 'string', format: 'date-time' },
    mutatum: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'owner', 'motherDatasetId', 'fragments', 'floor', 'pieces', 'keptRolls', 'natum', 'mutatum'],
}

/** The `{ session }` envelope every single-session operation returns. */
const MuseSessionEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { session: MuseSessionSchema },
  required: ['session'],
}

/** The `{ sessions }` envelope the session lookup returns. */
const MuseSessionListEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: {
    sessions: {
      type: 'array',
      items: MuseSessionSchema,
      description: 'The caller\'s own sessions off the named dataset, most recently changed first.',
    },
  },
  required: ['sessions'],
}

/** One proposed change: a fragment named by its identity. */
const MuseFragmentIdentitySchema: JsonSchema = {
  type: 'object',
  description: 'A fragment named by its identity — the same `{ category, text }` pair the floor routes take.',
  properties: {
    category: { type: 'string', description: "The fragment's category." },
    text: { type: 'string', description: "The fragment's text." },
  },
  required: ['category', 'text'],
}

/** What a steer proposes — and only proposes. */
const SteerProposalSchema: JsonSchema = {
  type: 'object',
  description:
    'A proposed change to the floor. NOTHING IN IT HAS BEEN APPLIED: each entry is offered for ' +
    'approval and any of them may be rejected. The floor moves only when the accepted parts are ' +
    'sent to the floor routes. The proposal is not stored — it lives for as long as it is being ' +
    'reviewed, and the floor is the durable object.',
  properties: {
    eliminations: {
      type: 'array',
      items: MuseFragmentIdentitySchema,
      description: 'Fragments proposed for removal from the draw. Every one is on the floor as it stands.',
    },
    additions: {
      type: 'array',
      items: MuseFragmentSchema,
      description: 'Fragments proposed for the floor. Every one is in the taxonomy and new to the floor.',
    },
    dropped: {
      type: 'number',
      description:
        'How many proposed changes did not survive validation — an elimination naming a fragment ' +
        'the floor does not hold, an addition outside the taxonomy or already on the floor, or a ' +
        'blank. Reported rather than swallowed, so a shorter list is not mistaken for the whole answer.',
    },
  },
  required: ['eliminations', 'additions', 'dropped'],
}

/** The `{ proposal }` envelope the steer route returns. */
const SteerProposalEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { proposal: SteerProposalSchema },
  required: ['proposal'],
}

/** The request body for `POST /v1/data/muse/sessions/:id/steer`. */
const SteerMuseSessionRequestSchema: JsonSchema = {
  type: 'object',
  description:
    'A short instruction to interpret against the session floor. The instruction is LIMITED and ' +
    'the limit is enforced server-side: a steer is a short push against a floor, not a prompt. ' +
    'Only the fragments currently in the draw are steered.',
  properties: {
    instruction: {
      type: 'string',
      description: "What should change, in the caller's own words. At most 280 characters.",
    },
  },
  required: ['instruction'],
}

/** The request body for `POST /v1/data/muse/sessions`. */
const SpawnMuseSessionRequestSchema: JsonSchema = {
  type: 'object',
  description:
    'Break a session off a dataset the caller owns. Fragments are pooled dataset-wide across every ' +
    'media item, in item order — a session is a break-off of the whole dataset, not of one item.',
  properties: {
    datasetId: { type: 'string', description: 'FK -> Dataset. Must be a dataset the caller owns.' },
  },
  required: ['datasetId'],
}

/** The request body for `PATCH /v1/data/muse/sessions/:id/floor/enabled`. */
const SetMuseFragmentEnabledRequestSchema: JsonSchema = {
  type: 'object',
  description:
    'Turn one fragment off or back on. The fragment is named by its identity in the body rather ' +
    'than in the path because that identity is free text. A disabled fragment stays on the floor ' +
    'and stays in the fragment list — it is out of the draw, not gone.',
  properties: {
    category: { type: 'string', description: "The fragment's category." },
    text: { type: 'string', description: "The fragment's text." },
    enabled: { type: 'boolean' },
  },
  required: ['category', 'text', 'enabled'],
}

/** The request body for `PATCH /v1/data/muse/sessions/:id/floor/weight`. */
const SetMuseFragmentWeightRequestSchema: JsonSchema = {
  type: 'object',
  description: "Weight one fragment against its pool-mates. Clamped server-side to the sampler's bounds.",
  properties: {
    category: { type: 'string', description: "The fragment's category." },
    text: { type: 'string', description: "The fragment's text." },
    weight: { type: 'number', description: 'Relative draw weight. Values outside the sampler bounds are clamped.' },
  },
  required: ['category', 'text', 'weight'],
}

/** The request body for `POST /v1/data/muse/sessions/:id/floor/fragments`. */
const AddMuseFragmentRequestSchema: JsonSchema = {
  type: 'object',
  description:
    'Put a fragment the caller wrote on the session floor, in the draw at even odds. The ' +
    'category must be one the taxonomy defines: prompts are composed by walking the ' +
    'categories, so a fragment filed outside them would never be drawn. Adding a fragment ' +
    'the floor already holds returns the session unchanged rather than a second copy of one ' +
    'identity. Nothing is spent on this call.',
  properties: {
    category: { type: 'string', description: "The fragment's category. Must be a Muse fragment category." },
    text: { type: 'string', description: 'The fragment itself — a short, prompt-ready phrase.' },
  },
  required: ['category', 'text'],
}

/** The request body for `POST /v1/data/muse/sessions/:id/pieces`. */
const RecordMusePieceRequestSchema: JsonSchema = {
  type: 'object',
  description:
    'Append a piece to the session ledger with the lineage that produced it. Every cited fragment ' +
    'must be one this session holds; the lineage is stored from the session\'s own copies. The ' +
    'lineage is recorded now because it is not recoverable later — the floor moves and the ' +
    'fragment list is rebuilt.',
  properties: {
    runId: { type: 'string', description: 'The run that produced the piece.' },
    rollIndex: { type: 'number', description: 'Which roll of the session this was. A non-negative integer.' },
    fragments: {
      type: 'array',
      items: { type: 'object', properties: { category: { type: 'string' }, text: { type: 'string' } }, required: ['category', 'text'] },
      description: 'The lineage, each fragment named by category and text.',
    },
    reaction: { type: 'string', enum: ['up', 'down', 'note'] },
    saved: { type: 'boolean' },
    dismissed: { type: 'boolean' },
  },
  required: ['runId', 'rollIndex', 'fragments'],
}

/** The request body for `PATCH /v1/data/muse/sessions/:id/pieces/:runId`. */
const UpdateMusePieceRequestSchema: JsonSchema = {
  type: 'object',
  description:
    'Change what the session says about a piece already in its ledger. A reaction and a ' +
    'dismissal are both given after the piece exists, so neither can ride the record call. ' +
    'At least one of the two fields must be present; a field left out is left as it was. The ' +
    "piece's lineage, run and roll index describe what produced it, are fixed when it is " +
    'recorded, and are not changed here.',
  properties: {
    reaction: { type: 'string', enum: ['up', 'down', 'note'], description: 'What the user said about the piece.' },
    dismissed: { type: 'boolean', description: 'Whether the piece is discarded.' },
  },
}

/** The request body for `POST /v1/data/muse/sessions/:id/promote`. */
const PromoteMuseSessionRequestSchema: JsonSchema = {
  type: 'object',
  description:
    'Promote a Muse session into a draft collection. The body carries at most a name, and ' +
    'a name is a label: the flow, the trait grid, the standing prompt and the funding ' +
    'identity are all derived server-side from the session the caller owns, so no field ' +
    'here names an owner, a team, or any part of the grid. Omit the name and one is derived ' +
    "from the session's mother dataset.",
  properties: {
    nomen: { type: 'string', description: 'Optional display name for the new collection.' },
  },
}

const CogsReportSchema: JsonSchema = {
  type: 'object',
  description: 'Admin COGS report: trailing-window rollup of per-job costUsd off wide_events — the read-only pair to the revenue report.',
  properties: {
    asOf: { type: 'string', description: 'ISO timestamp the trailing window was computed against.' },
    sinceIso: { type: 'string', description: "ISO timestamp of the trailing window's cutoff (same window the revenue report uses)." },
    costUsd: { type: 'number', description: 'Trailing-window COGS, whole USD (pod compute spend, per-job costUsd summed).' },
    count: { type: 'number', description: 'Job count in the trailing window (includes jobs with no cost telemetry, counted at 0).' },
  },
  required: ['asOf', 'sinceIso', 'costUsd', 'count'],
}

export const API_CONTRACT: ApiContract = {
  version: 'v1',
  routes: [
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
    {
      method: 'GET',
      path: '/openapi.json',
      summary: 'The live OpenAPI 3.1 description of this surface (self-describing).',
      auth: false,
    },
    {
      method: 'POST',
      path: '/mcp',
      summary:
        'MCP (Model Context Protocol) JSON-RPC endpoint — agent tool-use over the same facade. ' +
        'Tools: run_flow / get_run / list_flows / describe_flow / collect / get_collection. Resources: crystal://flows and ' +
        'crystal://flows/{id}. Stateless streamable-HTTP transport; not a typed REST op. The transport ' +
        'itself accepts unauthenticated requests (a client must be able to connect and enumerate tools ' +
        'before it has a credential); identity is enforced per-tool — tools that touch owner-scoped data ' +
        'reject without a credential inside their handler.',
      auth: false,
    },
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
    {
      method: 'GET',
      path: '/fundamenta',
      summary: 'List the canonical compute substrates (fundamenta) available for flows.',
      auth: false,
      response: FundamentaListSchema,
    },
    {
      method: 'GET',
      path: '/models',
      summary: 'Browse the model weight catalog.',
      auth: false,
      query: [
        { name: 'genus', description: 'Filter by model genus.', schema: { type: 'string' } },
        { name: 'basis', description: 'Filter by model basis.', schema: { type: 'string' } },
        { name: 'fundamentumId', description: 'Filter by compute substrate id.', schema: { type: 'string' } },
        { name: 'trigger', description: 'Filter by trigger word.', schema: { type: 'string' } },
        { name: 'q', description: 'Free-text search query.', schema: { type: 'string' } },
        { name: 'limit', description: 'Maximum number of results to return.', schema: { type: 'integer' } },
        {
          name: 'sort',
          description:
            'Sort order for results: `newest | name | genus`. Applied server-side before the `limit` slice.',
          schema: { type: 'string' },
        },
      ],
      response: ModelsListSchema,
    },
    {
      method: 'GET',
      path: '/deposit/config',
      summary: 'Buy-credits/deposit UI config: deposit address, points/USD rate, default funding rate, supported chains.',
      auth: false,
      response: DepositConfigSchema,
    },
    {
      method: 'POST',
      path: '/deposit/quote',
      summary: 'Quote how many impetus points a deposit of a given asset+amount would buy (informational; equals the on-chain credit).',
      auth: false,
      request: DepositQuoteRequestSchema,
      response: DepositQuoteResponseSchema,
    },
    {
      method: 'GET',
      path: '/deposit/mine',
      summary: "The authenticated caller's own deposits, scoped to their linked wallets — real depositum status (confirmatum/processatum) for the settle-watch UI.",
      auth: true,
      response: MyDepositsResponseSchema,
    },
    {
      method: 'POST',
      path: '/payments/checkout',
      summary: 'Buy a fixed credit pack with fiat: create a Stripe Checkout session for the chosen pack and return the hosted-checkout URL. Requires an identified account; the impetus credited is the server-side pack constant, applied later by the signature-verified webhook on payment completion.',
      auth: true,
      request: CheckoutRequestSchema,
      response: CheckoutResponseSchema,
    },
    {
      method: 'POST',
      path: '/models/import',
      summary: 'Import a model/LoRA by URL (Civitai/HuggingFace/direct) as a private, owner-scoped model — usable in your flows immediately; promoting it to the public catalogue is a separate publish.',
      auth: true,
      request: ModelImportRequestSchema,
      response: ModelImportResponseSchema,
    },
    {
      method: 'GET',
      path: '/me/models',
      summary: "List the caller's own privately-held models (imports + trained LoRAs), newest first — the public /v1/models catalog is canonical-only.",
      auth: true,
      response: ModelsListSchema,
    },
    {
      method: 'PUT',
      path: '/models/:id/license',
      summary: 'Admin: clear or backfill a model\'s license so the public-catalog gate treats it correctly (explicit license/commercialUse, or reclassify from the base). Platform-admin only.',
      auth: true,
      request: ModelLicenseRequestSchema,
      response: ModelImportResponseSchema,
    },
    {
      method: 'GET',
      path: '/admin/revenue',
      summary: 'Admin: company-wide trailing-12mo USD revenue vs the tightest active conditional-license cap (the tripwire). Platform-admin only.',
      auth: true,
      response: RevenueReportSchema,
    },
    {
      method: 'GET',
      path: '/admin/cogs',
      summary: 'Admin: trailing-window rollup of per-job costUsd off wide_events — the read-only pair to the revenue report. Platform-admin only.',
      auth: true,
      response: CogsReportSchema,
    },
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
    {
      method: 'GET',
      path: '/me/status',
      summary: "Return the authenticated caller's account snapshot — balance, in-flight gens, and studios.",
      auth: true,
      response: StatusViewSchema,
    },
    {
      method: 'GET',
      path: '/me/runs',
      summary: "The caller's SETTLED spend history — per-run impetus cost (+ derived USD), settledAt, and a lifetime running total. Owner-scoped (identified or anon-commitment), cursor-paginated, newest first. Only completus runs (a refunded failed run is not spend).",
      auth: true,
      query: [
        {
          name: 'cursor',
          description: 'Opaque page cursor: pass the `nextCursor` from the previous response to fetch the next page.',
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          description: 'Page size. Clamped to 1..100; defaults to 20.',
          schema: { type: 'integer' },
        },
      ],
      response: RunsPageSchema,
    },
    {
      method: 'GET',
      path: '/me/activity',
      summary: "The caller's activity — in-flight and settled runs in ONE newest-first projection, each row carrying its kind and a door to the artifact it produced. Owner-scoped (identified or anon-commitment), cursor-paginated. In-flight rows ride the first page; the cursor pages settled history.",
      auth: true,
      query: [
        {
          name: 'cursor',
          description: 'Opaque page cursor: pass the `nextCursor` from the previous response to fetch the next page of settled rows.',
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          description: 'Page size. Clamped to 1..100; defaults to 20.',
          schema: { type: 'integer' },
        },
      ],
      response: ActivityPageSchema,
    },
    {
      method: 'GET',
      path: '/data/datasets',
      summary: "The caller's datasets as the thin summary projection (the training-run picker's contract) — the datasets they own plus the datasets shared with a Team (Sodalitas) they are a member of. Newest first.",
      auth: true,
      query: [
        {
          name: 'cursor',
          description: 'Opaque page cursor: pass the `nextCursor` from the previous response to fetch the next page.',
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          description: 'Page size. Clamped to 1..100; defaults to 20.',
          schema: { type: 'integer' },
        },
      ],
      response: DatasetSummariesListSchema,
    },
    {
      method: 'GET',
      path: '/data/datasets/full',
      summary: "The caller's datasets as the full rich shape (custody, modality, captionsets, versions) — Datasets.tsx's live listing. The datasets they own plus the datasets shared with a Team (Sodalitas) they are a member of. Newest first, paginated identically to the summary route.",
      auth: true,
      query: [
        {
          name: 'cursor',
          description: 'Opaque page cursor: pass the `nextCursor` from the previous response to fetch the next page.',
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          description: 'Page size. Clamped to 1..100; defaults to 20.',
          schema: { type: 'integer' },
        },
      ],
      response: DatasetsListSchema,
    },
    {
      method: 'GET',
      path: '/data/datasets/public',
      summary: 'The public dataset catalog — every dataset with access.kind === "public", scoped to nobody in particular. Public, no auth: browsing what the platform publishes does not require an account, though using one (spawning a Muse session, appending media) still does. Newest first, paginated identically to the caller-scoped list routes.',
      auth: false,
      query: [
        {
          name: 'cursor',
          description: 'Opaque page cursor: pass the `nextCursor` from the previous response to fetch the next page.',
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          description: 'Page size. Clamped to 1..100; defaults to 20.',
          schema: { type: 'integer' },
        },
      ],
      response: DatasetsListSchema,
    },
    {
      method: 'GET',
      path: '/data/datasets/:id',
      summary: 'Read one dataset the caller may reach — its owner, a member of the team it is shared with, or anyone when its access.kind is "public". A dataset the caller has no claim on is reported as not found, exactly as an id that never existed is.',
      auth: true,
      response: DatasetEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/data/datasets',
      summary: "Create a Dataset from either v1 ingestion path — 'upload' (media already dropped via POST /storage/uploads/sign) or 'generation' (media seeded from the caller's own completed Acta) — or with no media at all by omitting source, in which case media is added afterwards through POST /v1/data/datasets/:id/media. An empty dataset is created at version 1.0.0 with a count of 0; its first append records 1.1.0. A source naming neither path, a declared source with an empty media list, and media fields supplied without a source are each rejected with 400. An optional teamId shares the dataset with a Team (Sodalitas) the caller is a member of; a team they do not belong to is reported as not found.",
      auth: true,
      request: CreateDatasetRequestSchema,
      response: DatasetEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/data/datasets/:id/media',
      summary:
        "Contribute media to a dataset the caller owns OR is a team member of, via either ingestion path — 'upload' (media already dropped via POST /storage/uploads/sign) or 'generation' (media resolved from the caller's own completed Acta). A member contributes their own generations: every named Actum must still be the caller's own and completed, which team sharing does not change. Each item records addedBy, the contributor's Anima id. Append-only: nothing is replaced, reordered or removed. The response carries the dataset with its new media, a new version entry whose count is the media count after the append, and every captionset's coverage recomputed against the new media count. A body matching neither ingestion shape is rejected with 400. A dataset the caller neither owns nor shares is reported as not found.",
      auth: true,
      request: AddDatasetMediaRequestSchema,
      response: DatasetEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/data/datasets/:id/captionsets',
      summary: 'Attach a caption pass (caption text keyed by media id) to a dataset the caller owns or is a team member of; a captionset already carrying the same id is replaced. Coverage is derived server-side. A dataset the caller neither owns nor shares is reported as not found.',
      auth: true,
      request: AddCaptionsetRequestSchema,
      response: DatasetEnvelopeSchema,
    },
    {
      method: 'PATCH',
      path: '/data/datasets/:id/captionsets/:captionsetId/captions/:mediaId',
      summary: "Edit one caption within one caption pass on a dataset the caller owns or is a team member of — captionsets are editable after generation. The media id must be a media item on the dataset; the captionset's coverage is recomputed from the captions present. A dataset the caller neither owns nor shares is reported as not found.",
      auth: true,
      request: SetCaptionRequestSchema,
      response: DatasetEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/data/datasets/:id/archive',
      summary: 'Archive a dataset the caller owns. Owner-only: a team member reads and contributes, but retiring the set stays with its owner. It leaves both dataset list routes and every picker built on them. It is not erased: references into it keep resolving, so a Muse session naming it as a mother dataset and a past run naming its media both continue to work. Reversible via POST /v1/data/datasets/:id/restore. Idempotent. A dataset the caller does not own is reported as not found.',
      auth: true,
      response: DatasetEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/data/datasets/:id/restore',
      summary: 'Restore an archived dataset the caller owns — it returns to both dataset list routes. Owner-only, like the archive it undoes. Idempotent on a dataset that is already live. A dataset the caller does not own is reported as not found.',
      auth: true,
      response: DatasetEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/data/datasets/:id/media/:mediaId/archive',
      summary: "Archive one media item on a dataset the caller owns. Owner-only: a team member contributes to the set rather than deciding what leaves it. The item leaves the dataset's working set — the media a caption pass or a decompose reads, the summary count, and the fragments a Muse session is spawned from — and every captionset's coverage is recomputed against the media that is left. The item itself stays on the record, so captions and fragments keyed on its id are preserved for a restore. Reversible via POST /v1/data/datasets/:id/media/:mediaId/restore. Idempotent. A media id that names no item on the dataset is rejected with 400; a dataset the caller does not own is reported as not found.",
      auth: true,
      response: DatasetEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/data/datasets/:id/media/:mediaId/restore',
      summary: "Restore one archived media item on a dataset the caller owns (owner-only, like the archive it undoes) — it rejoins the dataset's working set and every captionset's coverage is recomputed against it. Idempotent on an item that is already live. A media id that names no item on the dataset is rejected with 400; a dataset the caller does not own is reported as not found.",
      auth: true,
      response: DatasetEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/data/muse/sessions',
      summary: 'Break a Muse session off a dataset the caller owns. The session copies the dataset\'s fragments, pooled dataset-wide across every media item, and works from its own copies — the mother dataset is never written to. A dataset the caller does not own is reported as not found.',
      auth: true,
      request: SpawnMuseSessionRequestSchema,
      response: MuseSessionEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/data/muse/sessions',
      summary: "The caller's own Muse sessions off one dataset, most recently changed first. This is how a session is reached again once the page that spawned it is gone: the pointer is held server-side against the resolved caller rather than in the client. Owner-scoped from the resolved caller; a dataset the caller has no sessions off resolves to an empty list.",
      auth: true,
      query: [
        {
          name: 'datasetId',
          description: 'FK -> Dataset. The mother dataset whose sessions are being looked up.',
          schema: { type: 'string' },
          required: true,
        },
      ],
      response: MuseSessionListEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/data/muse/sessions/:id',
      summary: "A Muse session the caller owns — its floor and its piece ledger. Owner-scoped from the resolved caller; a session the caller does not own is reported as not found, identically to an id that does not exist.",
      auth: true,
      response: MuseSessionEnvelopeSchema,
    },
    {
      method: 'PATCH',
      path: '/data/muse/sessions/:id/floor/enabled',
      summary: 'Turn one fragment off or back on in a session the caller owns. A disabled fragment stays on the floor and in the fragment list; it is out of the draw, not gone. A fragment the session does not hold is rejected with 400.',
      auth: true,
      request: SetMuseFragmentEnabledRequestSchema,
      response: MuseSessionEnvelopeSchema,
    },
    {
      method: 'PATCH',
      path: '/data/muse/sessions/:id/floor/weight',
      summary: "Weight one fragment against its pool-mates in a session the caller owns. The weight is clamped server-side to the sampler's bounds. A fragment the session does not hold is rejected with 400.",
      auth: true,
      request: SetMuseFragmentWeightRequestSchema,
      response: MuseSessionEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/data/muse/sessions/:id/floor/fragments',
      summary: "Put a fragment the caller wrote on the floor of a session they own, in the draw at even odds. This is the un-metered way to widen a floor: a piece is composed from fragments already on the floor, so working with the session reweights it without widening it. Nothing is spent on this call — it reaches no model. A category outside the taxonomy is rejected with 400, and a fragment the floor already holds returns the session unchanged rather than a duplicate.",
      auth: true,
      request: AddMuseFragmentRequestSchema,
      response: MuseSessionEnvelopeSchema,
    },
    {
      method: 'PATCH',
      path: '/data/muse/sessions/:id/setup',
      summary:
        "Replace the run setup of a session the caller owns — the flow, the run shape, the model stack and the standing affix the session fires its draw through. Held on the session so a returning client comes back to the engine it assembled rather than to a default one. The setup is replaced WHOLESALE: it is one picture of what is about to fire, so a merge would leave a model on the stack after it was taken off, and a body that names nothing clears it. Nothing is spent and nothing is fired — no run, no quote, no model call. The infinite-mode acknowledgement is not part of a setup and cannot be written here: a body carrying one is stored without it, so a resumed session is never already consented to a run with no count to stop it. A session the caller does not own is reported as not found.",
      auth: true,
      request: MuseSetupSchema,
      response: MuseSessionEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/data/muse/sessions/:id/steer',
      summary:
        "Interpret a short instruction against the floor of a session the caller owns and return a PROPOSAL: fragments to take out of the draw, and fragments to put on the floor. NOTHING IS APPLIED — the response is offered for approval, any part of it may be rejected, and the floor moves only when the accepted parts are sent to the floor routes. Only the fragments currently in the draw are steered. The instruction is limited to 280 characters, enforced server-side. A proposed change that does not survive validation — an elimination naming a fragment the floor does not hold, an addition outside the taxonomy or already on the floor — is dropped and counted rather than silently removed. The proposal is not stored. This is a metered run: one model call, reserved before it is made and settled at its real cost. A session the caller does not own is reported as not found.",
      auth: true,
      request: SteerMuseSessionRequestSchema,
      response: SteerProposalEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/data/muse/sessions/:id/kept',
      summary:
        "Keep one rolled prompt against a session the caller owns. Rolling is free and a roll in progress is uncommitted work, so a report and the edits made to it are the client's; keeping is the explicit act and is what is held on the session, so it survives leaving the screen. The list is APPEND-ONLY — keeping the same prompt twice stores it twice, and no route here removes one. Nothing is spent and nothing is fired: the prompt is kept, not launched. A body with no prompt, or with a verdict that is not a boolean, is rejected with 400. A session the caller does not own is reported as not found.",
      auth: true,
      request: KeepMuseRollRequestSchema,
      response: MuseSessionEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/data/muse/sessions/:id/pieces',
      summary: 'Append a piece to the ledger of a session the caller owns, with the fragments that produced it. A piece citing a fragment the session does not hold is rejected rather than stored, because its lineage could not be resolved against this floor afterwards. The ledger holds one entry per run: a record for a run already in it is rejected, and changing a recorded piece is the PATCH below.',
      auth: true,
      request: RecordMusePieceRequestSchema,
      response: MuseSessionEnvelopeSchema,
    },
    {
      method: 'PATCH',
      path: '/data/muse/sessions/:id/pieces/:runId',
      summary: "Change what a session the caller owns says about a piece already in its ledger — its reaction, its dismissal, or both. A reaction is given after the piece exists, so this is the route that reaches a recorded piece; the piece's lineage, run and roll index are fixed when it is recorded. A run the ledger holds no entry for is reported as not found.",
      auth: true,
      request: UpdateMusePieceRequestSchema,
      response: MuseSessionEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/data/muse/sessions/:id/pieces/:runId/save',
      summary:
        "Put a piece from a session the caller owns back into the set: its media joins the session's own dataset, carrying the lineage that produced it as that media item's fragments. The session's dataset is created by the first save and appended to by every save after it; the mother dataset is never written. No job runs and nothing is spent — a generated piece was composed from fragments, so its recorded lineage is already its tagging. The request body is empty: the media is resolved server-side from the run the piece names, which must be the caller's own completed run. A save reweights the floor rather than widening it — the session's fragment list is unchanged. A session the caller does not own is reported as not found, as is a run the session's ledger holds no piece for.",
      auth: true,
      response: MuseSessionEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/data/muse/sessions/:id/promote',
      summary:
        "Promote a Muse session the caller owns into a DRAFT collection: the fragments still in the draw become the collection's trait grid, one axis per category, and the session's flow, standing affix and stacked model trigger words become the base prompt the grid expands. A fragment turned off on the cutting floor is not carried across — darkening it is the curation. The session itself is read and never written, so it is unchanged by the promotion and may be promoted again. NOTHING IS SPENT: a draft is not dispatched, and the supply, review policy and DNA rule a session cannot supply are set in the collection funnel, where firing enforces completeness. Trait rarity is left unset so the default spread applies. The request body carries at most a name; every reference the new collection holds is derived server-side from the session. A session the caller does not own is reported as not found.",
      auth: true,
      request: PromoteMuseSessionRequestSchema,
      response: CollectionEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/me',
      summary: "The caller's owner-keyed account settings — presentation skin (Profile), cross-cutting generation defaults (Preferences), and verb→flow bindings. Anon-capable (keyed by AuctorKey).",
      auth: true,
      response: MeViewSchema,
    },
    {
      method: 'POST',
      path: '/me/export',
      summary: "GDPR self-export — assemble the caller's OWN account data into a downloadable JSON bundle (strictly self-scoped to the caller) and return a short-lived, unguessable signed GET URL to it. Returns 503 when object storage is not configured.",
      auth: true,
      response: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Short-lived, unguessable signed GET URL to the hosted export bundle — the only handle returned (the raw object key is withheld so the response cannot be turned into a stable path).' },
          expiresIn: { type: 'number', description: 'Seconds until the signed URL expires.' },
          bytes: { type: 'number', description: 'Size of the serialized JSON bundle in bytes.' },
        },
        required: ['url', 'expiresIn', 'bytes'],
      },
    },
    {
      method: 'PUT',
      path: '/me/appearance',
      summary: "Replace the caller's presentation skin (avatar/banner/background/accent/look).",
      auth: true,
      request: AppearanceSchema,
      response: { type: 'object', properties: { appearance: AppearanceSchema }, required: ['appearance'] },
    },
    {
      method: 'PUT',
      path: '/me/generatio',
      summary: "Replace the caller's cross-cutting generation defaults (style, negative prompt, output format, telegram delivery, auto-apply models, spicy mode, private generation). Applied at cast time under the affines precedence chain. Enabling spicyMode requires a recorded 18+ attestation on file (else auth.forbidden); a recorded attestation is preserved across a replace. Enabling privateOutputs requires a deployment with a private-outputs bucket (else internal.unavailable).",
      auth: true,
      request: GeneratioSchema,
      response: { type: 'object', properties: { generatio: GeneratioSchema }, required: ['generatio'] },
    },
    {
      method: 'POST',
      path: '/me/attestation',
      summary: "Record the caller's one-time 18+ self-attestation (a click-through fact, NOT KYC/ID verification). Required on file before spicy mode may be enabled. Anon-capable (keyed by AuctorKey — anonymous Bursa/commitment and named Anima callers both).",
      auth: true,
      response: AttestationResponseSchema,
    },
    {
      method: 'PUT',
      path: '/me/secrets/:provider',
      summary: 'Connect a BYO gated-origin credential (civitai|huggingface) so gated model imports can download their weights. The token is sealed at rest at once and never echoed back. Anon-capable (a Bursa purse is a valid owner); anonymous callers receive a deanonymization warning.',
      auth: true,
      request: PutSecretRequestSchema,
      response: SecretViewSchema,
    },
    {
      method: 'DELETE',
      path: '/me/secrets/:provider',
      summary: 'Disconnect the caller\'s BYO credential for a provider (civitai|huggingface). Idempotent.',
      auth: true,
      response: SecretViewSchema,
    },
    {
      method: 'GET',
      path: '/me/affines/:modusId',
      summary: "The caller's per-flow input defaults for one flow (`{ inputKey: value }`).",
      auth: true,
      response: AffinesEnvelopeSchema,
    },
    {
      method: 'PUT',
      path: '/me/affines/:modusId',
      summary: "Replace the caller's per-flow input defaults for one flow. Applied under the cast-time aditus (cast-time > affines > generatio > modus defaults).",
      auth: true,
      request: AffinesEnvelopeSchema,
      response: AffinesEnvelopeSchema,
    },
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
    {
      method: 'POST',
      path: '/collectiones',
      summary: 'Start a Collection — expand one flow over a Tractus[] parameter grid into `total` pieces (general batch / NFT-collection generation). With `draft:true` it is created but NOT fired (author tractus, then POST /:id/fire). Returns a Collection handle (poll GET /v1/collectiones/:id).',
      auth: true,
      request: CollectRequestSchema,
      response: CollectionEnvelopeSchema,
    },
    {
      method: 'PATCH',
      path: '/collectiones/:id/tractus',
      summary: 'Edit a DRAFT Collection’s trait axes/values/rules (the garden + rules authoring write). Re-derives the provenance hash; rejected (input.malformed) once the collection is fired. Owner-scoped.',
      auth: true,
      request: PatchTractusRequestSchema,
      response: CollectionEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/collectiones/:id/fire',
      summary: 'Freeze a DRAFT Collection’s tractus and start the run — pins provenance to the flow version at fire time, then dispatches. Funder-only; rejected unless the collection is a draft.',
      auth: true,
      response: CollectionEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/collectiones',
      summary: "List the authenticated caller's Collections (owner-scoped).",
      auth: true,
      response: CollectionsListSchema,
    },
    {
      method: 'GET',
      path: '/collectiones/:id',
      summary: 'Fetch one Collection by id — status, cost, and the piece counters. Every dispatched piece is in exactly one of `completed`, `pendingReview`, `failed`, `rejected` or `inFlight`, and `rejected` raises the dispatch budget by the piece it removed from the target, so `completed + pendingReview + failed + inFlight + outstanding = total`. Owner-scoped (404 if not yours).',
      auth: true,
      response: CollectionEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/collectiones/:id/rarity',
      summary: 'Imagined-vs-realized rarity table for a Collection — target shares (from trait weights) vs actual shares (from produced pieces). Owner-scoped.',
      auth: true,
      response: RarityEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/collectiones/:id/pieces',
      summary: 'The curation queue — a Collection\'s generated pieces (media + stamped attributes + review state). Owner-scoped.',
      auth: true,
      query: [
        {
          name: 'review',
          description:
            'Filter by review state: `pending | approved | rejected | all`. Defaults to `pending`. An unrecognised value also falls back to `pending`.',
          schema: { type: 'string' },
        },
      ],
      response: CollectionPiecesSchema,
    },
    {
      method: 'POST',
      path: '/collectiones/:id/extend',
      summary: 'Extend a Collection — raise the target by `count` and dispatch the new pieces (incremental batches: fire a batch, review, fire more). Re-opens a completed Collection. Owner-scoped.',
      auth: true,
      request: {
        type: 'object',
        description: 'How many more pieces to add to the target and fire.',
        properties: { count: { type: 'number', description: 'Pieces to add (must be > 0).' } },
        required: ['count'],
      },
      response: CollectionEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/collectiones/:id/pause',
      summary: 'Pause a Collection — stop dispatching new pieces; in-flight pieces finish. Owner-scoped.',
      auth: true,
      response: CollectionEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/collectiones/:id/resume',
      summary: 'Resume a paused Collection — continue dispatching toward the target. Owner-scoped.',
      auth: true,
      response: CollectionEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/collectiones/:id/cancel',
      summary:
        'Cancel a Collection (owner-scoped, idempotent): stop dispatching, mark it cancelled, and settle ' +
        'the pieces it still has in flight through the same cancellation POST /v1/runs/:id/cancel uses — ' +
        'each of those pods is terminated and its locked credits released rather than charged. A settled ' +
        'piece is counted in `failed`; a piece that finished before the cancellation reached it keeps the ' +
        'work it did and is counted as generated. Pieces not yet dispatched are never dispatched. ' +
        'Cancelling a collection that has nothing in flight returns it unchanged, 200.',
      auth: true,
      response: CollectionEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/collectiones/:id/pieces/:actumId/approve',
      summary: 'Approve a pending-review piece — it counts toward the collection. Owner-scoped.',
      auth: true,
      response: OkSchema,
    },
    {
      method: 'POST',
      path: '/collectiones/:id/pieces/:actumId/reject',
      summary: 'Reject a piece and reroll — re-fire it with a fresh trait selection. Owner-scoped.',
      auth: true,
      response: OkSchema,
    },
    {
      method: 'POST',
      path: '/editiones',
      summary: "Publish an artifact (an Actum for #1) to a destination under a visibility/custody policy. Public surfaces (feed/marketplace) return a `pending` Edition and settle asynchronously through the moderation gate — never a synchronous publish to public. Unspecified fields default from the caller's publishing prefs.",
      auth: true,
      request: PublishRequestSchema,
      response: EditionEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/editiones/review',
      summary: 'The human-review queue: publications the moderation gate HELD for review (spec §4). An author sees their own held items; the platform administrator sees all of them.',
      auth: true,
      response: EditionListEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/editiones/:id',
      summary: 'Fetch one publication (author-scoped). Poll it to watch a `pending` settle land — an async archive ZIP build finishing (`externalRef` = the download url), or a public surface being gated.',
      auth: true,
      response: EditionEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/editiones/:id/retract',
      summary: 'Retract a publication where the destination allows it (feed/bucket = revocable; mint = permanent → 403). Author-scoped.',
      auth: true,
      response: EditionEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/editiones/:id/approve',
      summary: 'Clear a moderation HOLD so the held publication re-settles and publishes (spec §4). Restricted to the platform administrator — an author cannot clear their own held content.',
      auth: true,
      response: EditionEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/editiones/:id/reject',
      summary: 'Decline a held publication → terminal `rejected` (spec §4). Restricted to the platform administrator. Filing a CSAM report is a separate, explicit human action — never automatic.',
      auth: true,
      response: EditionEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/feed',
      summary: "The public feed — published, public-surface editions newest first (NOT auth-scoped). Each item carries the referenced artifact's produced output.",
      auth: false,
      query: [
        {
          name: 'visibility',
          description:
            'Filter by visibility: `feed | marketplace`. This is a public surface — any other value (including a private/unlisted visibility) collapses to `feed`.',
          schema: { type: 'string' },
        },
        { name: 'destination', description: 'Filter to one destination/adapter key.', schema: { type: 'string' } },
        {
          name: 'limit',
          description: 'Maximum number of results to return. A non-numeric value is ignored.',
          schema: { type: 'integer' },
        },
        {
          name: 'author',
          description: "Filter to one creator/agent by their animaId. Still subject to the public visibility clamp.",
          schema: { type: 'string' },
        },
      ],
      response: FeedListSchema,
    },
    {
      method: 'POST',
      path: '/teams',
      summary: 'Create a team (Sodalitas) — a fellowship of Animae that co-owns work. The caller becomes the founder and first member.',
      auth: true,
      request: CreateTeamRequestSchema,
      response: TeamEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/teams',
      summary: "List the caller's teams (every team they are a member of).",
      auth: true,
      response: TeamsListSchema,
    },
    {
      method: 'GET',
      path: '/teams/:id',
      summary: 'Fetch one team by id. Member-scoped (404 if not a member).',
      auth: true,
      response: TeamEnvelopeSchema,
    },
    {
      method: 'POST',
      path: '/teams/:id/members',
      summary: 'Add a member to a team. Member-scoped; idempotent.',
      auth: true,
      request: AddMemberRequestSchema,
      response: TeamEnvelopeSchema,
    },
    {
      method: 'DELETE',
      path: '/teams/:id/members/:animaId',
      summary: 'Remove a member from a team (the founder cannot be removed). Member-scoped.',
      auth: true,
      response: TeamEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/me/projects',
      summary: "List the projects the caller can read (Provincia) — their own, plus any shared with a Team they belong to. Identified callers only.",
      auth: true,
      response: ProjectsListSchema,
    },
    {
      method: 'POST',
      path: '/me/projects',
      summary: 'Create a project owned by the caller. Holdings start empty; assets are filed in by reference.',
      auth: true,
      request: CreateProjectRequestSchema,
      response: ProjectEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/me/projects/:id',
      summary: 'Fetch one project by id — the owner, or a member of the Team it is shared with (404 for anyone else).',
      auth: true,
      response: ProjectEnvelopeSchema,
    },
    {
      method: 'PATCH',
      path: '/me/projects/:id',
      summary: 'Patch project metadata (name/desc/glyph/color/teamId). Owner-only.',
      auth: true,
      request: UpdateProjectRequestSchema,
      response: ProjectEnvelopeSchema,
    },
    {
      method: 'DELETE',
      path: '/me/projects/:id',
      summary: 'Delete a project. Owner-only. Filed assets are untouched (holdings are references).',
      auth: true,
    },
    {
      method: 'POST',
      path: '/me/projects/:id/holdings',
      summary: 'File an asset reference (dataset|model|collection) into the project. Owner or a member of the Team it is shared with; idempotent. Filing is a reference, not a grant — it does not widen who can read the asset.',
      auth: true,
      request: FileAssetRequestSchema,
      response: ProjectEnvelopeSchema,
    },
    {
      method: 'DELETE',
      path: '/me/projects/:id/holdings/:kind/:assetId',
      summary: 'Unfile an asset reference from the project. Owner-only; idempotent.',
      auth: true,
      response: ProjectEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/tabulae',
      summary: "List the caller's own canvas workspaces (Tabulae). Owner-scoped.",
      auth: true,
      response: TabulaeListSchema,
    },
    {
      method: 'POST',
      path: '/tabulae',
      summary: 'Create a draft Tabula owned by the caller.',
      auth: true,
      request: CreateTabulaRequestSchema,
      response: TabulaEnvelopeSchema,
    },
    {
      method: 'GET',
      path: '/tabulae/:id',
      summary: 'Fetch one owned Tabula by id (404 if not the owner).',
      auth: true,
      response: TabulaEnvelopeSchema,
    },
    {
      method: 'PUT',
      path: '/tabulae/:id',
      summary: "Patch a Tabula's graph/metadata (nomen/descriptio/nodi/vincula/visibilitas). Owner-only.",
      auth: true,
      request: UpdateTabulaRequestSchema,
      response: TabulaEnvelopeSchema,
    },
    {
      method: 'DELETE',
      path: '/tabulae/:id',
      summary: 'Delete a Tabula outright. Owner-only.',
      auth: true,
    },
    {
      method: 'POST',
      path: '/tabulae/:id/publish',
      summary: 'Compile the canvas graph into a compositus Modus and register it — immediately runnable via POST /v1/runs. 400 with the offending vinculum on a cycle or a port-type mismatch.',
      auth: true,
      response: PublishTabulaResponseSchema,
    },
    {
      method: 'GET',
      path: '/me/flows',
      summary: "List the caller's own registered flows (owner-scoped discovery for the canvas node picker) — the public catalog's owner-filtered twin.",
      auth: true,
      response: MyFlowsListSchema,
    },
  ],
  // Mirrors the request-error taxonomy in `errors.ts`. Append-only.
  errorCodes: [
    { code: 'auth.missing', httpStatus: 401 },
    { code: 'auth.invalid', httpStatus: 401 },
    { code: 'auth.forbidden', httpStatus: 403 },
    { code: 'input.malformed', httpStatus: 400 },
    { code: 'input.invalid_aditus', httpStatus: 422 },
    { code: 'input.invalid_graph', httpStatus: 400 },
    { code: 'not_found.flow', httpStatus: 404 },
    { code: 'not_found.tabula', httpStatus: 404 },
    { code: 'not_found.fundamentum', httpStatus: 404 },
    { code: 'not_found.studio', httpStatus: 404 },
    { code: 'not_found.collection', httpStatus: 404 },
    { code: 'not_found.team', httpStatus: 404 },
    { code: 'not_found.project', httpStatus: 404 },
    { code: 'not_found.edition', httpStatus: 404 },
    { code: 'not_found.model', httpStatus: 404 },
    { code: 'not_found.adapter', httpStatus: 404 },
    { code: 'not_found.run', httpStatus: 404 },
    { code: 'not_found.muse_session', httpStatus: 404 },
    { code: 'not_found.muse_piece', httpStatus: 404 },
    { code: 'not_found.dataset', httpStatus: 404 },
    { code: 'input.model_not_resolved', httpStatus: 422 },
    { code: 'economy.insufficient_signa', httpStatus: 402 },
    { code: 'economy.cap_too_low', httpStatus: 422 },
    { code: 'conflict.slug_taken', httpStatus: 409 },
    // The same work is already running on the caller's own resource. Retryable: the request
    // succeeds once the running one ends.
    { code: 'conflict.run_in_flight', httpStatus: 409, retryable: true },
    // There is no work left to do. NOT retryable: the request cannot succeed until the resource
    // changes or the caller asks for a rebuild.
    { code: 'conflict.nothing_to_decompose', httpStatus: 409, retryable: false },
    // Concurrent writes to the same muse session exhausted the retry budget. Retryable: the
    // stored session is intact, and the same call succeeds once contention clears.
    { code: 'conflict.muse_session', httpStatus: 409, retryable: true },
    { code: 'license.restricted', httpStatus: 403 },
    { code: 'content.refused', httpStatus: 403 },
    { code: 'secret.required', httpStatus: 422 },
    { code: 'deposit.price_unavailable', httpStatus: 422 },
    { code: 'feature.not_implemented', httpStatus: 501 },
    { code: 'purse.disabled', httpStatus: 503 },
    { code: 'rate.limited', httpStatus: 429, retryable: true },
    { code: 'capacity.no_pods', httpStatus: 503, retryable: true },
    { code: 'internal.unavailable', httpStatus: 503, retryable: true },
    { code: 'internal.upstream_unavailable', httpStatus: 503, retryable: true },
    { code: 'internal.error', httpStatus: 500, retryable: true },
  ],
}

// Schemas exported for the doc generator to reference by name in OpenAPI components.
export const SCHEMAS = {
  Run: RunSchema,
  Error: ErrorEnvelopeSchema,
} as const
