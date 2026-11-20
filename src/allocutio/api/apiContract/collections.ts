import type { JsonSchema, RouteSpec } from './types'

export const TraitValorSchema: JsonSchema = {
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

export const TractusSchema: JsonSchema = {
  type: 'object',
  description: 'One axis of variation — the aditus port to vary and its options.',
  properties: {
    porta: { type: 'string', description: 'The aditus port key this axis varies (e.g. background, outfit).' },
    label: { type: 'string', description: 'Human-facing category label (falls back to porta).' },
    valores: { type: 'array', items: TraitValorSchema, description: 'The options for this axis.' },
  },
  required: ['porta', 'valores'],
}

export const CollectRequestSchema: JsonSchema = {
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

export const PatchTractusRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Replace a draft Collection’s trait axes/values/rules, and (since a draft may now be created without them) its base flow + supply. Re-derives the provenance hash; rejected once the collection is fired. Omitted fields are left untouched.',
  properties: {
    tractus: { type: 'array', items: TractusSchema, description: 'The full new set of axes of variation (replaces the existing grid).' },
    modusId: { type: 'string', description: 'The draft’s base flow.' },
    numerus: { type: 'number', description: 'The draft’s target supply (piece count).' },
  },
}

export const RarityReportSchema: JsonSchema = {
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

export const RarityEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { rarity: RarityReportSchema },
  required: ['rarity'],
}

export const CollectionSchema: JsonSchema = {
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
    basePrompt: { type: 'string', description: 'The collection’s base prompt as authored. It selects how traits reach the prompt, for the prompt as a WHOLE: a base prompt containing `{{` anywhere is in token mode, where a `{{porta}}` is replaced in place by the winning value’s prompt fragment and an axis with no token of its own reaches the prompt not at all; any other base prompt is in join mode, where fragments are appended to it in axis order. Absent when the collection has no base prompt.' },
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

export const CollectionEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { collection: CollectionSchema },
  required: ['collection'],
}

export const CollectionPieceSchema: JsonSchema = {
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

export const CollectionPiecesSchema: JsonSchema = {
  type: 'object',
  properties: { pieces: { type: 'array', items: CollectionPieceSchema } },
  required: ['pieces'],
}

export const CollectionsListSchema: JsonSchema = {
  type: 'object',
  properties: {
    collections: { type: 'array', items: CollectionSchema },
    nextCursor: { type: 'string', description: 'Present when more collections remain — pass it back as `cursor` for the next page.' },
  },
  required: ['collections'],
}

export const OkSchema: JsonSchema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
}

export const collectionsRoutes: RouteSpec[] = [
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
      summary: "List the authenticated caller's Collections (owner-scoped) — the ones they funded plus the ones shared with a Team (Sodalitas) they are a member of. Newest first, paged.",
      auth: true,
      query: [
        {
          name: 'cursor',
          description: 'Opaque page cursor: pass the `nextCursor` from the previous response to fetch the next page.',
          schema: { type: 'string' },
        },
        {
          name: 'limit',
          description: 'Page size. Clamped to 1..500; defaults to 100.',
          schema: { type: 'integer' },
        },
      ],
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
]
