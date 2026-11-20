import type { Collection } from './collections';
import type { Fragment, FragmentCategory } from './datasets';
import { j } from './core';
import { authHeaders, readHeaders } from './session';

// ── Muse sessions ──────────────────────────────────────────────────────────
// A session is a break-off of a dataset with its own fragments, its own floor and
// its own piece ledger; the mother dataset is never written to by it. These types
// mirror the surface's `MuseSessionView` (the Muse schemas in `apiContract.ts`) —
// `natum`/`mutatum` arrive as ISO strings on the wire, exactly as `Dataset`'s do.
//
// `floor` is an ENTRY ARRAY, not an object keyed by fragment: a fragment's identity
// is `category:text`, which is free text and is not usable as a field name. A
// fragment is likewise named by `{category, text}` in every request BODY rather than
// in a path segment, for the same reason.
export type MuseReaction = 'up' | 'down' | 'note';
/** One fragment's state on the session floor. `enabled: false` is out of the draw, not gone. */
export interface MuseFloorEntry { key: string; enabled: boolean; weight: number }
/** One recorded piece and the lineage that produced it. */
export interface MusePiece {
  runId: string;
  rollIndex: number;
  fragments: Fragment[];
  reaction?: MuseReaction;
  saved: boolean;
  dismissed: boolean;
}
/** One model on the session's stored stack. An absent `weight` is the model's own default. */
export interface MuseNozzleEntry {
  intellaId: string;
  nomen: string;
  trigger: string;
  weight?: number;
}
/**
 * What the session fires its draw THROUGH — the flow, the run shape, the model stack and
 * the standing affix. Mirrors `src/crystal/muse/session.ts#MuseSetup`.
 *
 * THERE IS NO ACKNOWLEDGEMENT FIELD AND THERE IS NO VIEW STATE, on purpose. An
 * infinite-mode acknowledgement is consent for one sitting, so it is never sent and never
 * restored; which controls were folded is this screen's business and not the server's.
 */
export interface MuseSetup {
  modusId?: string;
  mode?: 'batched' | 'infinite';
  cap?: number;
  nozzle?: MuseNozzleEntry[];
  prefix?: string;
  suffix?: string;
}
/**
 * One roll the user kept — the prompt as it stood, and its paid/free verdict.
 *
 * Two fields and no more. The verdict is stored because it cannot be recomputed later:
 * whether a prompt fires as a paid run depends on what it drew and what it was rolled
 * against, and both of those move while the kept roll stays as it was.
 */
export interface MuseKeptRoll { prompt: string; paid: boolean }
export interface MuseSessionView {
  id: string;
  owner: string;
  motherDatasetId: string;
  /** The session's own dataset, where its saved pieces land. Absent until the first save. */
  sessionDatasetId?: string;
  fragments: Fragment[];
  floor: MuseFloorEntry[];
  pieces: MusePiece[];
  /** What the session fires its draw through. Absent until a setup is committed. */
  setup?: MuseSetup;
  /** The rolls kept in this session, oldest first. Always sent — none kept is an empty list. */
  keptRolls: MuseKeptRoll[];
  natum: string;
  mutatum: string;
}
/** A fragment as a request body names it: by its identity, never by position. */
export interface MuseFragmentIdentity { category: FragmentCategory; text: string }
/**
 * What a steer PROPOSES — and only proposes. Mirrors `src/crystal/muse/steer.ts#SteerProposal`
 * the same way the shapes above mirror the session schemas.
 *
 * Nothing in it has been applied. `eliminations` name fragments the floor holds and the
 * instruction would take out of the draw; `additions` are fragments that are not on the
 * floor and would join it; `dropped` is how many of the model's proposed changes did not
 * survive server-side validation, reported rather than swallowed so a shorter list is not
 * mistaken for the whole answer. The proposal is not stored anywhere — it lives for as
 * long as the sheet rendering it is open.
 */
export interface MuseSteerProposal {
  eliminations: MuseFragmentIdentity[];
  additions: Fragment[];
  dropped: number;
}
/** What is recorded at fire time. A reaction is attached afterwards — see `updateMusePiece`. */
export interface MusePieceRecord {
  runId: string;
  rollIndex: number;
  fragments: MuseFragmentIdentity[];
}

