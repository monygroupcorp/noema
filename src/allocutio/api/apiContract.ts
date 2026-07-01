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

/** One HTTP operation on the `/v1` surface. */
export interface RouteSpec {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** The path, RELATIVE to the `/v1` mount (e.g. `/runs`, `/runs/:id`). */
  path: string
  summary: string
  /** Whether a resolved caller identity (a credential) is required. */
  auth: boolean
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
  },
  required: ['id', 'status', 'modusId'],
}

/** The `{ run }` envelope returned by the run operations. */
const RunEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { run: RunSchema },
  required: ['run'],
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
    categoria: { description: 'An optional catalog tag.' },
  },
  required: ['id', 'nomen', 'versio'],
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
  },
}

/** The response body for `GET /v1/me` — the caller's account settings. */
const MeViewSchema: JsonSchema = {
  type: 'object',
  description: "The caller's owner-keyed account settings — appearance + generation defaults + verb bindings.",
  properties: {
    appearance: AppearanceSchema,
    generatio: GeneratioSchema,
    bindings: { type: 'array', items: BindResponseSchema, description: 'The verb→flow overrides the owner has set.' },
  },
  required: ['bindings'],
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
    modusId: { type: 'string', description: 'The flow expanded across the grid.' },
    total: { type: 'number', description: 'Target number of pieces to generate.' },
    tractus: { type: 'array', items: TractusSchema, description: 'The axes of variation (the parameter grid).' },
    aditusBase: {
      type: 'object',
      additionalProperties: true,
      description: 'Base aditus applied to every piece (e.g. `_basePrompt` with `{{porta}}` tokens).',
    },
    concurrentia: { type: 'number', description: 'Max concurrent pieces in flight (default 3).' },
    nomen: { type: 'string', description: 'Optional human name for the collection.' },
    dna: { type: 'boolean', description: 'Opt-in DNA uniqueness — no two pieces share a trait combination (across non-bypassDNA axes). Default false.' },
    reviewEnabled: { type: 'boolean', description: 'Hold every completed piece for review before it counts toward the drop (approve/reject in curation). Omit → the platform default applies.' },
    draft: { type: 'boolean', description: 'Create as a DRAFT — author tractus (garden/rules) without firing. Start it later with POST /:id/fire. Omit/false → create + fire in one shot.' },
    teamId: { type: 'string', description: 'Own this collection by a team (Sodalitas) the caller is a member of — snapshots an equal-weight owners split.' },
  },
  required: ['modusId', 'total', 'tractus'],
}

/** The request body for `PATCH /v1/collectiones/:id/tractus` (draft authoring). */
const PatchTractusRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Replace a draft Collection’s trait axes/values/rules. Re-derives the provenance hash; rejected once the collection is fired.',
  properties: {
    tractus: { type: 'array', items: TractusSchema, description: 'The full new set of axes of variation (replaces the existing grid).' },
  },
  required: ['tractus'],
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
    owners: {
      type: 'array',
      description: 'Per-artifact ownership split (team-owned collections only) — weights sum to 1.',
      items: {
        type: 'object',
        properties: { animaId: { type: 'string' }, weight: { type: 'number' } },
        required: ['animaId', 'weight'],
      },
    },
    completed: { type: 'number', description: 'Pieces completed so far (approved, when review is on).' },
    failed: { type: 'number', description: 'Pieces that failed to generate so far.' },
    rejected: { type: 'number', description: 'Pieces a reviewer rejected so far (distinct from failed).' },
    cost: { type: 'string', description: 'Total impetus across completed pieces, serialised as a string.' },
    createdAt: { type: 'string', format: 'date-time', description: 'When the collection started.' },
    completedAt: { type: 'string', format: 'date-time', description: 'When it finished (or was cancelled).' },
  },
  required: ['id', 'status', 'modusId', 'total', 'provenanceHash', 'completed', 'failed', 'rejected'],
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
        'crystal://flows/{id}. Stateless streamable-HTTP transport; not a typed REST op.',
      auth: true,
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
      summary: 'Browse the model weight catalog, optionally filtered by genus, basis, fundamentumId, trigger, or free-text query.',
      auth: false,
      response: ModelsListSchema,
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
      path: '/me',
      summary: "The caller's owner-keyed account settings — presentation skin (Profile), cross-cutting generation defaults (Preferences), and verb→flow bindings. Anon-capable (keyed by AuctorKey).",
      auth: true,
      response: MeViewSchema,
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
      summary: "Replace the caller's cross-cutting generation defaults (style, negative prompt, output format, telegram delivery, auto-apply models). Applied at cast time under the affines precedence chain.",
      auth: true,
      request: GeneratioSchema,
      response: { type: 'object', properties: { generatio: GeneratioSchema }, required: ['generatio'] },
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
      summary: "List the authenticated caller's live hosted studios.",
      auth: true,
      response: StudiosListSchema,
    },
    {
      method: 'GET',
      path: '/studios/:id',
      summary: "Fetch one of the caller's studios by id (owner-scoped) — poll its status (provisioning → idle) after provisioning.",
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
      summary: 'Fetch one Collection by id — progress (completed/failed/total), status, cost. Owner-scoped (404 if not yours).',
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
      summary: 'The curation queue — a Collection\'s generated pieces (media + stamped attributes + review state), filtered by ?review=pending|approved|rejected|all (default pending). Owner-scoped.',
      auth: true,
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
      summary: 'Cancel a Collection — stop dispatching and mark it cancelled. Owner-scoped.',
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
      method: 'GET',
      path: '/feed',
      summary: "The public feed — published, public-surface editions newest first (NOT auth-scoped). Each item carries the referenced artifact's produced output. Query: visibility, destination, limit.",
      auth: false,
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
  ],
  // Mirrors the request-error taxonomy in `errors.ts`. Append-only.
  errorCodes: [
    { code: 'auth.missing', httpStatus: 401 },
    { code: 'auth.invalid', httpStatus: 401 },
    { code: 'auth.forbidden', httpStatus: 403 },
    { code: 'input.malformed', httpStatus: 400 },
    { code: 'input.invalid_aditus', httpStatus: 422 },
    { code: 'not_found.flow', httpStatus: 404 },
    { code: 'not_found.fundamentum', httpStatus: 404 },
    { code: 'not_found.studio', httpStatus: 404 },
    { code: 'not_found.collection', httpStatus: 404 },
    { code: 'not_found.team', httpStatus: 404 },
    { code: 'not_found.edition', httpStatus: 404 },
    { code: 'not_found.model', httpStatus: 404 },
    { code: 'not_found.adapter', httpStatus: 404 },
    { code: 'not_found.run', httpStatus: 404 },
    { code: 'economy.insufficient_signa', httpStatus: 402 },
    { code: 'economy.cap_too_low', httpStatus: 422 },
    { code: 'conflict.slug_taken', httpStatus: 409 },
    { code: 'capacity.no_pods', httpStatus: 503, retryable: true },
    { code: 'internal.unavailable', httpStatus: 503, retryable: true },
    { code: 'internal.error', httpStatus: 500, retryable: true },
  ],
}

// Schemas exported for the doc generator to reference by name in OpenAPI components.
export const SCHEMAS = {
  Run: RunSchema,
  Error: ErrorEnvelopeSchema,
} as const
