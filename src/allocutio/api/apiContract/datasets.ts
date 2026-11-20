import type { JsonSchema, RouteSpec } from './types'

export const CaptionsetSchema: JsonSchema = {
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

export const AddCaptionsetRequestSchema: JsonSchema = {
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

export const SetCaptionRequestSchema: JsonSchema = {
  type: 'object',
  description: 'Replace the caption text for one media item within one caption pass.',
  properties: {
    caption: { type: 'string', description: 'The new caption text. Non-empty.' },
  },
  required: ['caption'],
}

export const DatasetMediaItemSchema: JsonSchema = {
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

export const DatasetVersionSchema: JsonSchema = {
  type: 'object',
  properties: {
    v: { type: 'string' },
    count: { type: 'number' },
    when: { type: 'string', format: 'date-time' },
  },
  required: ['v', 'count', 'when'],
}

export const DatasetSchema: JsonSchema = {
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

export const DatasetSummarySchema: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    images: { type: 'number' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'name'],
}

export const DatasetsListSchema: JsonSchema = {
  type: 'object',
  properties: {
    datasets: { type: 'array', items: DatasetSchema },
    nextCursor: { type: 'string', description: 'Opaque cursor for the next page; absent on the last page.' },
  },
  required: ['datasets'],
}

export const DatasetSummariesListSchema: JsonSchema = {
  type: 'object',
  properties: {
    datasets: { type: 'array', items: DatasetSummarySchema },
    nextCursor: { type: 'string', description: 'Opaque cursor for the next page; absent on the last page.' },
  },
  required: ['datasets'],
}

export const CreateDatasetRequestSchema: JsonSchema = {
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

export const AddDatasetMediaRequestSchema: JsonSchema = {
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

export const SetDatasetAccessRequestSchema: JsonSchema = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['public', 'private'] },
  },
  required: ['kind'],
}

export const DatasetEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { dataset: DatasetSchema },
  required: ['dataset'],
}

export const datasetsRoutes: RouteSpec[] = [
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
      path: '/data/datasets/:id/access',
      summary: "Publish or unpublish a dataset the caller owns. Owner-only, same as archive below. { kind: 'public' } grants READ only — anyone may then list it (GET /v1/data/datasets/public), read it directly, or spawn a Muse session on it; appending media, attaching or editing a captionset still require ownership or team membership. { kind: 'private' } reverses it. Reversible in either direction. A dataset the caller does not own is reported as not found.",
      auth: true,
      request: SetDatasetAccessRequestSchema,
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
]
