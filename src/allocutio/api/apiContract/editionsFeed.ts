import type { JsonSchema, RouteSpec } from './types'

export const ArtifactRefSchema: JsonSchema = {
  type: 'object',
  description: 'The canonical artifact being published (referenced, never copied).',
  properties: {
    kind: { type: 'string', enum: ['actum', 'intella', 'collectio'], description: 'Which artifact kind.' },
    id: { type: 'string', description: "The artifact's id." },
  },
  required: ['kind', 'id'],
}

export const PublishRequestSchema: JsonSchema = {
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

export const EditionSchema: JsonSchema = {
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
    moderationNote: { type: 'string', description: "Why this publication was held or refused, in terms the publisher can be told — a hold for a human reviewer, a refusal on the content, and a refusal because public publishing is closed each read differently. Never the classifier's raw verdict text; a platform admin sees the raw reason via `GET /editiones/:id/moderation`. Absent when never flagged." },
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

export const EditionEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { edition: EditionSchema },
  required: ['edition'],
}

export const EditionListEnvelopeSchema: JsonSchema = {
  type: 'object',
  properties: { editions: { type: 'array', items: EditionSchema } },
  required: ['editions'],
}

export const EditionModerationSchema: JsonSchema = {
  type: 'object',
  description: "The moderation gate's raw verdict for one publication, platform-admin only.",
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'published', 'rejected', 'failed', 'retracted'] },
    reviewOutcome: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
    moderation: {
      type: 'object',
      nullable: true,
      description: 'The recorded verdict, or null when this Editio was never held or rejected.',
      properties: {
        reason: { type: 'string', description: "The classifier's raw verdict text." },
        category: { type: 'string', enum: ['unavailable', 'review', 'content'], description: "The gate's author-safe category for the refusal, when it set one: unavailable (nothing was checked — no scanner configured) | review (routed to a person, nothing detected) | content (the scan matched the content itself). This is what `Edition.moderationNote` is projected from. Absent from a gate that sets none." },
        hold: { type: 'boolean', description: 'True only when this verdict HELD (vs. terminally rejected).' },
        scannedAt: { type: 'string', format: 'date-time' },
      },
      required: ['reason', 'scannedAt'],
    },
  },
  required: ['id', 'status', 'moderation'],
}

export const EditionPreviewSchema: JsonSchema = {
  type: 'object',
  description: 'The media behind a held publication, for a reviewer to inspect before adjudicating.',
  properties: {
    mediaUrls: { type: 'array', description: 'Every media url the moderation gate scanned for this artifact.', items: { type: 'string' } },
    items: {
      type: 'array',
      description: 'Richer per-item metadata when the artifact output carries it (e.g. an intella sample prompt). Omitted when unavailable.',
      items: {
        type: 'object',
        properties: { url: { type: 'string' }, prompt: { type: 'string' } },
        required: ['url'],
      },
    },
  },
  required: ['mediaUrls'],
}

export const FeedItemSchema: JsonSchema = {
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

export const FeedListSchema: JsonSchema = {
  type: 'object',
  properties: { feed: { type: 'array', items: FeedItemSchema } },
  required: ['feed'],
}

export const editionsFeedRoutes: RouteSpec[] = [
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
      path: '/editiones',
      summary: "The caller's own publications of one artifact, newest first. The review queue above carries HELD items only, so a terminal outcome — a moderation refusal, or a publication already live — could not be read back after the session that filed it ended; a publish surface that reopens needs this rather than the memory of the tab that pressed the button. Author-scoped on the publication's own identity: an artifact the caller never published reads as the empty list.",
      auth: true,
      query: [
        { name: 'artifact', description: "The artifact whose publications to list, as '<kind>:<id>' (kind: actum | intella | collectio). Required — an unfiltered listing is not offered here.", required: true, schema: { type: 'string' } },
      ],
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
      method: 'GET',
      path: '/editiones/:id/moderation',
      summary: "The moderation gate's raw verdict for one publication (why it was held or rejected), regardless of current status — the companion to `/editiones/review` for a terminal `rejected` item, which has no queue entry to inspect. Restricted to the platform administrator; the raw reason text is not surfaced to the publishing author.",
      auth: true,
      response: EditionModerationSchema,
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
      path: '/editiones/:id/preview',
      summary: 'The media behind a held publication, for a reviewer to inspect before adjudicating (spec publish-review-visibility.md §2) — resolves the same view the moderation gate used to make its hold decision, for any artifact kind. Restricted to the platform administrator, same gate as approve/reject/confirm-csam.',
      auth: true,
      response: EditionPreviewSchema,
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
]
