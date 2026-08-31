// =============================================================================
// API projection types — the public, serialization-safe shapes
// =============================================================================
//
// The internal crystal types (Actum, Modus, …) carry bigint impetus, Date
// timestamps, and Latin field names that external HTTP clients should not see.
// These projection types are the public face: JSON-safe, English-named,
// stable. Pure data — no behaviour lives here.
// =============================================================================

import type { ModelRef } from '../../types/actum.js'

/** Public run status — the externalised projection of ActumStatus. */
export type RunStatus = 'pending' | 'running' | 'complete' | 'failed'

/**
 * Run — the public projection of an Actum for the HTTP API.
 *
 * JSON-safe: `cost` is a string (impetus is a bigint internally) and
 * `createdAt` is an ISO-8601 string (inceptum is a Date internally).
 */
export interface Run {
  id: string
  status: RunStatus
  modusId: string
  /** The outputs produced by the run — present only when available. */
  exitus?: Record<string, unknown>
  /** Populated only when the run failed. */
  failure?: { code: string; message: string }
  /** impetus cost, serialised as a string (bigint → string). */
  cost?: string
  /** When the run started, as an ISO-8601 string. */
  createdAt?: string
  /** For a long run (training) that rescued checkpoints: the latest one. On a failed run this is
   *  the resume anchor — fire a new run with `resumeFrom: url` and the remaining steps. */
  resumeCheckpoint?: { url: string; step: number }
  /** OWNER-SCOPED: the stored effective input the run was cast with, echoed verbatim
   *  (including an unresolved "shuffle" seed sentinel if that's what was stored).
   *  Present only when populated. */
  aditus?: Record<string, unknown>
  /** OWNER-SCOPED: the models pinned at cast time. Present only when populated. */
  pinnedModels?: ModelRef[]
  /** OWNER-SCOPED: the cast-time modus version (plain-named). Present only when populated. */
  modusVersion?: string
  /** The standing order this run belongs to, when it has one (training runs). */
  order?: RunOrder
}

/**
 * RunOrder — the public projection of a standing order (Mandatum): what the user ASKED FOR,
 * as distinct from any one attempt at it.
 *
 * A training run that fails on infrastructure is not the end of the request — the order keeps
 * asking, hourly, until it lands or the day runs out. This shape is how a client learns that
 * without reading a failure sentence: `state` says where the request stands, `reason` says why
 * a stopped one stopped, and the counts and times say what is left.
 */
export interface RunOrder {
  /** The order identifier. */
  id: string
  /**
   * Where the request stands.
   *   'attempting' — an attempt is running right now.
   *   'scheduled'  — the last attempt failed on infrastructure; another one is queued.
   *   'fulfilled'  — an attempt succeeded; nothing is outstanding.
   *   'stopped'    — it ended without succeeding (see `reason`).
   *   'cancelled'  — the holder cancelled it.
   */
  state: 'attempting' | 'scheduled' | 'fulfilled' | 'stopped' | 'cancelled'
  /**
   * Why a terminal order ended.
   *   'fulfilled' — a run succeeded.
   *   'failed'    — it stopped on a real answer; asking again could not have helped.
   *   'exhausted' — the day (or the attempt allowance) ran out without a success.
   *   'cancelled' — the holder ended it.
   */
  reason?: 'fulfilled' | 'failed' | 'exhausted' | 'cancelled'
  /** How many attempts have been made, the first one included. */
  attempts: number
  /** How many attempts the order may still make. */
  attemptsRemaining: number
  /** When the next attempt is due, ISO-8601. Absent once the order is terminal. */
  nextAttemptAt?: string
  /** When the order stops trying regardless of what remains, ISO-8601. */
  until?: string
  /** The most recent attempt's run id — the run to watch right now. */
  latestRunId?: string
}

/**
 * SettledRun — one row of the owner's settled spend history (`GET /v1/me/runs`).
 * The public projection of a retained-on-settle ActumIndex entry. JSON-safe.
 * `costUsd` is DERIVED-at-display (`cost × IMPETUS_USD_RATE`) — never a persisted
 * FMV-at-spend column.
 */
export interface SettledRun {
  /** The run (Actum) identifier. */
  id: string
  /** The flow (modus) this run executed. */
  modusId: string
  /** Human label of the modus at settle (`Modus.nomen`), falling back to `modusId`. */
  modusLabel: string
  /** Always `'settled'` — this surface returns completus runs only. */
  status: 'settled'
  /** Impetus cost, serialised as a string. */
  cost: string
  /** Derived USD cost at the platform reference rate — computed on read, not stored. */
  costUsd: number
  /** When the run settled, as an ISO-8601 string. */
  settledAt?: string
  /** When the run started, as an ISO-8601 string. */
  createdAt?: string
}

