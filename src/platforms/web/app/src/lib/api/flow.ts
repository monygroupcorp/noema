import { askTerms, termsRequestOf } from '../termsGate';
import { ApiRequestError, j, jApi, sseStream } from './core';
import { authHeaders, getActivePurse, readHeaders } from './session';

// The flow's canon verb, derived server-side at query time (`resolveCanonVerb`, noema-054).
// Mirrors the backend's `CanonVerb` union (src/crystal/verbResolver.ts) and the
// `FlowSummarySchema.modusGenus` enum (apiContract.ts) as a local literal type — the web
// app doesn't import backend source, so this list is kept in step with it by hand.
export type CanonVerb =
  | 'make' | 'effect' | 'animate' | 'direct' | 'render'
  | 'chat' | 'describe' | 'transcribe' | 'speak' | 'compose' | 'foley'
  | 'sculpt' | 'lift' | 'scan'
  | 'enhance';

// Optional here (unlike the server's required `modusGenus`) to match this file's existing
// convention of loosening required-on-the-wire fields to optional client-side (see `nomen`/
// `versio` above) — callers that construct a partial FlowSummary (e.g. Canvas.test.ts's
// dedupeFlows fixtures) shouldn't have to supply every field just to typecheck.
export interface FlowSummary { id: string; nomen?: string; versio?: string; categoria?: unknown; modusGenus?: CanonVerb; descriptio?: string }
export interface JsonSchema {
  type: string;
  properties?: Record<string, { type: string; format?: string; default?: unknown; description?: string; title?: string; optiones?: Array<{ value: string; label: string }> }>;
  required?: string[];
}
export interface FlowDescription {
  id: string; nomen: string; versio: string; input: JsonSchema; output?: JsonSchema; familia?: string;
  /** The same optional fields the list carries, so a card can describe a flow from either. */
  descriptio?: string; categoria?: unknown; fundamentumId?: string;
}

export type RunStatus = 'pending' | 'running' | 'complete' | 'failed';

// A standing order — what the user ASKED FOR, as distinct from any one attempt at it. A
// training request survives an infrastructure failure: the order keeps attempting, hourly,
// until it lands or its window closes. Mirrors the server's `RunOrder` projection, so a
// screen reads `state` and never the failure sentence.
export type RunOrderState = 'attempting' | 'scheduled' | 'fulfilled' | 'stopped' | 'cancelled';
export interface RunOrder {
  id: string;
  state: RunOrderState;
  reason?: 'fulfilled' | 'failed' | 'exhausted' | 'cancelled';
  attempts: number;
  attemptsRemaining: number;
  nextAttemptAt?: string;
  until?: string;
  latestRunId?: string;
}

export interface Run {
  id: string;
  status: RunStatus;
  modusId: string;
  exitus?: Record<string, unknown>;
  failure?: { code: string; message: string };
  cost?: string;
  createdAt?: string;
  order?: RunOrder;
  /**
   * Where a run WAITING FOR A WARM POD stands in line — 1-based `place`, and the `depth`
   * of the line it is in. Present only while it waits: a run that went straight onto a pod
   * never carries it, and it is gone once the run is called forward. The line is per
   * substrate image, so the depth counts the runs wanting the same image, not every run.
   */
  queue?: { place: number; depth: number };
}

export interface RunRequest {
  modusId?: string;
  verb?: string;
  aditus: Record<string, unknown>;
  maxImpetus?: string;
  studioId?: string;
  commitment?: string;
  bursaToken?: string;
  // Chosen loras/models (intellaId or slug) — accepted top-level by apiRouter.ts's
  // POST /v1/runs (not nested in aditus). Wired from a concierge ProposalCard's
  // pinnedModels onto the GO run request (noema-099).
  pinnedModels?: string[];
}

