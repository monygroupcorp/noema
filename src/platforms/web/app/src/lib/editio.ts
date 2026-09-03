// Frontend mirror of the backend Editio shapes (src/types/editio.ts). Copied, not
// imported, to keep the web app self-contained. User-facing copy must NOT use the
// Latin term "Editio" — say "publish" / "edition" / "post" (crit S.3 glossary).

export type EditioVisibility = 'private' | 'unlisted' | 'feed' | 'marketplace';
export type EditioCustody = 'ours' | 'theirs' | 'both';
export type EditioStatus = 'pending' | 'published' | 'rejected' | 'failed' | 'retracted';
// The human-review outcome for an item the moderation gate HELD. Absent = never held
// (the normal path); 'pending' = awaiting a reviewer; 'approved'/'rejected' = adjudicated.
export type ReviewOutcome = 'pending' | 'approved' | 'rejected';
export type ArtifactKind = 'actum' | 'intella' | 'collectio';

export interface ArtifactRef { kind: ArtifactKind; id: string }

// Mirrors the backend Edition projection (src/allocutio/api/types.ts `Edition`) exactly —
// what GET/POST /v1/editiones/* actually return (artifact, createdAt/updatedAt), NOT the
// internal Latin Editio store shape.
export interface Editio {
  id: string;
  artifact: ArtifactRef;                      // the canonical artifact put forth
  destination: string;                       // 'feed' | 'r2' | 'huggingface' | 'mint' …
  visibility: EditioVisibility;
  custody: EditioCustody;
  owners?: Array<{ animaId: string; weight: number }>;
  license?: string;
  externalRef?: string;                       // feed post id / HF repo / token id / R2 url
  status: EditioStatus;
  reviewOutcome?: ReviewOutcome;              // present only for a moderation-gate HELD item
  createdAt: string;                          // ISO
  updatedAt: string;                          // ISO
}

// The `GET /v1/editiones/:id/preview` response (admin-only) — the media behind a held
// publication, resolved server-side the same way the moderation gate resolved it to make
// its hold decision. `items` carries richer per-item metadata (e.g. a sample's prompt) when
// the artifact output has it; `mediaUrls` alone is always present.
export interface EditionPreviewItem { url: string; prompt?: string }
export interface EditionPreview { mediaUrls: string[]; items?: EditionPreviewItem[] }

export interface FeedFilter {
  visibility?: EditioVisibility;
  destination?: string;
  limit?: number;
}

// One entry from GET /v1/feed — the published edition plus the referenced artifact's
// produced output (an Actum's exitus media), so a tile renders without a second fetch.
// Mirrors the backend FeedItem (src/allocutio/api/types.ts).
export interface FeedItem {
  editionId: string;
  artifact: ArtifactRef;
  output?: Record<string, unknown>;
  createdAt: string;
}

export interface PublishRequest {
  artifact: ArtifactRef;
  destination: string;                        // 'feed' for the first cut
  visibility: EditioVisibility;
  custody: EditioCustody;
  license?: string;
  teamId?: string;
  owners?: Array<{ animaId: string; weight: number }>;
}

// User-facing labels — never surface the Latin / status enums raw.
export const VISIBILITY_LABEL: Record<EditioVisibility, string> = {
  private: 'Private',
  unlisted: 'Unlisted — anyone with the link',
  feed: 'Public feed',
  marketplace: 'Marketplace',
};

export const STATUS_LABEL: Record<EditioStatus, string> = {
  pending: 'In review',
  published: 'Live',
  rejected: 'Rejected',
  failed: 'Failed',
  retracted: 'Removed',
};

// Retract is allowed only where the destination is reversible (feed / bucket).
// A mint is permanent — never offer retract for it.
export const canRetract = (e: Editio) =>
  e.status === 'published' && e.destination !== 'mint';