const museApi = {
  // ── Muse sessions ────────────────────────────────────────────────────────
  // The session is the only place a Muse floor or piece ledger is written. Every
  // mutator returns the WHOLE updated session, so a caller re-renders from the
  // response rather than patching a local copy — there is one mutation path and one
  // source of truth for what the floor says.
  //
  // Ownership is scoped server-side from the resolved caller: a session belonging to
  // someone else answers exactly as an id that never existed does. No scoping check
  // belongs on this side of the wire.
  //
  // A fragment is named by `{category, text}` in the BODY of the floor calls. Its
  // identity is `category:text`, which is free text and is unsafe as a path segment.
  listMuseSessions: (datasetId: string) =>
    fetch(`/v1/data/muse/sessions?datasetId=${encodeURIComponent(datasetId)}`, { headers: readHeaders() })
      .then(j<{ sessions: MuseSessionView[] }>),
  spawnMuseSession: (datasetId: string) =>
    fetch('/v1/data/muse/sessions', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ datasetId }) })
      .then(j<{ session: MuseSessionView }>),
  getMuseSession: (id: string) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}`, { headers: readHeaders() })
      .then(j<{ session: MuseSessionView }>),
  setMuseFragmentEnabled: (id: string, fragment: MuseFragmentIdentity, enabled: boolean) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/floor/enabled`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ ...fragment, enabled }),
    }).then(j<{ session: MuseSessionView }>),
  setMuseFragmentWeight: (id: string, fragment: MuseFragmentIdentity, weight: number) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/floor/weight`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ ...fragment, weight }),
    }).then(j<{ session: MuseSessionView }>),
  // The un-metered way to widen a floor: the fragment the user wrote, put on the floor
  // in the draw at even odds. One call, carrying the fragment's identity and nothing
  // else — no flow, no model, no quote — and a fragment the floor already holds comes
  // back as the session unchanged rather than as a duplicate.
  addMuseFragment: (id: string, fragment: MuseFragmentIdentity) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/floor/fragments`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(fragment),
    }).then(j<{ session: MuseSessionView }>),
  // PATCH …/setup — what the session fires its draw THROUGH: the flow, the run shape,
  // the model stack and the standing affix. It goes to the server rather than to this
  // browser for the same reason the floor does — a session is resumable from anywhere,
  // and a setup held in one browser would disagree with it. Sent on COMMIT, never on a
  // keystroke. The setup is replaced wholesale. NOTHING IS SPENT: no run, no quote.
  // The infinite-mode acknowledgement is not part of a setup and is not sent here.
  setMuseSetup: (id: string, setup: MuseSetup) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/setup`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify(setup),
    }).then(j<{ session: MuseSessionView }>),
  // POST …/steer — a short instruction against the session's floor in, a PROPOSAL out.
  // NOTHING IS APPLIED by this call: the response is what the consent sheet is rendered
  // from, every pill in it is vetoable, and the floor moves only through the two floor
  // calls above, made when the user confirms. The floor is resolved server-side from the
  // session the caller owns — it is not a parameter — so the body carries the instruction
  // and nothing else. METERED: one model call, priced by `quote` above before it is sent.
  steerMuseSession: (id: string, instruction: string) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/steer`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify({ instruction }),
    }).then(j<{ proposal: MuseSteerProposal }>),
  // POST …/kept — the keep gesture. Rolling is free and a roll in progress is this
  // screen's own, so the report and its edits stay here; keeping is the explicit act and
  // goes to the server, which is why a kept roll is still there after a navigation. The
  // whole updated session comes back and the panel re-renders from it, like every other
  // session write. APPEND-ONLY: keeping the same prompt twice keeps it twice, and there
  // is no call here that removes one. NOTHING IS SPENT — the prompt is kept, not fired.
  keepMuseRoll: (id: string, roll: MuseKeptRoll) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/kept`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(roll),
    }).then(j<{ session: MuseSessionView }>),
  // Append-only, one entry per run: a piece is recorded once, at fire time, with the
  // lineage that produced it. A second record for the same run is rejected.
  recordMusePiece: (id: string, piece: MusePieceRecord) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/pieces`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(piece),
    }).then(j<{ session: MuseSessionView }>),
  // A reaction and a dismissal are both given after the piece exists, so this is the
  // route that reaches a recorded piece. A field left out is left as it was.
  updateMusePiece: (id: string, runId: string, patch: { reaction?: MuseReaction; dismissed?: boolean }) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/pieces/${encodeURIComponent(runId)}`, {
      method: 'PATCH', headers: authHeaders(), body: JSON.stringify(patch),
    }).then(j<{ session: MuseSessionView }>),
  // Put a piece back into the set. The media joins the session's OWN dataset — created by
  // the first save, appended to by every save after it — carrying the piece's recorded
  // lineage as that item's fragments; the mother is never written. Nothing is spent and no
  // job runs: the piece was composed from fragments, so its lineage is already its tagging.
  // The body is empty — the run is named in the path and its media is resolved server-side.
  saveMusePiece: (id: string, runId: string) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/pieces/${encodeURIComponent(runId)}/save`, {
      method: 'POST', headers: authHeaders(),
    }).then(j<{ session: MuseSessionView }>),
  // POST …/promote — the session becomes a DRAFT collection: the floor still in the draw
  // becomes the trait grid, and the flow, the standing affix and the stacked trigger words
  // become the base prompt that grid expands. NOTHING IS SPENT — a draft is not dispatched,
  // and the supply and rules a session does not carry are set in the collection funnel this
  // returns into. The session is not written, so promoting does not end or alter the sitting.
  // The body carries at most a name: the grid, the flow and the funding identity are all
  // resolved server-side from the session and are never sent from here.
  promoteMuseSession: (id: string, nomen?: string) =>
    fetch(`/v1/data/muse/sessions/${encodeURIComponent(id)}/promote`, {
      method: 'POST', headers: authHeaders(), body: JSON.stringify(nomen ? { nomen } : {}),
    }).then(j<{ collection: Collection }>),
};

export default museApi;
