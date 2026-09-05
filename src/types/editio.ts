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
 * Human-review outcome for a publication the moderation gate HELD (spec §4). Mirrors
 * the `CollectioCursor.reviewOutcome` precedent rather than inventing a parallel state:
 *   pending  — the gate escalated (e.g. the pre-Thorn NSFW router); status stays
 *              `pending` but the worker SKIPS it until a person adjudicates.
 *   approved — a reviewer cleared it; the settle re-runs and BYPASSES the gate → publishes.
 *   rejected — a reviewer declined it; the Editio goes to `status:'rejected'`.
 * Absent = never held (the normal path). A hold is NEVER a CSAM verdict / auto-report.
 */
export type ReviewOutcome = 'pending' | 'approved' | 'rejected'

/**
 * EditioModeration — the `ModerationGate.scan()` verdict that HELD or REJECTED this
 * publication, recorded on the Editio itself (docs/spec/moderation-reject-reason.md).
 * Written on BOTH refusal branches of `_settlePublication` — a hold is not better off
 * than a reject here; either way the gate's diagnostic now survives past the call that
 * produced it. `reason` is the classifier's raw text — admin-only when surfaced (see
 * `Edition.moderationNote` in `allocutio/api/types.ts` for the author-facing generic
 * form). Absent when never flagged.
 */
export interface EditioModeration {
  /** The gate's verdict.reason, verbatim. May describe detection internals. */
  reason: string
  /** True only when this verdict HELD (vs. terminally rejected). */
  hold?: boolean
  /** When the gate produced this verdict, ISO-8601. */
  scannedAt: string
}

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
   * Human-review outcome when the moderation gate HELD this publication (spec §4).
   * `pending` keeps `status:'pending'` but makes `claimPending` skip it (no re-scan
   * loop) until an admin approves (→ re-settle, gate bypassed) or rejects (→ rejected).
   * Absent on the normal path (never held).
   */
  reviewOutcome?: ReviewOutcome
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
  /** The moderation gate's verdict when it HELD or REJECTED this publication. Absent
   *  on the normal (approved/never-gated) path. */
  moderation?: EditioModeration
  /**
   * This publication's own PUBLIC copy of an artifact output that was private
   * (`noema-private://` markers - private generation, noema-347).
   *
   * The artifact stays canonical and stays private: the run's `exitus` still holds the
   * markers and the object in the private bucket is untouched. Publishing is the deliberate
   * act that makes those particular bytes public, so the copy belongs to the PUBLICATION and
   * not to the run - it is written under the Editio's own key, every downstream reader (the
   * destination adapter, the feed) renders it, and `retract` deletes it again.
   *
   * Written only once the moderation gate has passed, so a held or rejected publication never
   * puts private bytes in a public bucket. Absent for the ordinary case of a public output.
   */
  hostedOutput?: Record<string, unknown>
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
  /** Restrict to ANY of these identified authors (animaIds) — the collection-gallery
   *  scope (all agents of one NFT collection). Same public clamp as `author`. */
  authorAnimaIds?: string[]
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
  /**
   * Editiones the moderation gate HELD (`reviewOutcome:'pending'`), newest first — the
   * review queue (spec §4). Author-scoped when `by` is given (a creator sees their own
   * held items); unscoped for the admin queue (all pending review).
   */
  listHeld(by?: Editio['by']): Promise<Editiones>
  create(input: Omit<Editio, 'id' | 'natum' | 'mutatum' | 'status'>): Promise<Editio>
  update(id: string, patch: Partial<Pick<Editio, 'status' | 'externalRef' | 'visibility' | 'custody' | 'reviewOutcome' | 'leasedUntil' | 'moderation' | 'hostedOutput'>>): Promise<Editio>
  /**
   * Atomically claim one settle-able publication for a worker: the oldest `pending`
   * Editio with no live lease AND not awaiting review (`reviewOutcome !== 'pending'`),
   * stamping a fresh lease (`now + leaseMs`) and bumping `attempts`. Returns it, or null
   * when none is claimable. Held items (reviewOutcome:'pending') are skipped so a hold
   * does not re-scan in a loop; an admin approval clears the hold and makes it claimable. The atomic claim is what
   * makes the store a safe durable queue — concurrent workers never grab the same row,
   * and a lapsed lease (crashed worker) is reclaimed on a later call. See
   * `PublicationWorker`.
   */
  claimPending(now: Date, leaseMs: number): Promise<Editio | null>
}
