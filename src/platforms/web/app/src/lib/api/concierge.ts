import { j } from './core';
import { authHeaders, getActivePurse, readHeaders } from './session';

// ── Concierge (colloquia) — noema-095's HTTP surface ──────────────────────────
// Mirrors src/allocutio/api/colloquiaRouter.ts + ConciergeAgent.ts's wire shapes
// (the web app doesn't import backend source — kept in step by hand, same
// convention as CanonVerb above).
export interface Colloquium {
  id: string;
  status: string;
  titulus?: string;
  /** The project this thread is filed under (noema-111). Absent → Uncategorized. */
  projectId?: string;
  tabulaId?: string;
  modoId?: string;
  natum: string;
  mutatum: string;
}
// A thread as returned by GET /v1/colloquia (list) — a Colloquium plus a short preview
// (the first user message, truncated) so the thread list is legible without hydrating it.
export interface ColloquiumSummary extends Colloquium {
  preview: string;
}
// The full thread as returned by GET /v1/colloquia/:id — the colloquium + its dicta, for resume.
export interface ColloquiumThread {
  colloquium: Colloquium;
  dicta: Dictum[];
}
export interface ConciergeTokenUsage { totalTokens: number; promptTokens?: number; completionTokens?: number }
export interface ConciergeQuote { impetus: string; recipient: string }
export interface ConciergeProposal {
  kind: 'proposal';
  modusId?: string;
  verb?: string;
  aditus: Record<string, unknown>;
  pinnedModels: string[];
  quote: ConciergeQuote;
  embellishedPrompt: string;
  rationale: string;
  tokenUsage: ConciergeTokenUsage;
  priorRunId?: string;
  delta?: string;
  memoryDelta?: ConciergeMemoryDelta;
}
// An in-app destination a reply may point at (noema-367). Validated server-side against the
// concierge's route allowlist; an invalid one never arrives, it is dropped there.
export interface ConciergeDestination { path: string; label: string }
// The three writes the concierge may PROPOSE (the author ladder). It never performs one: the
// payload arrives here as data, WriteProposalCard shows it whole, the user amends it, and GO
// calls the same api.* method the corresponding screen already calls. An action outside these
// three never arrives — the agent-side allowlist drops it and only the reply text comes through.
export type ConciergeWriteAction = 'create_dataset' | 'patch_collection_draft' | 'set_preference';
export interface ConciergeWrite { action: ConciergeWriteAction; payload: Record<string, unknown> }
// What the concierge asks to remember (or forget) about the caller at the end of a turn. The
// CLIENT applies it — see lib/conciergeMemory.ts — through PUT /v1/me/generatio.
export interface ConciergeMemoryDelta { add?: string[]; remove?: string[] }
export interface ConciergeReply {
  kind: 'reply';
  text: string;
  destination?: ConciergeDestination;
  write?: ConciergeWrite;
  memoryDelta?: ConciergeMemoryDelta;
  tokenUsage: ConciergeTokenUsage;
}
export type ConciergeResult = ConciergeProposal | ConciergeReply;
export interface Dictum {
  id: string;
  colloquiumId: string;
  genus: 'user' | 'agent' | 'systema';
  corpus: string;
  signaIds: string[];
  turnKey?: string;
  natum: string;
}

// A turnKey — the caller-supplied idempotency key required by POST /v1/colloquia/:id/dicta
// (colloquiaRouter.ts). One per dicta call; a resend of the exact same failed call would
// reuse it (not implemented by callers here — each call mints a fresh one, matching the
// "an accepted free turn, never a double" invariant on the crashed-before-charge path).
// Shared by Chat.tsx and shell/Concierge.tsx — kept here (not in either screen file) to
// avoid a Chat.tsx <-> AppShell <-> Concierge.tsx import cycle (Concierge is mounted by
// every AppShell page, including Chat's own).
export function newTurnKey(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

const conciergeApi = {
  // ── Concierge (colloquia, noema-095) ──────────────────────────────────────
  // Same auth pattern as createRun (Decision record Q4, noema-099): an active
  // Vault purse sends ONLY the bursa token, no identity header; otherwise the
  // normal authHeaders() bearer/anon-commitment path.
  // POST /v1/colloquia — start a conversation thread. `projectId` (noema-111) files the
  // thread under the active project; omit it for the idle/uncategorized dock.
  createColloquium: (body: { titulus?: string; projectId?: string; tabulaId?: string; modoId?: string; bursaToken?: string } = {}) => {
    const purse = getActivePurse();
    const headers = purse ? { 'content-type': 'application/json', 'x-bursa-token': purse } : authHeaders();
    return fetch('/v1/colloquia', { method: 'POST', headers, body: JSON.stringify(body) }).then(j<{ colloquium: Colloquium }>);
  },
  // GET /v1/colloquia — the caller's own threads (owner-scoped server-side), newest first,
  // each with a short preview. Feeds the thread-list UI (noema-111). Purse-aware like
  // createColloquium: an active Vault purse scopes to the bursaToken ownerKey (Decision Q4).
  listColloquia: () => {
    const purse = getActivePurse();
    const headers = purse ? { 'x-bursa-token': purse } : readHeaders();
    return fetch('/v1/colloquia', { headers }).then(j<{ colloquia: ColloquiumSummary[] }>);
  },
  // GET /v1/colloquia/:id — the full thread (colloquium + dicta) for resume; 404 if not the
  // caller's (same authz as the dicta POST). noema-111.
  getColloquium: (id: string) => {
    const purse = getActivePurse();
    const headers = purse ? { 'x-bursa-token': purse } : readHeaders();
    return fetch(`/v1/colloquia/${encodeURIComponent(id)}`, { headers }).then(j<ColloquiumThread>);
  },
  // POST /v1/colloquia/:id/dicta — run one metered turn. `turnKey` is the caller-supplied
  // idempotency key (required server-side); `priorRunId` sets the critique/adjust context.
  postDictum: (
    colloquiumId: string,
    body: { turnKey: string; message: string; priorRunId?: string; bursaToken?: string },
  ) => {
    const purse = getActivePurse();
    const headers = purse ? { 'content-type': 'application/json', 'x-bursa-token': purse } : authHeaders();
    return fetch(`/v1/colloquia/${encodeURIComponent(colloquiumId)}/dicta`, { method: 'POST', headers, body: JSON.stringify(body) })
      .then(j<{ dictum: Dictum; result: ConciergeResult; charged: string; idempotentReplay?: boolean }>);
  },
};

export default conciergeApi;