/** A page of settled runs plus the owner's lifetime running total. */
export interface RunsPage {
  runs: SettledRun[]
  /** Opaque cursor for the next page; absent on the last page. */
  nextCursor?: string
  /** Lifetime spend total for the owner (all settled runs, not just this page). */
  runningTotal: { impetus: string; usd: number }
}

/**
 * ActivityKind — what a run produced, for the activity read (`GET /v1/me/activity`).
 *
 * Resolved from a modusId table, not a prefix rule: pod flows carry essentia-derived
 * ids that no prefix classifies. `generation` is the catch-all — a row whose modus is
 * not one of the named asset-producing flows is reported as a generation.
 */
export type ActivityKind = 'training' | 'caption' | 'decompose' | 'generation'

/** Lifecycle of one activity row: in-flight, or settled successfully. */
export type ActivityStatus = 'running' | 'settled'

/**
 * ActivityDoor — the way back to what a run produced: id references into the
 * canonical asset stores (never copies of the assets). Every field is optional;
 * a field the run did not produce is absent rather than guessed.
 */
export interface ActivityDoor {
  /** The registered model (Intella) id a training run produced. */
  modelId?: string
  /** The dataset the run trained on / captioned / decomposed. */
  datasetId?: string
  /** The captionset the run produced or decomposed. */
  captionsetId?: string
  /** First media URL among the run's outputs, when one is trivially present. */
  mediaUrl?: string
}

/**
 * ActivityRow — one run in the owner's activity read. JSON-safe.
 *
 * A read-only projection composed from the owner-scoped run index: no new
 * persisted column, no lifecycle change.
 */
export interface ActivityRow {
  /** The run (Actum) identifier. */
  actumId: string
  /** What the run produced. */
  kind: ActivityKind
  /** The flow (modus) the run executed. */
  modusId: string
  /** Human label of the modus, when the index row carries one. */
  modusLabel?: string
  /** In-flight or settled. */
  status: ActivityStatus
  /** When the run started, as an ISO-8601 string. */
  createdAt?: string
  /** When the run settled, as an ISO-8601 string. Absent while in flight. */
  settledAt?: string
  /** The link to the run's artifact, when one is resolvable. */
  door?: ActivityDoor
}

/** A page of the owner's activity — in-flight and settled runs, newest first. */
export interface ActivityPage {
  activity: ActivityRow[]
  /** Opaque cursor for the next page of settled rows; absent on the last page. */
  nextCursor?: string
}

/** Public collection status — the externalised projection of CollectioStatus.
 *  `draft` = authored but not yet fired (tractus still editable). */
export type CollectionStatus = 'draft' | 'pending' | 'running' | 'complete' | 'cancelled'

/**
 * Team — the public projection of a Sodalitas (a fellowship of Animae that
 * co-owns work). JSON-safe; `createdAt` is ISO-8601.
 */
export interface Team {
  id: string
  nomen: string
  /** Member Anima ids (includes the founder). */
  members: string[]
  /** The founder's Anima id. */
  founder: string
  createdAt: string
}

/**
 * Project — the public projection of a Provincia (an account-owned workspace
 * lens). JSON-safe; timestamps are ISO-8601. Holdings are id references into
 * the canonical asset stores (datasets / models / collections) — never copies.
 */
export interface Project {
  id: string
  /** The owning Anima id (the project's hard ownership boundary). */
  owner: string
  /** Display name. */
  name: string
  /** Optional description. */
  desc?: string
  /** Presentation hints (glyph + color). */
  glyph?: string
  color?: string
  /** Filed dataset ids. */
  datasetIds: string[]
  /** Filed model (Intella) ids. */
  modelIds: string[]
  /** Filed collection (Collectio) ids. */
  collectionIds: string[]
  /** Optional referenced Team (Sodalitas) id — the shared member set. */
  teamId?: string
  createdAt: string
  updatedAt: string
}

/**
 * Collection — the public projection of a Collectio (a generated collection /
 * batch) for the HTTP API. The internal Collectio is keyed by `numerus` /
 * `completae` / `fractae` and a Latin status; this is the JSON-safe English face.
 */
export interface Collection {
  id: string
  nomen?: string
  status: CollectionStatus
  modusId: string
  /** Target piece count (the size of the run). */
  total: number
  /** Content-address of the generative config (`sha256:<hex>`) — the NFT provenance hash. */
  provenanceHash: string
  /** Per-artifact ownership split (team-owned collections only) — animaId → weight (sum 1). */
  owners?: Array<{ animaId: string; weight: number }>
  /** The trait axes + values (the parameter grid). Exposed so the garden/rules
   *  authoring surfaces can read + edit them; frozen once the collection is fired. */
  tractus?: import('../../types/collectio.js').Tractus[]
  /** Whether each piece is held for review before it counts (see Collectio.reviewEnabled). */
  reviewEnabled?: boolean
  /** Dispatching new pieces is held (in-flight pieces still finish). Present + `true`
   *  only while paused — absent means running normally. Survives a restart. */
  paused?: boolean
  /** Acta dispatched but not yet settled (nascens/agens) — provisioning or executing.
   *  Derived on read from the acta list, not stored. Only populated by `getCollection`
   *  (the run screen's poll target); absent elsewhere (e.g. `listCollections`). */
  inFlight?: number

