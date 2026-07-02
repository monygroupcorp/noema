// =============================================================================
// EDITIO — the publication record
// =============================================================================
//
// "Editio" = an edition, a putting-forth (Latin, from edere: to give out / to
// publish). An Editio is NOT a copy of an artifact — it is the record that an
// already-canonical artifact (an Actum, an Intella, a Collectio) was *put forth*
// to a destination, under a chosen visibility / custody / rights arrangement,
// plus the handle the destination returned (a feed post id, an HF repo, a token
// id, an R2 url). One artifact may have MANY Editiones (private bucket + public
// feed + minted), each its own record. See docs/spec/publishing.md §5.
//
// Publishing = (a canonical artifact) × (a destination adapter) × (a policy).
//   - the artifact stays singular and canonical — Editio only *references* it;
//   - the destination is a `PublicationAdapter`, registered by `destination` key;
//   - the policy is { visibility, custody, owners, license }.
//
// VALUE ENUMS ARE ENGLISH (visibility/custody): they are user-facing policy, not
// internal primitives. We Latinize the primitive (Editio / Editionum), not the
// policy vocabulary (spec §8).
// =============================================================================

/** Which canonical artifact an Editio puts forth. Editio never copies it. */
export type ArtifactKind = 'actum' | 'intella' | 'collectio'

/** A reference to the canonical artifact being published. */
export interface ArtifactRef {
  kind: ArtifactKind
  /** The artifact's id (Actum.id / Intella.id / Collectio.id). */
  id: string
}

/**
 * Visibility — the public-exposure axis of the policy surface.
 *   private     — owner only.
 *   unlisted    — anyone with the link (no feed listing).
 *   feed        — public in our feed.
 *   marketplace — public + listed externally / on-chain.
 * `feed` and `marketplace` are PUBLIC surfaces — they MUST pass the async
 * moderation gate before going live (spec §8). Never a synchronous publish.
 */
export type EditioVisibility = 'private' | 'unlisted' | 'feed' | 'marketplace'

/**
 * Custody — who holds the bytes / metadata.
 *   ours   — we host bytes/metadata.
 *   theirs — their account / wallet / bucket.
 *   both   — we host + mirror to theirs.
 */
export type EditioCustody = 'ours' | 'theirs' | 'both'

/**
 * Status — the publication lifecycle.
 *   pending   — created, awaiting moderation + adapter publish (public surfaces).
 *   published — live; `externalRef` is the adapter's handle.
 *   rejected  — the moderation gate refused a public publish.
 *   failed    — the adapter threw.
 *   retracted — unpublished where the destination allowed it (feed/bucket; never mint).
 */
export type EditioStatus = 'pending' | 'published' | 'rejected' | 'failed' | 'retracted'

/**
 * Editio — one publication of one artifact to one destination under one policy.
 */
export interface Editio {
  id: string
  /** The canonical artifact put forth (referenced, never copied). */
  artifactRef: ArtifactRef
  /** Adapter key — e.g. 'feed' | 'r2' | 'huggingface' | 'mint'. */
  destination: string
  visibility: EditioVisibility
  custody: EditioCustody
  /** Who published — the same `{animaId} | {commitment}` union the ledger uses. */
  by: { animaId: string } | { commitment: string }
  /**
   * Rights split, snapshotted at publish (from a Sodalitas). animaId → weight
   * (sum ~1). Absent for single-owner publications.
   */
  owners?: Array<{ animaId: string; weight: number }>
  /** License tag — 'catalog' (our liability) | a BYO license id. */
  license?: string
  /** The adapter's returned handle: feed post id / HF repo / token id / R2 url. */
  externalRef?: string
  status: EditioStatus
  /**
   * Worker lease — when the current settle attempt's claim EXPIRES. A pending Editio
   * is the durable work record (the store IS the queue); a `PublicationWorker` claims
   * it by stamping a lease, so two workers never settle it at once and a crashed
   * worker's claim becomes reclaimable once the lease lapses (restart-safe). Absent =
   * unclaimed.
   */
  leasedUntil?: Date
  /** How many times a worker has claimed this for settling — capped (→ 'failed'). */
  attempts?: number
  /** "natum" = born — when the publish was requested. */
  natum: Date
  /** "mutatum" = changed — when the status/handle last changed. */
  mutatum: Date
}

/** "Editiones" — nominative plural. */
export type Editiones = Editio[]

/** Read filter for the public feed. */
export interface FeedFilter {
  /** Restrict to one visibility surface (default: 'feed'). */
  visibility?: EditioVisibility
  /** Restrict to one destination/adapter key. */
  destination?: string
  /** Restrict to one author (same identity union as `by`). Still clamped to the
   *  public `status:'published'` + public-visibility surface — this scopes the feed
   *  to one creator/agent, it never widens it to their private editions. */
  author?: Editio['by']
  /** Max items (newest first). */
  limit?: number
}

/**
 * Editionum — genitive plural "of the editions." The publication store.
 *
 * `create` always starts an Editio at `status:'pending'` (the moderation/publish
 * pipeline settles it). `listFeed` is the public-surface read (published only).
 */
export interface Editionum {
  find(id: string): Promise<Editio | null>
  /** Every Editio of one artifact (all destinations / statuses). */
  listByArtifact(ref: ArtifactRef): Promise<Editiones>
  /** Every Editio published by one identity. */
  listByAuthor(by: Editio['by']): Promise<Editiones>
  /** Published, public-surface Editiones, newest first — the feed read. */
  listFeed(filter?: FeedFilter): Promise<Editiones>
  create(input: Omit<Editio, 'id' | 'natum' | 'mutatum' | 'status'>): Promise<Editio>
  update(id: string, patch: Partial<Pick<Editio, 'status' | 'externalRef' | 'visibility' | 'custody'>>): Promise<Editio>
  /**
   * Atomically claim one settle-able publication for a worker: the oldest `pending`
   * Editio with no live lease, stamping a fresh lease (`now + leaseMs`) and bumping
   * `attempts`. Returns it, or null when none is claimable. The atomic claim is what
   * makes the store a safe durable queue — concurrent workers never grab the same row,
   * and a lapsed lease (crashed worker) is reclaimed on a later call. See
   * `PublicationWorker`.
   */
  claimPending(now: Date, leaseMs: number): Promise<Editio | null>
}