const flowApi = {
  listFlows: () => fetch('/v1/flows').then(j<{ flows: FlowSummary[] }>),
  // Takes a signal so a screen can put a deadline on the read (withReadTimeout): a card that
  // waits on this with no bound shows "Loading…" for as long as the tab lives.
  getFlow: (id: string, signal?: AbortSignal) => fetch(`/v1/flows/${id}`, { signal }).then(j<FlowDescription>),
  quote: (body: Pick<RunRequest, 'modusId' | 'verb' | 'aditus'>) =>
    fetch('/v1/runs/quote', { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) })
      .then(j<{ impetus: string; recipient?: string }>),
  // The ONLY route that spends an anonymous purse: when a Vault purse is active, the run
  // request carries ONLY the bursa token — `{ content-type, x-bursa-token }` — and NO
  // identity header (no `authorization`, no `x-commitment`). The server short-circuits on
  // the bursa token and ignores identity anyway (widgetRouter.ts:310 — token-only is the
  // house anonymous contract); attaching a session bearer or the stable anon commitment
  // would let logs/proxies correlate an anonymous spend back to a session or pseudonym.
  // No active purse → the normal identity/anon-commitment path (authHeaders), untouched;
  // every other route keeps authHeaders() regardless.
  //
  // A flow under upstream licence terms (MiniMax H3) is refused with `terms.required` until the
  // caller accepts them. That refusal is answered HERE rather than on each of the screens that
  // start runs: the mounted terms dialog (lib/termsGate) shows the terms, an acceptance is
  // recorded under the same identity the run is sent with, and the run is sent once more.
  // Declining, or no dialog mounted, lets the refusal through unchanged.
  createRun: async (body: RunRequest): Promise<{ run: Run }> => {
    const purse = getActivePurse();
    const headers = purse
      ? { 'content-type': 'application/json', 'x-bursa-token': purse }
      : authHeaders();
    const send = () => fetch('/v1/runs', { method: 'POST', headers, body: JSON.stringify(body) }).then(j<{ run: Run }>);
    try {
      return await send();
    } catch (err) {
      const req = err instanceof ApiRequestError && err.code === 'terms.required' ? termsRequestOf(err.details) : null;
      if (!req || !(await askTerms(req))) throw err;
      await fetch(`/v1/me/terms/${encodeURIComponent(req.terms)}`, { method: 'POST', headers })
        .then(j<{ acceptance: { terms: string; versio: string; acceptedAt: number } }>);
      return send();
    }
  },
  getRun: (id: string) => fetch(`/v1/runs/${id}`, { headers: readHeaders() }).then(j<{ run: Run }>),
  // POST /v1/runs/:id/cancel — give up a run the caller owns. The reservation is released
  // rather than charged, so a run given up while it waits for a warm pod costs nothing; the
  // run then reads `failed` with `cost` 0, which is what the readout says about it.
  // The active purse rides the request for the same reason `createRun` sends it: a run funded
  // from an anonymous purse is owned by that token, and identity headers would address a
  // different owner — or none — and come back `not_found`.
  cancelRun: (id: string) => {
    const purse = getActivePurse();
    const headers = purse ? { 'x-bursa-token': purse } : authHeaders();
    return fetch(`/v1/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST', headers })
      .then(j<{ run: Run }>);
  },
  // The standing order behind a run, and the cancel for it. Owner-scoped server-side off the
  // run — a run id addresses the order, it does not authorise it.
  getRunOrder: (id: string) =>
    fetch(`/v1/runs/${encodeURIComponent(id)}/order`, { headers: readHeaders() })
      .then(j<{ order: RunOrder | null }>),
  revokeRunOrder: (id: string) =>
    fetch(`/v1/runs/${encodeURIComponent(id)}/order/revoke`, { method: 'POST', headers: authHeaders() })
      .then(j<{ order: RunOrder | null }>),
  // SSE — a fetch-based reader, NOT an EventSource. EventSource cannot send headers, and
  // the server route is owner-scoped auth (bearer/x-commitment header only) — a plain
  // EventSource is a structural 401 for every caller. `readHeaders()` covers both a
  // signed-in bearer and the anon commitment. Token stays in a header, never a query
  // param (query params leak into access logs/history).
  streamRun: (id: string) => sseStream(`/v1/runs/${id}/stream`, readHeaders()),
  // GET /v1/me/flows — the caller's own registered flows (owner-scoped), the canvas
  // node picker's "mine" twin of the canonical GET /v1/flows list above.
  listMyFlows: () => fetch('/v1/me/flows', { headers: readHeaders() }).then(jApi<{ flows: FlowSummary[] }>),
};

export default flowApi;
