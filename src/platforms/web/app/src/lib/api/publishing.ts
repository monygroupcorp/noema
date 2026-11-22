import type { ArtifactRef, Editio, EditionModerationDetail, EditionPreview, FeedFilter, FeedItem, PublishRequest } from '../editio';
import { j } from './core';
import { authHeaders, readHeaders } from './session';

const publishingApi = {
  // ── Publishing (Editio) — feed read + publish/retract write ──────────────────
  // GET /v1/feed — public, NO auth. Newest-first published, public-surface editions.
  feed: (filter: FeedFilter = {}) => {
    const q = new URLSearchParams();
    if (filter.visibility) q.set('visibility', filter.visibility);
    if (filter.destination) q.set('destination', filter.destination);
    if (filter.limit != null) q.set('limit', String(filter.limit));
    const qs = q.toString();
    return fetch(`/v1/feed${qs ? `?${qs}` : ''}`).then(j<{ feed: FeedItem[] }>);
  },
  // POST /v1/editiones — publish an artifact. Public surfaces return a `pending`
  // edition (async moderation) → it goes live once the worker settles it.
  publish: (body: PublishRequest) =>
    fetch('/v1/editiones', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ edition: Editio }>),
  // GET /v1/editiones/:id — poll a publication (author-scoped) to watch an async
  // settle land: an archive ZIP build finishing (`externalRef` = the download url),
  // or a public surface being gated (→ rejected).
  getEdition: (id: string) => fetch(`/v1/editiones/${id}`, { headers: readHeaders() })
    .then(j<{ edition: Editio }>),
  retract: (id: string) =>
    fetch(`/v1/editiones/${id}/retract`, { method: 'POST', headers: authHeaders() })
      .then(j<{ edition: Editio }>),

  // ── Feed moderation review (Editio held-queue, spec §4) ──────────────────────
  // GET /v1/editiones/review — the review queue. An author sees their OWN held items
  // ("your publish is under review"); the platform admin (me.admin) sees ALL of them.
  // approve/reject/confirm-csam are PLATFORM-ADMIN ONLY server-side (403 otherwise).
  listReviewQueue: () => fetch('/v1/editiones/review', { headers: readHeaders() })
    .then(j<{ editions: Editio[] }>),
  // GET /v1/editiones?artifact=<kind>:<id> — the caller's OWN publications of one
  // artifact, newest first. The review queue above holds only what is still awaiting a
  // reviewer, so a refusal and an already-live publication were both unreadable once the
  // tab that filed them closed; a publish screen that reopens reads this instead.
  listMyEditions: (artifact: ArtifactRef) =>
    fetch(`/v1/editiones?artifact=${encodeURIComponent(`${artifact.kind}:${artifact.id}`)}`, { headers: readHeaders() })
      .then(j<{ editions: Editio[] }>),
  // GET /v1/editiones/:id/preview — the media behind a held publication, for ANY artifact
  // kind (not just an actum generation run) — resolves the same view the moderation gate
  // used to make its hold decision. PLATFORM-ADMIN ONLY server-side (same gate as
  // approve/reject/confirm-csam); a non-admin caller is refused.
  getEditionPreview: (id: string) =>
    fetch(`/v1/editiones/${id}/preview`, { headers: readHeaders() }).then(j<EditionPreview>),
  // GET /v1/editiones/:id/moderation — the gate's RAW verdict (why it held or refused).
  // PLATFORM-ADMIN ONLY server-side. The author-facing wording is `Edition.moderationNote`;
  // this is what the reviewer adjudicating the hold needs and the author must never see.
  getEditionModeration: (id: string) =>
    fetch(`/v1/editiones/${id}/moderation`, { headers: readHeaders() }).then(j<EditionModerationDetail>),
  // Clear a moderation hold → the item re-settles and publishes.
  approveEdition: (id: string) =>
    fetch(`/v1/editiones/${id}/approve`, { method: 'POST', headers: authHeaders() }).then(j<{ edition: Editio }>),
  // Decline a held publication → terminal 'rejected'. Files NO report.
  rejectEdition: (id: string) =>
    fetch(`/v1/editiones/${id}/reject`, { method: 'POST', headers: authHeaders() }).then(j<{ edition: Editio }>),
  // Affirmatively confirm a held item is CSAM → reject + file the NCMEC report. The only
  // review action that reports; a legal duty on human confirmation (18 U.S.C. §2258A).
  confirmCsam: (id: string) =>
    fetch(`/v1/editiones/${id}/confirm-csam`, { method: 'POST', headers: authHeaders() }).then(j<{ edition: Editio }>),
};

export default publishingApi;
