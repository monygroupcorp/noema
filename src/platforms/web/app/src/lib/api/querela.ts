import { authHeaders, readHeaders } from './session';
import { j, jApi } from './core';

// Querela — an in-app report (bug/feature/feedback), noema-100's backend contract
// (src/types/Querela.ts). Mirrored here (not imported) — the web app doesn't import
// backend source (same convention as `CanonVerb` below).
export type QuerelaKind = 'bug' | 'feature' | 'feedback' | 'abuse';
// Auto-captured client state at submit time — the user never types this. `runId`/`actumId`
// are populated only when the current route carries one (e.g. /train/run/:id); omitted
// otherwise. See ReportModal.tsx.
export interface QuerelaContext {
  route?: string;
  runId?: string;
  actumId?: string;
  userAgent?: string;
  /** Best-effort error text surfaced by the ErrorBoundary or a global error handler —
   *  not typed by the user. See reportClientError() in ./session. */
  clientError?: string;
}

// The admin triage surface (GET/PATCH /v1/admin/reports, querelaAdminRouter.ts) —
// minimax-h3-violation-takedown. Mirrors `Querela` (src/types/Querela.ts) minus nothing;
// the admin reads the whole record, same convention as `PartnerRequest` above.
export type QuerelaStatus = 'new' | 'closed';
export type QuerelaVerdict = 'violation' | 'dismissed';
export interface QuerelaReport {
  id: string;
  ownerKey: string;
  kind: QuerelaKind;
  status: QuerelaStatus;
  description: string;
  feature?: string | null;
  capturedState?: { route?: string; runId?: string; actumId?: string } | null;
  clientError?: string | null;
  device?: string | null;
  userAgent?: string | null;
  subjectOwnerKey?: string | null;
  useTerms?: string[] | null;
  verdict?: QuerelaVerdict | null;
  natum: string;
  mutatum: string;
}

// What a confirmed-violation PATCH's takedown did to the reported run's output — absent on a
// status-only PATCH or a `dismissed` verdict (nothing to take down).
export interface QuerelaTakedown {
  retracted?: string[];
  skipped?: Array<{ id: string; destination: string; reason: string }>;
  privatizedVestigia?: string[];
  error?: string;
}

export interface QuerelaStanding {
  terms: string;
  strikes: number;
  suspended: boolean;
}

const querelaApi = {
  // POST /v1/reports — file a Querela (bug/feature/feedback), noema-100's report store.
  // Anon-capable via the same identity-attach pattern as every other authenticated write
  // (authHeaders(): bearer if signed in, else the anon commitment). `context` is auto-captured
  // client state (route/run-id/userAgent) — the user never types it; see ReportModal.tsx.
  submitReport: (kind: QuerelaKind, description: string, context: QuerelaContext) =>
    fetch('/v1/reports', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        kind,
        description,
        capturedState: { route: context.route, runId: context.runId, actumId: context.actumId },
        userAgent: context.userAgent,
        ...(context.clientError ? { clientError: context.clientError } : {}),
      }),
    }).then(j<{ id: string }>),

  // ADMIN — GET/PATCH /v1/admin/reports (querelaAdminRouter.ts), platform-admin only
  // server-side (client gate is cosmetic, same convention as every other admin surface here).
  // `kind`/`status` each narrow the list; omit either to see every report regardless.
  adminListReports: (filter?: { kind?: QuerelaKind; status?: QuerelaStatus }) => {
    const qs = new URLSearchParams();
    if (filter?.kind) qs.set('kind', filter.kind);
    if (filter?.status) qs.set('status', filter.status);
    const query = qs.toString();
    return fetch(`/v1/admin/reports${query ? `?${query}` : ''}`, { headers: readHeaders() })
      .then(jApi<{ reports: QuerelaReport[] }>);
  },
  // Triage: set status, and on an `abuse` report a verdict. A `violation` verdict closes the
  // report, strikes the subject, AND takes the reported run's output down — the response's
  // `subject`/`takedown` reflect what that verdict did.
  adminDecideReport: (id: string, patch: { status?: QuerelaStatus; verdict?: QuerelaVerdict }) =>
    fetch(`/v1/admin/reports/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: authHeaders(),
      body: JSON.stringify(patch),
    }).then(jApi<{ report: QuerelaReport; subject?: QuerelaStanding[]; takedown?: QuerelaTakedown }>),
};

export default querelaApi;
