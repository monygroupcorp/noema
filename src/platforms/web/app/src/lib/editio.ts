// Frontend mirror of the backend Editio shapes (src/types/editio.ts). Copied, not
// imported, to keep the web app self-contained. User-facing copy must NOT use the
// Latin term "Editio" — say "publish" / "edition" / "post" (crit S.3 glossary).

export type EditioVisibility = 'private' | 'unlisted' | 'feed' | 'marketplace';
export type EditioCustody = 'ours' | 'theirs' | 'both';
export type EditioStatus = 'pending' | 'published' | 'rejected' | 'failed' | 'retracted';
export type ArtifactKind = 'actum' | 'intella' | 'collectio';

export interface ArtifactRef { kind: ArtifactKind; id: string }

export interface Editio {
  id: string;
  artifactRef: ArtifactRef;
  destination: string;                       // 'feed' | 'r2' | 'huggingface' | 'mint' …
  visibility: EditioVisibility;
  custody: EditioCustody;
  by: { animaId: string } | { commitment: string };
  owners?: Array<{ animaId: string; weight: number }>;
  license?: string;
  externalRef?: string;                       // feed post id / HF repo / token id / R2 url
  status: EditioStatus;
  natum: string;                              // born (ISO)
  mutatum: string;                            // changed (ISO)
}

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
