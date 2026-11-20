import { authHeaders } from './session';
import { j } from './core';

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
      }),
    }).then(j<{ id: string }>),
};

export default querelaApi;
