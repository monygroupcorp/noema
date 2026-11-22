import type { JsonSchema, RouteSpec } from './types'
import { CollectionEnvelopeSchema } from './collections'

export const MuseFragmentSchema: JsonSchema = {
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

export const MuseFloorEntrySchema: JsonSchema = {
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

export const MusePieceSchema: JsonSchema = {
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

export const MuseNozzleEntrySchema: JsonSchema = {
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

export const MuseSetupSchema: JsonSchema = {
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

export const MuseKeptRollSchema: JsonSchema = {
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

export const KeepMuseRollRequestSchema: JsonSchema = {
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

export const MuseSessionSchema: JsonSchema = {
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

export const MuseSessionEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { session: MuseSessionSchema },
  required: ['session'],
}

export const MuseSessionListEnvelopeSchema: JsonSchema = {
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

export const MuseFragmentIdentitySchema: JsonSchema = {
  type: 'object',
  description: 'A fragment named by its identity — the same `{ category, text }` pair the floor routes take.',
  properties: {
    category: { type: 'string', description: "The fragment's category." },
    text: { type: 'string', description: "The fragment's text." },
  },
  required: ['category', 'text'],
}

export const SteerProposalSchema: JsonSchema = {
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

export const SteerProposalEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { proposal: SteerProposalSchema },
  required: ['proposal'],
}

export const SteerMuseSessionRequestSchema: JsonSchema = {
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

export const SpawnMuseSessionRequestSchema: JsonSchema = {
  type: 'object',
  description:
    'Break a session off a dataset the caller owns. Fragments are pooled dataset-wide across every ' +
    'media item, in item order — a session is a break-off of the whole dataset, not of one item.',
  properties: {
    datasetId: { type: 'string', description: 'FK -> Dataset. Must be a dataset the caller owns.' },
  },
  required: ['datasetId'],
}

export const SetMuseFragmentEnabledRequestSchema: JsonSchema = {
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

export const SetMuseFragmentWeightRequestSchema: JsonSchema = {
  type: 'object',
  description: "Weight one fragment against its pool-mates. Clamped server-side to the sampler's bounds.",
  properties: {
    category: { type: 'string', description: "The fragment's category." },
    text: { type: 'string', description: "The fragment's text." },
    weight: { type: 'number', description: 'Relative draw weight. Values outside the sampler bounds are clamped.' },
  },
  required: ['category', 'text', 'weight'],
}

export const AddMuseFragmentRequestSchema: JsonSchema = {
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

export const RecordMusePieceRequestSchema: JsonSchema = {
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

export const UpdateMusePieceRequestSchema: JsonSchema = {
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

export const PromoteMuseSessionRequestSchema: JsonSchema = {
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

export const museRoutes: RouteSpec[] = [
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
]