  // The piece counters below are the collection's own bookkeeping, and they answer one
  // question each so a poller does not have to infer anything from behaviour:
  //
  //   completed      generated AND accepted — counts toward `total`
  //   pendingReview  generated, awaiting a reviewer's decision — does not yet count
  //   failed         did not generate
  //   rejected       generated, then declined by a reviewer — re-rolled, not counted
  //
  // `rejected` raises the dispatch budget by exactly the piece it removed from the
  // target, so it cancels out and every dispatched piece is in exactly one bucket:
  //
  //   completed + pendingReview + failed + inFlight + <not yet dispatched> === total
  //
  // A caller therefore computes what is outstanding as
  // `total - completed - pendingReview - failed - inFlight`, and the five sum to `total`.

  /** Pieces generated and held for a reviewer's decision (`reviewOutcome: 'pending'`) —
   *  real, paid-for work, not yet counted in `completed`. Always 0 while review is off. */
  pendingReview: number
  /** Pieces generated AND accepted — approved by a reviewer when review is on, every
   *  successful generation when it is off. This is what counts toward `total`. */
  completed: number
  /** Pieces that failed to generate so far. */
  failed: number
  /** Pieces a reviewer rejected so far (distinct from failed — the piece generated,
   *  and a replacement is dispatched for it). */
  rejected: number
  /** Total impetus across completed pieces, serialised as a string. */
  cost?: string
  /** When the collection started, ISO-8601. */
  createdAt?: string
  /** When it finished (or was cancelled), ISO-8601. */
  completedAt?: string
}

/**
 * CollectionPiece — one generated piece of a Collection, for the curation queue.
 * The Actum's produced output (media, so a client renders it) + its stamped trait
 * attributes + its review state. `review` is 'pending' (awaiting review), 'approved',
 * 'rejected' (rerolled), or 'none' (review not enabled → auto-counted).
 */
export interface CollectionPiece {
  actumId: string
  review: 'pending' | 'approved' | 'rejected' | 'none'
  /** The Actum's exitus (media URL under its declared Porta key), when resolvable. */
  output?: Record<string, unknown>
  /** The trait attributes stamped on this piece. */
  attributes?: Array<{ trait_type: string; value: string }>
}

/**
 * Edition — the public projection of an Editio (a publication record). JSON-safe;
 * `createdAt`/`updatedAt` are ISO-8601. An Edition references a canonical
 * artifact and records where + under what policy it was put forth.
 */
export interface Edition {
  id: string
  /** The canonical artifact put forth. */
  artifact: { kind: 'actum' | 'intella' | 'collectio'; id: string }
  /** Adapter key — 'feed' | 'r2' | 'huggingface' | 'mint' | … */
  destination: string
  visibility: 'private' | 'unlisted' | 'feed' | 'marketplace'
  custody: 'ours' | 'theirs' | 'both'
  /** Lifecycle: pending → published | rejected | failed; retracted on unpublish. */
  status: 'pending' | 'published' | 'rejected' | 'failed' | 'retracted'
  /** Human-review outcome when the moderation gate held this publication (spec §4):
   *  pending (awaiting a reviewer) | approved (cleared → publishes) | rejected. Absent
   *  on the normal path. */
  reviewOutcome?: 'pending' | 'approved' | 'rejected'
  /** The destination's handle — feed post id / HF repo / token id / R2 url. */
  externalRef?: string
  /** Rights split snapshot (animaId → weight), when team-owned. */
  owners?: Array<{ animaId: string; weight: number }>
  /** License tag — 'catalog' (our liability) | a BYO license id. */
  license?: string
  createdAt: string
  updatedAt: string
}

/**
 * FeedItem — one entry in the public feed read (`GET /v1/feed`). The published
 * Editio plus the referenced artifact's produced output (an Actum's exitus
 * media), so a client can render it without a second fetch.
 */
export interface FeedItem {
  /** The Editio id (the feed entry id). */
  editionId: string
  artifact: { kind: 'actum' | 'intella' | 'collectio'; id: string }
  /** The artifact's produced output (an Actum's exitus), when resolvable. */
  output?: Record<string, unknown>
  createdAt: string
}
