import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import {
  api,
  type Dataset as DatasetT,
  type FlowSummary,
  type Fragment,
  type FragmentCategory,
  type MuseReaction,
  type MuseSessionView,
  type MuseSteerProposal,
  type ModelCard,
} from '../lib/api';
import { useRunStream } from '../lib/runStream';
import { AddImages } from '../components/AddImages';
import {
  canFireDecompose,
  canOfferDecompose,
  decomposeCaptionsetId,
  launchCaptionJob,
  launchDecomposeJob,
} from '../lib/training';
import {
  admitPiece,
  announceTerminal,
  appendFailureNote,
  confirmOutcomeNote,
  dismissalOffer,
  droppedNote,
  appendMediaRequest,
  applyRunResult,
  buildGarden,
  captionCoverageLine,
  captionPassLabel,
  captionPassNote,
  canFireOne,
  categoryColor,
  dismissFromStream,
  flattenGarden,
  floorCounts,
  floorDisabledIndices,
  floorSheet,
  floorToggle,
  gardenCounts,
  ignitionBlockReason,
  ignitionRequest,
  instructionRemaining,
  isHold,
  latestSession,
  launchBlockReason,
  launchLabel,
  lineageOf,
  loraCatalog,
  loraCatalogReason,
  loraChoiceLine,
  loraWarmupNote,
  loraWeight,
  chooseLora,
  manualAddError,
  manualAddRequest,
  mergedExclusions,
  nextPieceDecision,
  pieceRecord,
  decomposeGateReason,
  poolDatasetFragments,
  promptWithTrigger,
  proposalPills,
  reactionOf,
  recordDismissal,
  recordFloorChange,
  recordedPiece,
  rehydrateStream,
  releasePending,
  replaceDataset,
  resumePhase,
  rollAt,
  rollCurated,
  savedOf,
  settlePieceResult,
  steerBlockReason,
  steerFloor,
  steerQuoteRequest,
  streamColumns,
  streamPiece,
  streamRunRequest,
  streamStatusLine,
  t2iFlows,
  terminalOf,
  weightWrites,
  writeLabel,
  writesForConfirm,
  EMPTY_STREAM,
  EXPANDED_GESTURES,
  MANUAL_CATEGORIES,
  MAX_FLOOR_FRAGMENTS,
  MAX_INSTRUCTION_CHARS,
  LORA_WEIGHT_MAX,
  LORA_WEIGHT_MIN,
  NO_DISMISSALS,
  TILE_GESTURES,
  type DismissalState,
  type FloorPill,
  type HoldState,
  type LoraChoice,
  type SheetPhase,
  type SteerPill,
  type RollReport,
  type RunResult,
  type StopCause,
  type StreamConfig,
  type StreamMode,
  type StreamPhase,
  type StreamPiece,
  type StreamQuote,
} from '../lib/muse';
import './muse.css';

// Muse (Muse P3, noema-229) — the dataset's garden: `/datasets/:id/muse`, one route over
// from `/datasets/:id/caption` and `/datasets/:id/derive` (App.tsx), following the shape
// `/collections/:id/garden` already established (TraitsGarden.tsx) — a reviewer should
// recognize this screen from that one.
//
// Unlike Dataset.tsx's per-item chip garden (noema-221), this pools EVERY media item's
// fragments into one dataset-wide garden (rth ruling 2026-08-18: one dataset, not a pool
// of several) and adds the thing Dataset.tsx does not: rolling. A roll composes N woven
// prompts via the free template (`rollReport` -> `lib/muse.ts#rollCurated`) — no request,
// no spend, no LLM call. Each roll shows its free/paid verdict (`RolledPrompt.paid`, from
// the cheap conflict detector in `muse/weaver.ts`) as a badge only; the paid smoother is
// never called here — that is a later item's rail (noema-228).
//
// Curation (check/uncheck a chip) and kept rolls are local UI state only.
//
// Ignition (Muse P4, noema-230) is the one thing on this screen that spends: a mined
// prompt can be fired at a t2i flow. The rules — which flows are offered, whether a
// flow can run on a prompt alone, what the request carries, and when the fire button
// arms — all live in `lib/muse.ts` and are gated there; this screen renders them.
// Two properties worth reading for: the cost is quoted and shown BEFORE any run is
// created, and a mined fragment's own trigger word is never lifted into `pinnedModels` —
// it rides the prompt text and `src/crystal/loraResolver.ts` resolves it server-side,
// exactly as it does for `Card.tsx` and every other run in the product. A model the user
// picks on the nozzle control below is the one thing this screen does pin, and it pins
// what they chose and nothing they did not.
//
// The nozzle (noema-246) is the model control, on its own beside the flow. A LoRA is
// chosen from the catalog scoped to the flow's base-model family, and every stream piece
// fired under it carries both halves: the trigger word in the prompt and the weights in
// `pinnedModels`. Changing it HOLDS the stream (S6) — a floor change never does, because
// pieces drawn mid-edit are still pieces the user asked for, while pieces fired mid-model-
// change come out of the old nozzle at full price. A hold is not a stop: the loop parks
// with its count, its cap and its run mode intact and resumes on commit.
//
// The stream (noema-238) is where a fired piece lands. Ignition used to end at a run id
// and a link, so seeing what Muse made meant leaving Muse; the pieces now come home to a
// tile grid on this screen — two columns on a phone, widening with the viewport, each
// tile tap-to-expand. Every rule the grid follows is a pure function in `lib/muse.ts`
// (`admitPiece`, `applyRunResult`, `streamColumns`, `lineageOf`) and is gated in
// `tests/unit/web/muse.test.ts`; this screen renders them. A piece watches its own run
// over the shared SSE hook (`lib/runStream.ts`), the same subscription `Run.tsx` and
// `Card.tsx` use, so there is one result path in the app rather than a second one here.
//
// The session (noema-241) is what the gestures write to. The screen resumes into the
// caller's most recent session off this dataset and spawns one only when there is none,
// so the floor is the same floor after a reload — it lives on the server, not here. Two
// things follow from that and are worth reading for:
//
//   The floor is never held locally. Every mutator returns the whole updated session and
//   the screen re-renders from that response, so what is on screen is what is stored.
//
//   A heart writes twice: the reaction lands on the piece, and one weight write lands on
//   the floor per fragment of that piece's RECORDED lineage (the session's own record —
//   `weightWrites` in `lib/muse.ts` — not the stream tile's client-side copy). 😂 records
//   a note and moves no weight (S4/V9); ✕ is recorded and writes nothing to the floor,
//   and proposes nothing (S12).
//
// The pull-up floor sheet (V1) is the full-fidelity view of that floor: every fragment,
// grouped by category, live/total per category, and a DARKENED pill for every fragment a
// steer turned off — visible and tappable back to live, never removed (S8).
//
// Save-back (noema-245) is the ↓ on the expanded rail, and it is what closes the loop: a
// kept piece goes back into the set, so the moodboard improves as it is used. One call does
// it, and the reason it can is that a generated piece does not need decomposing: it was
// composed FROM fragments, so the lineage the ledger already holds is its
// tagging and the save is a set insertion. Nothing is spent and no job runs. The media lands
// in the SESSION's own dataset (created by the first save, appended to after that); the
// mother is the starter and is never written (S7, S13). And a save reweights the floor
// without widening it — a piece carries no phrase the floor did not already have.
//
// The stream's front door (noema-244) is what everything above hangs from, and it is
// the surface this screen leads with: configure a run, press launch once, and pieces
// keep arriving until the stream is stopped. Three properties are worth reading for,
// because each one is a ruling rather than a preference:
//
//   THE LOOP IS IN THE BROWSER. No stream id, no server-side state, no new route — a
//   `POST /v1/runs` per piece, requested only when the previous piece settles. So a
//   closed tab ends the stream, and there is no state in which an unattended page keeps
//   spending. The cost of that choice is shown rather than hidden: a page that goes
//   away comes back STOPPED, and the readout says the page lost the stream instead of
//   rendering a dead stream as a live one. Resuming is pressing launch again.
//
//   THE PRICE IS ON THE LAUNCH CONTROL. One quote at configuration time, carried by the
//   button and by the state readout, instead of a quote-then-fire pair per piece. The
//   spend is seen once and earlier, not less: the figure is an estimate and is labelled
//   `~`, and every fire still goes through the server, which prices and charges.
//
//   THE BALANCE IS THE CEILING. Infinite mode has no count. `nextPieceDecision` in
//   `lib/muse.ts` compares a freshly-read balance against the quoted per-piece figure
//   before each fire, and the loop asks it what to do next; the loop decides nothing on
//   its own. It is re-read every piece, because a stale balance is a stream that keeps
//   firing into a refusal.
//
// The discrete roll cards survive behind a closed disclosure below the stream, as the
// manual path: roll N prompts, edit one, fire that one down the same route.
//
// The manual add (noema-242) is the sheet's other half: pick a category, write a fragment,
// and it lands on the floor in the draw. Everything else on this screen REWEIGHTS the
// floor — a piece is composed from fragments already on it — so short of decomposing more
// source images this is the only thing that WIDENS a narrow one, and it is free: one call
// carrying a category and a text, no flow, no model, no quote. The LLM-assisted add is a
// separate, metered surface. The rules the form follows (`manualAddError`,
// `manualAddRequest`) are pure functions in `lib/muse.ts` and are gated there.

// Adding images to the moodboard (noema-260) is V7's other exit, beside the manual add:
// the floor is widened by widening the SET. It is the only gesture on this screen that
// reaches the dataset rather than the session, and it is three steps rather than one —
// the upload joins the set and is free, a caption pass has to read the set, and a
// decompose is what turns those captions into fragments. The screen says all three
// before either metered one is pressed.
//
// Two rules it enforces, both pure and both gated in `lib/muse.ts`: a partial upload
// still appends what landed and names what did not, and a decompose is REFUSED while
// the chosen caption pass does not cover every image — a decompose over a partial pass
// mines the older images only, spends doing it, and comes back green.
//
// The append is `POST /v1/data/datasets/:id/media`, which is append-only by design:
// nothing here removes or reorders media, at this layer or any other.

/** One error, as short prose. */
function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function Muse() {
  const { id } = useParams();
  const [datasets, setDatasets] = useState<DatasetT[] | null>(null);

  useEffect(() => {
    let live = true;
    api.listDatasetsFull()
      .then(({ datasets: ds }) => { if (live) setDatasets(ds); })
      .catch(() => { if (live) setDatasets([]); });
    return () => { live = false; };
  }, []);

  const d = (datasets ?? []).find((x) => x.id === id);

  // Which flattened-garden indices are unchecked. Local curation state only — see the file
  // header note; nothing here is persisted or fed to a decompose call.
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const toggle = (i: number) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const [count, setCount] = useState(5);
  const [report, setReport] = useState<RollReport | null>(null);
  // Edited prompt text, keyed by roll index within the current report.
  const [edits, setEdits] = useState<Record<number, string>>({});
  // Kept rolls: the roll's prompt text (possibly edited) plus its free/paid verdict.
  const [kept, setKept] = useState<Array<{ prompt: string; paid: boolean }>>([]);

  // ── Ignition ──────────────────────────────────────────────────────────────
  // The workflow catalog, narrowed to t2i. `effect` (i2i) needs an input image and
  // `enhance` takes no text, so neither can be driven by a mined prompt alone.
  const [flows, setFlows] = useState<FlowSummary[] | null>(null);
  const [modusId, setModusId] = useState<string | null>(null);
  // Read once per SELECTION (not per render): a flow needing more than a prompt is
  // refused here rather than at the server's expense.
  const [blockReason, setBlockReason] = useState<string | null>(null);
  const [flowLoading, setFlowLoading] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const [fired, setFired] = useState<Record<number, { error?: string }>>({});

  // ── The stream's front door (noema-244) ───────────────────────────────────
  // Configuration, one launch control, one loop. Nothing here decides anything: the
  // refusal is `launchBlockReason` and the loop's every judgement is
  // `nextPieceDecision`, both pure and both in `lib/muse.ts`.
  const [config, setConfig] = useState<StreamConfig>({ mode: 'batched', cap: 12, acknowledged: false });
  const [quote, setQuote] = useState<StreamQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [phase, setPhase] = useState<StreamPhase>('idle');
  const [stopCause, setStopCause] = useState<StopCause | null>(null);
  const [firedCount, setFiredCount] = useState(0);
  const [streamError, setStreamError] = useState<string | null>(null);

  // ── The nozzle: the LoRA control and the hold it costs (noema-246, S5/S6) ──
  // A control of its own, beside the flow and off the steer keyboard: the floor is
  // fuel, this is the nozzle. Everything it decides — which models may be offered,
  // what a choice does to the next piece, what a hold is — is a pure function in
  // `lib/muse.ts`; this screen holds the state and renders them.
  const [familia, setFamilia] = useState<string | null>(null);
  const [ownModels, setOwnModels] = useState<ModelCard[]>([]);
  const [publicModels, setPublicModels] = useState<ModelCard[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [lora, setLora] = useState<LoraChoice | null>(null);
  const [loraOpen, setLoraOpen] = useState(false);
  // The choice UNDER REVIEW. Nothing reaches the stream until it is committed, which is
  // what the hold is holding for: a half-made choice must not ride the next piece.
  const [draft, setDraft] = useState<LoraChoice | null>(null);
  const [weightText, setWeightText] = useState('');
  const [hold, setHoldState] = useState<HoldState | null>(null);
  const [warmup, setWarmup] = useState<LoraChoice | null>(null);
  // The manual path (D3): the roll cards, closed by default. The stream is the front door.
  const [manualOpen, setManualOpen] = useState(false);

  // ── The stream (noema-238) ────────────────────────────────────────────────
  // Fired pieces, newest first, plus the ones held back while the grid is frozen.
  const [stream, setStream] = useState(EMPTY_STREAM);
  const [expanded, setExpanded] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(streamColumns(0));
  // The freeze test, read at fire time rather than at render time: a piece may arrive
  // from a run that finished while the user was scrolled deep into the grid.
  const frozenRef = useRef(false);
  const [frozen, setFrozen] = useState(false);

  // Frozen = the head of the grid has scrolled off the top of the viewport, i.e. the
  // user is looking at older tiles. Inserting at the top then would move the tile under
  // their thumb, and every tile gesture here is a steer (V8b).
  useLayoutEffect(() => {
    const read = () => {
      const el = gridRef.current;
      if (el) setColumns(streamColumns(el.clientWidth));
      const away = !!el && el.getBoundingClientRect().top < 0;
      frozenRef.current = away;
      setFrozen(away);
    };
    read();
    window.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
  }, [stream.pieces.length]);

  // A piece's run reaching terminal is also what releases the stream loop: the next
  // piece is requested on SETTLEMENT, never on a timer, so the loop parks on a promise
  // that this resolves. One waiter per run, removed as it is resolved. The result is
  // folded into the piece before the loop is released — `settlePieceResult` owns that
  // ordering, and it is gated in tests/unit/web/muse.test.ts.
  const settlers = useRef(new Map<string, (r: RunResult) => void>());
  const onPieceResult = useCallback((runId: string, result: RunResult) => {
    const waiting = settlers.current.get(runId);
    if (waiting) settlers.current.delete(runId);
    settlePieceResult(
      runId,
      result,
      (id, r) => setStream((s) => applyRunResult(s, id, r)),
      waiting,
    );
  }, []);

  // ── The session (noema-241) ───────────────────────────────────────────────
  // Resume, don't respawn: the app route carries no session segment and the dataset
  // holds no session pointer, so the screen looks its sessions up by dataset and takes
  // the most recent. A session is spawned only when the lookup comes back empty —
  // spawning on every mount would leave the floor behind on every reload.
  const [session, setSession] = useState<MuseSessionView | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [floorOpen, setFloorOpen] = useState(false);
  const [floorBusy, setFloorBusy] = useState<string | null>(null);
  const [reacting, setReacting] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  // ── The steer keyboard and the consent sheet (noema-261) ──────────────────
  // The instruction, its price, the proposal it came back with, and the vetoes on that
  // proposal. THE PROPOSAL IS NOT PERSISTED — it lives for the length of the sheet, by
  // ruling: it is a reading of a floor at a moment, and the floor is the durable object.
  const [steerText, setSteerText] = useState('');
  const [steerQuote, setSteerQuote] = useState<string | null>(null);
  const [steerQuoteError, setSteerQuoteError] = useState<string | null>(null);
  const [steering, setSteering] = useState(false);
  const [steerError, setSteerError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<
    { proposal: MuseSteerProposal; vetoed: Set<string>; phase: SheetPhase; outcome: string | null } | null
  >(null);
  const [applying, setApplying] = useState(false);
  // Dismissals since the floor last moved (S12). The offer is derived from this and from
  // nothing else, and every floor write below resets it.
  const [dismissals, setDismissals] = useState<DismissalState>(NO_DISMISSALS);
  const steerInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!id) return;
    let live = true;
    setSessionError(null);
    api.listMuseSessions(id)
      .then(({ sessions }) => latestSession(sessions) ?? api.spawnMuseSession(id).then((r) => r.session))
      .then((s) => { if (live) setSession(s); })
      .catch((e) => { if (live) setSessionError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [id]);

  // A reaction is two records: the reaction on the piece, and — for a steer, never for a
  // note — one weight write per fragment of the piece's recorded lineage. The floor
  // writes are read off the session the PATCH returned, so each one steps from the weight
  // the floor actually holds.
  async function react(runId: string, reaction: MuseReaction) {
    if (!session || reacting) return;
    setReacting(runId);
    try {
      let next = (await api.updateMusePiece(session.id, runId, { reaction })).session;
      const writes = weightWrites(next, runId, reaction);
      for (const write of writes) {
        next = (await api.setMuseFragmentWeight(session.id, write.fragment, write.weight)).session;
      }
      setSession(next);
      // A weight write is a floor change, so the dismissal count starts again (S12). 😂
      // produces no writes and is not one — it is recorded and steers nothing.
      if (writes.length > 0) setDismissals(recordFloorChange);
    } catch (e) {
      setSessionError(`that reaction didn't land: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReacting(null);
    }
  }

  // ✕ — declutter. Recorded on the piece, off the scroll, and nothing on the floor moves.
  async function dismiss(runId: string) {
    if (!session) return;
    setExpanded((cur) => (cur === runId ? null : cur));
    setStream((s) => dismissFromStream(s, runId));
    // Counted, and counted is all: ✕ moves no floor by itself. Three in a row with no
    // floor change between them earn an OFFER to steer — never a steer.
    setDismissals(recordDismissal);
    try {
      setSession((await api.updateMusePiece(session.id, runId, { dismissed: true })).session);
    } catch (e) {
      setSessionError(`that dismissal wasn't recorded: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ↓ save — the piece goes back into the set. One call: the server puts the piece's media
  // into the session's own dataset with its recorded lineage attached as that item's
  // fragments, and flags the ledger entry. NOTHING IS SPENT and no job runs — the piece was
  // composed from fragments, so its lineage is already its tagging (S11) and a
  // save is a set insertion rather than a decompose. The floor is REWEIGHTED by working with
  // the session, never widened by a save: no fragment is added here.
  async function save(runId: string) {
    if (!session || saving) return;
    setSaving(runId);
    try {
      setSession((await api.saveMusePiece(session.id, runId)).session);
    } catch (e) {
      setSessionError(`that piece didn't go back into the set: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(null);
    }
  }

  // A dark pill is tappable back to live, and it is the same call in both directions (S8).
  async function toggleFloorPill(pill: FloorPill) {
    if (!session || floorBusy) return;
    const { fragment, enabled } = floorToggle(pill);
    setFloorBusy(`${pill.category}:${pill.text}`);
    try {
      setSession((await api.setMuseFragmentEnabled(session.id, fragment, enabled)).session);
      setDismissals(recordFloorChange);
    } catch (e) {
      setSessionError(`that fragment didn't move: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setFloorBusy(null);
    }
  }

  // Manual add — the free widening. One call, and the sheet re-renders from the session
  // it returns like every other floor write. Returns whether the fragment landed, so the
  // form knows whether to clear itself.
  const [adding, setAdding] = useState(false);
  async function addToFloor(category: FragmentCategory, text: string): Promise<boolean> {
    if (!session || adding) return false;
    setAdding(true);
    try {
      setSession((await api.addMuseFragment(session.id, manualAddRequest(category, text))).session);
      setDismissals(recordFloorChange);
      return true;
    } catch (e) {
      setSessionError(`that fragment didn't land: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setAdding(false);
    }
  }

  // ── The steer (noema-261) ─────────────────────────────────────────────────
  // What one steer will read: the fragments in the draw, mirroring what the route
  // resolves server-side. It is what the price is quoted against and what the per-steer
  // floor cap is judged against, so it is derived from the session rather than from this
  // screen's own curation.
  const steerIds = useMemo(() => steerFloor(session), [session]);
  const steerBlock = steerBlockReason({ view: session, instruction: steerText, inFlight: steering });
  const offer = dismissalOffer(dismissals);

  // THE PRICE IS SHOWN BEFORE THE SEND, ONCE — the pattern the launch control already
  // uses. The reservation is a base plus a per-floor-fragment term and does not read the
  // instruction's content, so this re-quotes when the FLOOR SIZE changes and never on a
  // keystroke. It is an estimate and is rendered with `~`: the server prices and charges
  // the run when it settles.
  useEffect(() => {
    if (steerIds.length === 0 || steerIds.length > MAX_FLOOR_FRAGMENTS) { setSteerQuote(null); return; }
    let live = true;
    setSteerQuoteError(null);
    api.quote(steerQuoteRequest('', steerIds))
      .then((r) => { if (live) setSteerQuote(r.impetus); })
      .catch((e) => {
        if (!live) return;
        setSteerQuote(null);
        setSteerQuoteError(`couldn't price a steer: ${errText(e)}`);
      });
    return () => { live = false; };
    // The instruction does not enter the price; the floor size does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [steerIds.length]);

  // Send the instruction. ONE metered call, and it applies nothing: what comes back is a
  // proposal, and the sheet it opens is where it is ruled on. THE STREAM IS NOT PAUSED —
  // pieces already in flight are paid for, the loop re-reads the floor before every draw,
  // and the confirm is the cut line.
  async function doSteer() {
    if (!session || steerBlock) return;
    setSteering(true);
    setSteerError(null);
    try {
      const { proposal } = await api.steerMuseSession(session.id, steerText.trim());
      setSheet({ proposal, vetoed: new Set(), phase: 'reviewing', outcome: null });
    } catch (e) {
      setSteerError(`that steer didn't run: ${errText(e)}`);
    } finally {
      setSteering(false);
    }
  }

  /** Tap a pill to veto it, tap it again to put it back. A veto is recorded against the
   *  fragment's identity, which is what `writesForConfirm` filters on. */
  function toggleVeto(key: string) {
    setSheet((cur) => {
      if (!cur || cur.phase === 'confirmed') return cur;
      const vetoed = new Set(cur.vetoed);
      if (vetoed.has(key)) vetoed.delete(key); else vetoed.add(key);
      return { ...cur, vetoed };
    });
  }

  // Confirm — the cut line, and the only place a steer reaches the floor. The writes are
  // decided by `writesForConfirm` and applied SEQUENTIALLY, each stepping from the session
  // the previous call returned, exactly as the reaction writes do. A call that fails does
  // not take the rest with it: what landed stays landed and the sheet names what did not.
  async function confirmSheet() {
    if (!session || !sheet || applying) return;
    const writes = writesForConfirm(sheet.proposal, sheet.vetoed, 'confirmed');
    if (writes.length === 0) { setSheet(null); return; }
    setApplying(true);
    let next = session;
    let landed = 0;
    const failed: string[] = [];
    for (const write of writes) {
      try {
        next = write.kind === 'disable'
          ? (await api.setMuseFragmentEnabled(next.id, write.fragment, false)).session
          : (await api.addMuseFragment(next.id, write.fragment)).session;
        landed += 1;
      } catch (e) {
        failed.push(`${writeLabel(write)} (${errText(e)})`);
      }
    }
    setSession(next);
    // A confirmed sheet is a floor change like any other, so the dismissal count that may
    // have prompted it starts again from zero.
    if (landed > 0) setDismissals(recordFloorChange);
    setSheet((cur) => (cur ? { ...cur, phase: 'confirmed', outcome: confirmOutcomeNote(landed, failed) } : cur));
    setApplying(false);
    if (failed.length === 0) setSteerText('');
  }

  const expandedPiece = expanded
    ? stream.pieces.find((p) => p.runId === expanded) ?? stream.pending.find((p) => p.runId === expanded) ?? null
    : null;

  // ── Decompose ─────────────────────────────────────────────────────────────
  // The rung between a caption job and this screen: it reads one captionset and writes the
  // fragments this garden is built from. Offered from the empty state because that is where
  // a user who has just captioned arrives. Which captionset runs, whether the action can be
  // offered at all, and when the button is armed are all decided in `lib/training.ts`.
  const [decomposeSet, setDecomposeSet] = useState<string | null>(null);
  const [trigger, setTrigger] = useState('');
  const [decomposing, setDecomposing] = useState(false);
  const [decomposeMsg, setDecomposeMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // ── Add images (noema-260) ────────────────────────────────────────────────
  // The panel's own disclosure state lives here rather than in the panel, because the
  // empty-floor row's offer is what opens it and that row sits in the launcher above.
  const [addOpen, setAddOpen] = useState(false);
  const [captioning, setCaptioning] = useState(false);
  const [captionMsg, setCaptionMsg] = useState<{ ok: boolean; text: string; runId?: string } | null>(null);

  useEffect(() => {
    let live = true;
    api.listFlows()
      .then(({ flows: fs }) => { if (live) setFlows(t2iFlows(fs ?? [])); })
      .catch(() => { if (live) setFlows([]); });
    return () => { live = false; };
  }, []);

  function selectFlow(next: string) {
    const id_ = next || null;
    setModusId(id_);
    setBlockReason(null);
    setQuote(null);
    setQuoteError(null);
    setFired({});
    // A LoRA is scoped to ONE base-model family, so a flow change drops the chosen one
    // rather than carrying it onto a base it cannot work on. The catalog is re-read from
    // the new flow's own `familia` below.
    setFamilia(null);
    setLora(null);
    setDraft(null);
    setWeightText('');
    setWarmup(null);
    if (!id_) return;
    setFlowLoading(true);
    api.getFlow(id_)
      .then((f) => { setBlockReason(ignitionBlockReason(f)); setFamilia(f.familia ?? null); })
      .catch((e) => setBlockReason(`could not read this workflow's inputs (${e instanceof Error ? e.message : String(e)})`))
      .finally(() => setFlowLoading(false));
  }

  // The prompt that fires is the prompt on screen — the edited text when there is one,
  // never the pre-edit roll, and never a fresh roll.
  const promptOf = (index: number, rolled: string) => edits[index] ?? rolled;

  // The manual path's single fire (D3): one card, one prompt, down the same route a
  // stream piece takes. Its price is the one on the launch control above — the flow's
  // reservation does not vary with the prompt, so there is nothing per-card to price.
  async function doFire(index: number, prompt: string, lineage: readonly Fragment[]) {
    if (!modusId) return;
    if (!canFireOne(modusId, prompt, blockReason)) return;
    setBusy(index);
    try {
      const { run } = await api.createRun(ignitionRequest(modusId, prompt));
      // The piece lands in the stream on this screen. It carries the fragments it was
      // rolled from, because a later roll replaces the report it came out of and the
      // expanded view still has to name them.
      setStream((s) => admitPiece(s, streamPiece(run.id, prompt, lineage), frozenRef.current));
      setFired((prev) => ({ ...prev, [index]: {} }));
      // The piece is recorded NOW, with the lineage that produced it: the floor moves and
      // the fragment list is rebuilt, so it is not recoverable later. The ledger holds one
      // entry per run and a reaction is attached to that entry afterwards.
      if (session) {
        try {
          setSession((await api.recordMusePiece(session.id, pieceRecord(run.id, index, lineage))).session);
        } catch (e) {
          setSessionError(`this piece isn't in the session ledger, so it can't be reacted to: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      setFired((prev) => ({ ...prev, [index]: { error: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setBusy(null);
    }
  }

  // A decompose is synchronous and metered: the request stays open until the last caption is
  // written, and every caption is one chat call. So the button locks for the whole pass, the
  // state on screen says what is actually happening rather than spinning, and a failure keeps
  // its text. When it returns, the dataset is re-read so the garden fills without a refresh.
  async function doDecompose(dataset: DatasetT) {
    const captionsetId = decomposeCaptionsetId(dataset, decomposeSet);
    if (!canFireDecompose({ captionsetId, inFlight: decomposing })) return;
    setDecomposing(true);
    setDecomposeMsg(null);
    try {
      const run = await launchDecomposeJob({ datasetId: dataset.id, captionsetId: captionsetId!, trigger });
      if (run.status === 'failed') {
        setDecomposeMsg({ ok: false, text: `decompose failed: ${run.failure?.message ?? 'no reason reported'}` });
        return;
      }
      const { datasets: ds } = await api.listDatasetsFull();
      setDatasets(ds);
      setDecomposeMsg({ ok: true, text: 'decompose finished — the garden is built from it' });
    } catch (e) {
      setDecomposeMsg({ ok: false, text: `couldn't decompose: ${String((e as Error).message).slice(0, 160)}` });
    } finally {
      setDecomposing(false);
    }
  }

  // A caption pass is a normal metered run and it is ASYNCHRONOUS — it provisions a pod
  // and the captionset lands on the set when the pass finishes, so this returns at
  // dispatch rather than at completion. The screen says that instead of implying the
  // captions are already there, and offers the re-read that picks the new pass up.
  async function doCaption(dataset: DatasetT) {
    if (captioning) return;
    setCaptioning(true);
    setCaptionMsg(null);
    try {
      const run = await launchCaptionJob({ datasetId: dataset.id });
      setCaptionMsg({
        ok: true,
        runId: run.id,
        text: 'captioning started — it runs on a pod, and the new pass lands on this set when it finishes',
      });
    } catch (e) {
      setCaptionMsg({ ok: false, text: `couldn't start captioning: ${errText(e)}` });
    } finally {
      setCaptioning(false);
    }
  }

  // Re-read the set. The caption pass writes back out-of-band, so this is how its
  // captionset (and every pass' recomputed coverage) reaches the screen.
  async function refreshDatasets() {
    try {
      const { datasets: ds } = await api.listDatasetsFull();
      setDatasets(ds);
    } catch (e) {
      setCaptionMsg({ ok: false, text: `couldn't re-read the set: ${errText(e)}` });
    }
  }

  // The dataset-wide garden. Pools every media item's fragments (not one item's — that is
  // Dataset.tsx's job) and builds it in one pass. Recomputed only when the dataset's media
  // actually changes, not on every curation toggle.
  const build = useMemo(() => (d ? buildGarden(poolDatasetFragments(d.media)) : null), [d]);
  const counts = useMemo(() => (build ? gardenCounts(build.garden) : []), [build]);
  const flat = useMemo(() => (build ? flattenGarden(build.garden) : []), [build]);

  // What a roll may not draw: the chips unchecked on this screen, plus every fragment the
  // session floor has darkened. A darkened fragment is out of the draw, not gone (S8).
  const offTheFloor = useMemo(() => floorDisabledIndices(flat, session), [flat, session]);
  const outOfPlay = useMemo(() => mergedExclusions(excluded, offTheFloor), [excluded, offTheFloor]);

  function roll() {
    if (flat.length === 0) return;
    setReport(rollCurated(flat, outOfPlay, count));
    setEdits({});
    setFired({});
  }

  // How many fragments a launch actually has to draw from: the pooled garden minus this
  // screen's curation and minus everything the floor has turned off. The same number the
  // manual `Roll →` is armed on, so the stream refuses exactly where a roll would come
  // back empty.
  const liveFragments = flat.length - outOfPlay.size;

  // ── The stream loop ───────────────────────────────────────────────────────
  // Live reads for the loop. It runs across many awaits and must see the floor, the
  // session and the configuration as they are NOW, not as they were at launch: a
  // fragment turned off mid-stream is out of the draw for the very next piece, which is
  // the whole reason the floor is the steering wheel.
  const flatRef = useRef(flat);
  const outOfPlayRef = useRef(outOfPlay);
  const sessionRef = useRef(session);
  const modusRef = useRef(modusId);
  const configRef = useRef(config);
  const quoteRef = useRef(quote);
  useEffect(() => { flatRef.current = flat; }, [flat]);
  useEffect(() => { outOfPlayRef.current = outOfPlay; }, [outOfPlay]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { modusRef.current = modusId; }, [modusId]);
  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { quoteRef.current = quote; }, [quote]);

  // ── The hold (S6) ─────────────────────────────────────────────────────────
  // A HOLD IS NOT A STOP. The loop parks on `whenHoldClears()` and keeps everything it
  // is holding — the fired count, the cap, the run mode, the generation token — so a
  // commit returns it to `running` with no relaunch and no reset. A stop, by contrast,
  // leaves the loop for good and the only way back in is `launch()`.
  const holdRef = useRef<HoldState | null>(null);
  const holdWaiters = useRef<Array<() => void>>([]);
  const loraRef = useRef<LoraChoice | null>(lora);

  /** Wake the parked loop without deciding anything for it — it re-reads the hold and
   *  every other refusal itself, so a stop pressed during a hold is still a stop. */
  function wakeHold() {
    const waiting = holdWaiters.current;
    holdWaiters.current = [];
    for (const resume of waiting) resume();
  }

  function setHold(next: HoldState | null) {
    holdRef.current = next;
    setHoldState(next);
    // The readout moves the moment the control does, not when the loop next comes round:
    // the piece already in flight is paid for and is left to land, and S6 asks for the
    // hold to be visible while it does.
    if (runningRef.current) setPhase(next ? 'holding' : 'running');
    if (!next) wakeHold();
  }

  function whenHoldClears(): Promise<void> {
    return new Promise<void>((resume) => { holdWaiters.current.push(resume); });
  }

  // The committed nozzle reaches the loop here, and a commit that was waiting on the
  // weights is released once it has: the loop can only fire under a nozzle it can read.
  useEffect(() => {
    loraRef.current = lora;
    if (holdRef.current?.reason === 'loading') setHold(null);
    // `setHold` is a stable closure over refs; re-running this on every render would
    // release a hold the user has not committed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lora]);

  // The catalog, scoped to the flow's base-model family. Both lists are asked for
  // together: the caller's own imports and trained LoRAs sit beside the public ones.
  useEffect(() => {
    if (!familia) { setOwnModels([]); setPublicModels([]); setCatalogError(null); return; }
    let live = true;
    setCatalogLoading(true);
    setCatalogError(null);
    Promise.all([
      api.listMyModels().catch(() => ({ models: [] as ModelCard[] })),
      api.listModelsByBasis(familia),
    ])
      .then(([mine, shared]) => {
        if (!live) return;
        setOwnModels(mine.models ?? []);
        setPublicModels(shared.models ?? []);
      })
      .catch((e) => { if (live) setCatalogError(`couldn't read the model catalog: ${errText(e)}`); })
      .finally(() => { if (live) setCatalogLoading(false); });
    return () => { live = false; };
  }, [familia]);

  const loraOffer = useMemo(
    () => loraCatalog(ownModels, publicModels, familia),
    [ownModels, publicModels, familia],
  );
  const loraReason = loraCatalogReason(modusId, familia, loraOffer.length);

  /** Opening the control holds a running stream: pieces fired while a model is being
   *  chosen come out of the old nozzle at full price. */
  function openLora() {
    setDraft(lora);
    setWeightText(lora?.weight != null ? String(lora.weight) : '');
    setLoraOpen(true);
    setHold({ reason: 'picking' });
  }

  /** Cancel resumes on the OLD nozzle — the change is discarded, not half-applied. */
  function cancelLora() {
    setLoraOpen(false);
    setDraft(lora);
    setHold(null);
  }

  function commitLora() {
    const next: LoraChoice | null = draft
      ? { ...draft, weight: weightText.trim() === '' ? null : loraWeight(Number(weightText)) }
      : null;
    const changed = (next?.intellaId ?? null) !== (lora?.intellaId ?? null)
      || (next?.weight ?? null) !== (lora?.weight ?? null);
    setLoraOpen(false);
    setLora(next);
    setWarmup(changed ? next : warmup);
    // A committed change stays held until the new nozzle has reached the loop; the effect
    // above releases it. Committing nothing new releases straight away.
    if (changed && next) setHold({ reason: 'loading', trigger: next.trigger });
    else setHold(null);
  }

  const stopRef = useRef(false);
  const runningRef = useRef(false);
  // One token per launch. A loop parked on a settlement that never arrives — a closed
  // page, an unmount — must not wake up later and fire into a stream someone else
  // started, so every await is followed by a generation check.
  const generationRef = useRef(0);
  useEffect(() => () => { generationRef.current += 1; runningRef.current = false; }, []);

  // ── Coming back to a session (noema-263) ─────────────────────────────────
  // The stream is state this screen holds, so a mount starts it empty — but the session
  // resumed above carries every piece it fired, with the lineage that produced each one.
  // The tiles are rebuilt from that ledger here, so returning to a session shows what it
  // made instead of a fresh configuration.
  //
  // A REBUILD IS A READ: nothing below creates a run. Resuming is free and the user
  // presses launch. Once per session — the ledger changes on every reaction and every
  // save, and a rebuild on each one would put a dismissed tile back on the scroll.
  const rehydrated = useRef<string | null>(null);
  useEffect(() => {
    if (!session || runningRef.current) return;
    if (rehydrated.current === session.id) return;
    rehydrated.current = session.id;

    const rebuilt = rehydrateStream(session);
    if (rebuilt.pieces.length === 0) return;
    setStream(rebuilt);
    setPhase(resumePhase(rebuilt));

    let live = true;
    // A recorded piece stores no media URL, so each rebuilt tile resolves its image from
    // its own run, through the same terminal path a live piece takes. A run that has not
    // reached terminal is left as it is: the tile stays `running`, which is what mounts
    // the watcher that follows it the rest of the way.
    void Promise.all(rebuilt.pieces.map(async (p) => {
      const fetched = await api.getRun(p.runId).catch(() => null);
      if (!live || !fetched) return;
      const kind = terminalOf(fetched.run.status);
      if (!kind) return;
      await announceTerminal(kind, p.runId, async () => ({ run: fetched.run }), (patch) => {
        if (!live) return;
        setStream((s) => applyRunResult(s, p.runId, {
          terminal: patch.terminal,
          exitus: patch.exitus,
          error: patch.error,
        }));
      });
    }));
    return () => { live = false; };
    // Keyed by the session's IDENTITY, not by the session object: the ledger comes back
    // rewritten from every reaction, save and floor write, and re-running this on each of
    // those would cancel the run reads a rebuild still has in flight.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // The configuration-time quote (D2). One quote prices the run: a t2i reservation is
  // evaluated against the run's NUMERIC inputs, and Muse sends only a prompt, so the
  // figure is the same for every piece whatever it was rolled from. It is still an
  // estimate — the reservation is an upper bound the server settles against — so it is
  // rendered with a `~` everywhere and never becomes the charge.
  useEffect(() => {
    if (!modusId || blockReason) { setQuote(null); return; }
    let live = true;
    setQuoteError(null);
    api.quote(ignitionRequest(modusId, rollAt(flat, outOfPlay, 0).prompt))
      .then((r) => { if (live) setQuote({ modusId, impetus: r.impetus }); })
      .catch((e) => {
        if (!live) return;
        setQuote(null);
        setQuoteError(`couldn't price this workflow: ${errText(e)}`);
      });
    return () => { live = false; };
    // The prompt does not enter the price, so a re-roll must not re-quote; the flow does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modusId, blockReason]);

  const blockLaunch = launchBlockReason({
    config,
    modusId,
    flowBlockReason: blockReason,
    liveFragments,
    quote,
  });

  // D1's honest readout. The loop lives here and nowhere else, so a page that goes away
  // takes the stream with it. On a bfcache restore the page comes back with its state but
  // without its subscriptions, and it must say the stream ended rather than render as
  // though it were still riding.
  useEffect(() => {
    const lost = () => {
      if (!runningRef.current) return;
      generationRef.current += 1;
      runningRef.current = false;
      stopRef.current = true;
      setPhase('stopped');
      setStopCause('lost');
    };
    window.addEventListener('pagehide', lost);
    return () => window.removeEventListener('pagehide', lost);
  }, []);

  /** Park until this run reaches terminal. The next piece is requested on settlement —
   *  a loop that fired on a timer would spend at a rate nobody chose. */
  function settlementOf(runId: string): Promise<RunResult> {
    return new Promise<RunResult>((resolve) => { settlers.current.set(runId, resolve); });
  }

  function requestStop() {
    stopRef.current = true;
    if (runningRef.current) setPhase('stopping');
    // A stop pressed while the stream is holding must end it: the loop is parked, so it
    // is woken to re-decide, and `stopRequested` outranks the hold.
    wakeHold();
  }

  async function launch() {
    if (runningRef.current || blockLaunch) return;
    const gen = ++generationRef.current;
    runningRef.current = true;
    stopRef.current = false;
    setStopCause(null);
    setStreamError(null);
    setFiredCount(0);
    setPhase('running');

    let fired = 0;
    let consecutiveErrors = 0;
    let end: StopCause = 'user';

    try {
      for (;;) {
        // Re-read before EVERY piece. A balance read once at launch is not a ceiling.
        let balanceImpetus: string;
        try {
          balanceImpetus = (await api.meStatus()).balanceImpetus;
        } catch (e) {
          // A balance that cannot be read is not one we may spend against.
          setStreamError(`couldn't read your balance, so the stream stopped: ${errText(e)}`);
          end = 'funds';
          break;
        }
        if (generationRef.current !== gen) return;

        const cfg = configRef.current;
        const decision = nextPieceDecision({
          mode: cfg.mode,
          cap: cfg.cap,
          fired,
          // The loop parks on settlement, so nothing of ours is in flight at this point.
          inFlight: false,
          balanceImpetus,
          perPieceImpetus: quoteRef.current?.impetus ?? '0',
          stopRequested: stopRef.current,
          consecutiveErrors,
          hold: holdRef.current,
        });
        // THE HOLD PARKS THE LOOP; it never breaks it. Everything this iteration is
        // carrying — `fired`, `consecutiveErrors`, the generation token, the run mode —
        // is still here when the change is committed, which is what makes a resume a
        // resume rather than a relaunch.
        if (isHold(decision)) {
          setPhase('holding');
          await whenHoldClears();
          if (generationRef.current !== gen) return;
          if (!stopRef.current) setPhase('running');
          continue;
        }
        if (!decision.fire) { end = decision.stop ?? 'user'; break; }

        const modus = modusRef.current;
        if (!modus) { end = 'user'; break; }

        // A fresh draw at an advancing index: the sampler is deterministic by design, so
        // a fixed index would fire one prompt over and over. The floor is re-read here,
        // which is what lets a steer mid-stream reach the very next piece.
        const draw = rollAt(flatRef.current, outOfPlayRef.current, fired);

        // The nozzle is read at FIRE time, like the floor: a piece carries the model that
        // was committed when it was fired. Both halves ride together — the trigger word in
        // the prompt, and the weights in `pinnedModels` — because either alone is a
        // full-price no-op. The trigger enters the PROMPT only: it is not a fragment, it is
        // not on the floor, and it is not in the lineage recorded below.
        const nozzle = loraRef.current;
        const firePrompt = promptWithTrigger(draw.prompt, nozzle);

        let runId: string;
        try {
          const { run } = await api.createRun(streamRunRequest(modus, draw.prompt, nozzle));
          runId = run.id;
        } catch (e) {
          if (generationRef.current !== gen) return;
          consecutiveErrors += 1;
          setStreamError(`that piece didn't fire: ${errText(e)}`);
          continue;
        }
        if (generationRef.current !== gen) return;

        fired += 1;
        setFiredCount(fired);
        setStreamError(null);
        setStream((s) => admitPiece(s, streamPiece(runId, firePrompt, draw.fragments), frozenRef.current));

        // Recorded at FIRE time with the lineage that produced it: the floor moves and the
        // fragment list is rebuilt, so it is not recoverable later. One entry per run — a
        // piece is never re-recorded, and the ledger rejects a duplicate anyway.
        const open = sessionRef.current;
        if (open) {
          try {
            setSession((await api.recordMusePiece(open.id, pieceRecord(runId, draw.index, draw.fragments))).session);
          } catch (e) {
            setSessionError(`this piece isn't in the session ledger, so it can't be reacted to: ${errText(e)}`);
          }
          if (generationRef.current !== gen) return;
        }

        const result = await settlementOf(runId);
        if (generationRef.current !== gen) return;
        // A piece has come back under this nozzle, so the weights are on the pod: the
        // warm-up note has nothing left to explain.
        setWarmup(null);
        // A run that fails after dispatch counts the same as a fire that never landed:
        // either way the loop is repeating something that is not working.
        consecutiveErrors = result.terminal === 'failed' ? consecutiveErrors + 1 : 0;
      }
    } finally {
      if (generationRef.current === gen) {
        runningRef.current = false;
        setPhase('stopped');
        setStopCause(end);
      }
    }
  }

  // A stream that is holding is a stream that is LIVE: the flow, the run mode and the cap
  // are all locked exactly as they are while it rides, because the hold is a pause in the
  // firing and not a return to configuration.
  const streamLive = phase === 'running' || phase === 'stopping' || phase === 'holding';

  const crumb = (
    <span className="ph-crumb">
      <Link to="/datasets">datasets</Link> <span className="sep">/</span>{' '}
      <Link to={`/datasets/${id}`}>{d?.name ?? id}</Link> <span className="sep">/</span> <b>muse</b>
    </span>
  );

  if (datasets === null) {
    return <AppShell title="Muse"><div className="page"><div className="pw wide"><div className="sub mono">loading…</div></div></div></AppShell>;
  }
  if (!d) {
    return (
      <AppShell title="Muse">
        <div className="page"><div className="pw wide">
          <div className="sub mono">dataset not found. <Link to="/datasets">back to datasets</Link></div>
        </div></div>
      </AppShell>
    );
  }

  // ── What an appended image still needs (noema-260) ────────────────────────
  // The readout and the two metered steps, built once here so the same node can sit
  // under the add-images panel wherever that panel is rendered. Every figure on it is
  // derived from the dataset the server last returned — the count the user is shown
  // before spending is the count the pass will actually run over.
  const nextCaptionsetId = decomposeCaptionsetId(d, decomposeSet);
  const decomposeGate = decomposeGateReason(d, nextCaptionsetId);
  const afterAppend = (
    <div className="muse-add-next">
      <label className="cc-field"><span>Caption pass</span>
        <select className="cer-input" value={nextCaptionsetId ?? ''}
          disabled={d.captionsets.length === 0 || decomposing}
          onChange={(e) => setDecomposeSet(e.target.value)}>
          {d.captionsets.length === 0 && <option value="">no caption pass yet</option>}
          {d.captionsets.map((cs) => (
            <option key={cs.id} value={cs.id}>{cs.name} · {cs.coverage}</option>
          ))}
        </select>
      </label>

      <div className="muse-add-readout mono">{captionCoverageLine(d, nextCaptionsetId)}</div>

      <div className="muse-add-step">
        <button type="button" className="btn ghost sm" disabled={captioning} onClick={() => void doCaption(d)}>
          {captioning ? 'starting…' : captionPassLabel(d)}
        </button>
        <span className="gt-sub mono">{captionPassNote(d)}</span>
      </div>
      {captionMsg && (
        <div className="gt-sub mono">
          {captionMsg.text}
          {captionMsg.runId && <> · <Link to={`/run?id=${captionMsg.runId}`}>open run view →</Link></>}
          {captionMsg.ok && <> · <button type="button" className="linkish" onClick={() => void refreshDatasets()}>re-read the set</button></>}
        </div>
      )}

      <label className="cc-field"><span>Trigger word to strip (optional)</span>
        <input className="cer-input" value={trigger} disabled={decomposing}
          onChange={(e) => setTrigger(e.target.value)}
          placeholder="keeps fragments reusable" />
      </label>
      <div className="muse-add-step">
        <button type="button" className="btn accent sm"
          disabled={!canFireDecompose({ captionsetId: nextCaptionsetId, inFlight: decomposing }) || !!decomposeGate}
          onClick={() => void doDecompose(d)}>
          {decomposing ? 'Decomposing…' : 'Decompose this pass →'}
        </button>
        <span className="gt-sub mono">
          {decomposeGate
            ?? 'reads every caption in this pass and stores the fragments on the images they came from · one chat call per caption · billed like any other run'}
        </span>
      </div>
      {decomposeMsg && <div className="gt-sub mono">{decomposeMsg.text}</div>}
    </div>
  );

  // A dataset nobody has decomposed has no fragments. This is a first-class branch, not an
  // error — noema-221 already established that an absent `fragments` is valid and expected.
  if (build && build.kept === 0) {
    return (
      <AppShell title={crumb}>
        <div className="page"><div className="pw wide">
          <div className="empty">
            <div className="t">Nothing has been decomposed yet</div>
            {canOfferDecompose(d) ? (
              <>
                <div className="s">
                  Muse rolls prompts from decomposed captions. This dataset has captions — decompose a
                  captionset to grow the garden.
                </div>
                <div className="muse-decompose">
                  <label className="cc-field"><span>Captionset</span>
                    <select className="cer-input" value={decomposeCaptionsetId(d, decomposeSet) ?? ''}
                      disabled={decomposing}
                      onChange={(e) => setDecomposeSet(e.target.value)}>
                      {d.captionsets.map((cs) => (
                        <option key={cs.id} value={cs.id}>{cs.name} · {cs.coverage}</option>
                      ))}
                    </select>
                  </label>
                  <label className="cc-field"><span>Trigger word to strip (optional)</span>
                    <input className="cer-input" value={trigger} disabled={decomposing}
                      onChange={(e) => setTrigger(e.target.value)}
                      placeholder="keeps fragments reusable" />
                  </label>
                  <button className="btn accent"
                    disabled={!canFireDecompose({ captionsetId: decomposeCaptionsetId(d, decomposeSet), inFlight: decomposing }) || !!decomposeGate}
                    onClick={() => void doDecompose(d)}>
                    {decomposing ? 'Decomposing…' : 'Decompose these captions →'}
                  </button>
                </div>
                <div className="muse-decompose-note mono">
                  {decomposeGate ?? (decomposing
                    ? 'reading every caption in this set — one pass per caption, this stays open until the last one is written'
                    : 'reads every caption in this set and stores the fragments on the images they came from · billed like any other run')}
                </div>
                {decomposeMsg && <div className="muse-decompose-note mono">{decomposeMsg.text}</div>}
              </>
            ) : (
              <div className="s">
                Muse rolls prompts from decomposed captions — this dataset has none yet. Caption it, then
                decompose those captions to grow the garden.
              </div>
            )}
            {/* V7's other exit, offered from the coldest start there is: the set itself can
                be widened from here, not only the floor. */}
            <AddImages
              dataset={d}
              open={addOpen}
              onOpenChange={setAddOpen}
              onAppended={(updated) => setDatasets((ds) => replaceDataset(ds, updated))}
              next={null}
            />
            <Link className={canOfferDecompose(d) ? 'btn ghost' : 'btn accent'} to={`/datasets/${d.id}`}>← back to {d.name}</Link>
          </div>
        </div></div>
      </AppShell>
    );
  }

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="garden-head">
          <div><h1>{d.name} — muse</h1></div>
          <div className="garden-nudge">
            <span className="gn-count mono">{flat.length} fragments · {liveFragments} in play across {counts.filter((c) => c.count > 0).length} categories</span>
          </div>
        </div>

        {/* ── The launcher (V6) ───────────────────────────────────────────────
            Configuration, then one launch control that carries the price. The stop
            button sits beside it for the whole time a stream is riding, so it is
            reachable without scrolling however long the grid below has grown. */}
        <section className="muse-launcher">
          <div className="muse-launcher-row">
            <label className="cc-field"><span>Nozzle</span>
              <select className="cer-input" value={modusId ?? ''} disabled={streamLive}
                onChange={(e) => selectFlow(e.target.value)}>
                <option value="">choose a workflow…</option>
                {(flows ?? []).map((f) => (
                  <option key={f.id} value={f.id}>{f.nomen ?? f.id}{f.versio ? ` · ${f.versio}` : ''}</option>
                ))}
              </select>
            </label>

            <fieldset className="muse-mode" disabled={streamLive}>
              <legend className="gc-l">run</legend>
              <label className="muse-mode-opt">
                <input type="radio" name="muse-mode" checked={config.mode === 'batched'}
                  onChange={() => setConfig((c) => ({ ...c, mode: 'batched' as StreamMode }))} />
                batched
              </label>
              <input
                className="cer-input muse-cap" type="number" min={1} max={200}
                aria-label="how many pieces"
                disabled={config.mode !== 'batched'}
                value={config.cap}
                onChange={(e) => setConfig((c) => ({ ...c, cap: Math.max(1, Number(e.target.value) || 1) }))}
              />
              <label className="muse-mode-opt">
                <input type="radio" name="muse-mode" checked={config.mode === 'infinite'}
                  onChange={() => setConfig((c) => ({ ...c, mode: 'infinite' as StreamMode }))} />
                infinite
              </label>
            </fieldset>
          </div>

          {/* ── The nozzle (S5) ───────────────────────────────────────────────
              A control of its own, NOT a key on the steer keyboard and not a floor
              pill: the floor is fuel, this is what it is burned through. Changing it
              while a stream rides holds the stream (S6) — pieces fired mid-choice come
              out of the old nozzle at full price. */}
          <div className="muse-lora">
            <div className="muse-lora-row">
              <span className="gc-l">Model</span>
              <span className="muse-lora-current mono">{loraChoiceLine(lora)}</span>
              <button
                type="button"
                className="btn ghost sm"
                onClick={() => (loraOpen ? cancelLora() : openLora())}
              >
                {loraOpen ? 'cancel' : lora ? 'change model' : 'choose a model'}
              </button>
            </div>

            {loraOpen && (
              <div className="muse-lora-panel">
                {loraReason ? (
                  <div className="gt-sub mono">{loraReason}</div>
                ) : (
                  <ul className="muse-lora-list">
                    {loraOffer.map((card) => (
                      <li key={card.intellaId}>
                        <button
                          type="button"
                          className={`muse-lora-card${draft?.intellaId === card.intellaId ? ' on' : ''}`}
                          onClick={() => setDraft((d) => chooseLora(d, card))}
                        >
                          <span className="muse-lora-name">{card.nomen}</span>
                          {/* The trigger word is shown on every card and again on the
                              chosen one: it is the part a user has to see to trust that
                              the model is reaching the prompt at all. */}
                          <span className="muse-lora-trigger mono">trigger {card.trigger}</span>
                          {card.access === 'private' && <span className="muse-lora-own mono">yours</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {catalogLoading && <div className="gt-sub mono">reading the catalog…</div>}
                {catalogError && <div className="gt-sub mono">{catalogError}</div>}

                <label className="cc-field muse-lora-weight"><span>Weight</span>
                  <input
                    className="cer-input" type="number" inputMode="decimal"
                    min={LORA_WEIGHT_MIN} max={LORA_WEIGHT_MAX} step={0.05}
                    placeholder="its own default"
                    disabled={!draft}
                    value={weightText}
                    onChange={(e) => setWeightText(e.target.value)}
                  />
                </label>

                <div className="gt-sub mono">
                  One model at a time — choosing another replaces it. How many a run can stack has not been
                  measured, so nothing here stacks them.
                </div>

                <div className="muse-lora-actions">
                  <button type="button" className="btn accent sm" onClick={commitLora}>
                    {draft ? `use ${draft.nomen}` : 'fire without a model'}
                  </button>
                  <button type="button" className="btn ghost sm" onClick={cancelLora}>cancel</button>
                </div>

                {streamLive && (
                  <div className="gt-sub mono">
                    the stream is holding while you choose — it resumes where it is, with the same count and
                    the same cap.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* The warning is a GATE, not a caption (V5). An infinite stream carries no
              count, so the balance is the only thing that ends it on its own; the
              acknowledgement is what stands in for the count that is not there. */}
          {config.mode === 'infinite' && (
            <label className="muse-ack">
              <input
                type="checkbox"
                checked={config.acknowledged}
                disabled={streamLive}
                onChange={(e) => setConfig((c) => ({ ...c, acknowledged: e.target.checked }))}
              />
              <span>
                This rides until <b>you stop it</b> or your funds run out. Nothing else ends it — there is no
                cap, and closing this page stops the stream rather than leaving it running.
              </span>
            </label>
          )}

          {/* What is fuelling the launch, in one line. The floor sheet is where it gets
              edited; this is a readout. */}
          <div className="muse-launcher-floor gt-sub mono">
            {liveFragments} of {flat.length} fragments in the draw
            {session ? ` · floor ${floorCounts(session).live}/${floorCounts(session).total}` : ''}
            {' · '}
            <button type="button" className="linkish" disabled={!session} onClick={() => setFloorOpen(true)}>
              open the floor
            </button>
          </div>

          <div className="muse-launcher-row">
            {streamLive ? (
              <button type="button" className="btn accent muse-stop" disabled={phase === 'stopping'} onClick={requestStop}>
                {phase === 'stopping' ? 'stopping after this piece…' : 'stop'}
              </button>
            ) : (
              <button type="button" className="btn accent muse-launch" disabled={!!blockLaunch} onClick={() => void launch()}>
                {launchLabel(config, quote)}
              </button>
            )}
            <span className="muse-state mono">{streamStatusLine(phase, stopCause, firedCount, config, quote, hold)}</span>
          </div>

          {/* The pod fetches a newly chosen LoRA's weights before it can make anything
              with them, so the first piece under one can be slow. Said, rather than left
              to read as a stall. */}
          {warmup && phase === 'running' && <div className="gt-sub mono">{loraWarmupNote(warmup)}</div>}

          {flowLoading && <div className="gt-sub mono">reading inputs…</div>}
          {blockLaunch && !streamLive && (
            <div className="gt-sub mono">{blockLaunch}</div>
          )}
          {quoteError && <div className="gt-sub mono">{quoteError}</div>}
          {streamError && <div className="gt-sub mono">{streamError}</div>}
          {quote && (
            <div className="gt-sub mono">
              ~ is an estimate: the figure is the run's reservation, and the server prices and charges
              every piece when it settles.
            </div>
          )}
          {flows !== null && flows.length === 0 && (
            <div className="gt-sub mono">no text-to-image workflow is available.</div>
          )}

          {/* V7's refusal half: an empty floor has nothing to make, and the exits are
              offered side by side rather than as an error. A thin floor is allowed to run. */}
          {liveFragments <= 0 && (
            <div className="muse-empty-floor">
              <span className="gt-sub mono">nothing is in the draw.</span>
              <button type="button" className="btn ghost sm" disabled={!session} onClick={() => setFloorOpen(true)}>
                add a fragment yourself — free
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setAddOpen(true)}>
                add images to the moodboard
              </button>
            </div>
          )}
        </section>

        {/* Widening the SET (noema-260). Kept out of the sticky launcher above — it is a
            panel, not a control — and reachable whatever the floor holds: a healthy floor
            is still a floor that can be grown. */}
        <AddImages
          dataset={d}
          open={addOpen}
          onOpenChange={setAddOpen}
          onAppended={(updated) => setDatasets((ds) => replaceDataset(ds, updated))}
          next={afterAppend}
        />

        {/* The stream: what this screen has made, on this screen. Newest first, held
            back while the user is scrolled away from the head of the grid. */}
        {(stream.pieces.length > 0 || stream.pending.length > 0) && (
          <section className="muse-stream">
            <div className="muse-stream-head">
              <span className="gc-l">stream</span>
              <span className="gt-sub mono">
                {stream.pieces.length} {stream.pieces.length === 1 ? 'piece' : 'pieces'} · tap a tile to expand
                {frozen && stream.pending.length > 0 ? ' · held while you scroll' : ''}
              </span>
              {stream.pending.length > 0 && (
                <button type="button" className="muse-new-pill" onClick={() => setStream(releasePending)}>
                  {stream.pending.length} new ↑
                </button>
              )}
            </div>
            <div
              className="muse-grid"
              ref={gridRef}
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
            >
              {stream.pieces.map((p) => (
                <PieceTile
                  key={p.runId}
                  piece={p}
                  onExpand={setExpanded}
                  onResult={onPieceResult}
                  reaction={session ? reactionOf(session, p.runId) : undefined}
                  live={!!session && !!recordedPiece(session, p.runId) && reacting !== p.runId}
                  onReact={react}
                  onDismiss={dismiss}
                />
              ))}
            </div>
            {/* A held piece is still generating on a pod that is already paid for, so it
                keeps its subscription even though its tile is not on screen yet. */}
            {stream.pending.map((p) => (
              p.status === 'running'
                ? <RunWatcher key={p.runId} runId={p.runId} onResult={onPieceResult} />
                : null
            ))}
          </section>
        )}

        <div className="garden">
          {/* the pooled garden, by category, with counts — a zero-count category renders as
              zero rather than being hidden; an empty category is information. */}
          <aside className="garden-cats muse-cats">
            <div className="gc-l">categories</div>
            {counts.map(({ category, count: n }) => (
              <div key={category} className="muse-cat-row">
                <span className="gc-dot" style={{ background: categoryColor(category) }} /> {category}
                <span className="gc-n mono">{n}</span>
              </div>
            ))}
          </aside>

          {/* curation: every fragment in the pooled garden, checkable */}
          <div className="garden-traits">
            <div className="gt-head">
              <span className="gt-title"><b>Garden</b></span>
            </div>
            <div className="gt-sub mono">check/uncheck a fragment to include/exclude it from the next roll</div>
            {flat.length === 0 ? (
              <div className="gt-sub mono">no fragments pooled.</div>
            ) : (
              <div className="pref-chips muse-garden">
                {flat.map((f, i) => {
                  const on = !excluded.has(i);
                  return (
                    <button
                      key={`${f.category}-${i}`}
                      type="button"
                      className={`fchip${on ? ' on' : ''}`}
                      title={`${f.category} · ${f.source}`}
                      onClick={() => toggle(i)}
                    >
                      <span style={{ background: categoryColor(f.category), width: 8, height: 8, borderRadius: 2, display: 'inline-block', marginRight: 6 }} />
                      {f.text}
                    </button>
                  );
                })}
              </div>
            )}

            {/* The manual path (D3), closed by default: roll a batch of prompts, edit
                one, fire that one. Same nozzle, same route, same stream — it is the
                stream's front door that has changed, not what a piece is. */}
            <details className="muse-manual" open={manualOpen} onToggle={(e) => setManualOpen((e.target as HTMLDetailsElement).open)}>
            <summary className="muse-manual-summary">roll prompts by hand</summary>

            <div className="muse-roll-controls">
              <label className="cc-field cc-narrow"><span>Rolls</span>
                <input className="cer-input" type="number" min={1} max={50} value={count}
                  onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} /></label>
              <button className="btn accent" disabled={liveFragments === 0} onClick={roll}>
                Roll →
              </button>
              <span className="gt-sub mono">
                {modusId
                  ? (blockReason ?? (quote ? `fires at ~${quote.impetus} impetus each` : 'pricing…'))
                  : 'choose a nozzle above to fire one'}
              </span>
            </div>

            {report && (
              <div className="muse-rolls">
                {report.rolls.length === 0 ? (
                  <div className="gt-sub mono">every fragment is excluded — nothing to roll.</div>
                ) : report.rolls.map((r) => (
                  <div key={r.index} className="muse-roll">
                    <div className="muse-roll-head">
                      <span className={`muse-badge ${r.paid ? 'paid' : 'free'}`}>{r.paid ? 'paid — a smoother would run' : 'free'}</span>
                    </div>
                    <textarea
                      className="cer-input muse-roll-text"
                      value={edits[r.index] ?? r.prompt}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [r.index]: e.target.value }))}
                    />
                    <div className="muse-roll-frags mono">
                      {r.fragments.map((f, j) => (
                        <span key={j} className="muse-roll-frag" style={{ borderColor: categoryColor(f.category) }}>
                          [{f.category}] {f.text}{f.trigger ? ` <- ${f.trigger}` : ''}
                        </span>
                      ))}
                    </div>
                    <div className="muse-roll-foot">
                      <button className="btn ghost sm" onClick={() => setKept((prev) => [...prev, { prompt: promptOf(r.index, r.prompt), paid: r.paid }])}>
                        Keep
                      </button>
                      {/* One control, and it fires this one prompt. The price sits on the
                          launch control above: a t2i reservation is evaluated against the
                          run's numeric inputs, and Muse sends only a prompt, so editing the
                          text here does not change what this costs. */}
                      {(() => {
                        const prompt = promptOf(r.index, r.prompt);
                        const armed = canFireOne(modusId, prompt, blockReason);
                        return (
                          <button
                            className="btn accent sm"
                            disabled={!armed || busy === r.index}
                            onClick={() => doFire(r.index, prompt, r.fragments)}
                          >
                            {busy === r.index ? 'firing…' : 'Fire this one →'}
                          </button>
                        );
                      })()}
                      {fired[r.index]?.error && (
                        <span className="gt-sub mono">{fired[r.index]!.error}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {kept.length > 0 && (
              <div className="muse-kept">
                <div className="gc-l">kept ({kept.length})</div>
                {kept.map((k, i) => (
                  <div key={i} className="muse-kept-row">
                    <span className={`muse-badge sm ${k.paid ? 'paid' : 'free'}`}>{k.paid ? 'paid' : 'free'}</span>
                    <span className="mono">{k.prompt}</span>
                  </div>
                ))}
              </div>
            )}
            </details>
          </div>
        </div>

        <div className="garden-foot">
          <Link className="btn ghost" to={`/datasets/${id}`}>← {d.name}</Link>
        </div>

        {expandedPiece && (
          <ExpandedPiece
            piece={expandedPiece}
            onClose={() => setExpanded(null)}
            reaction={session ? reactionOf(session, expandedPiece.runId) : undefined}
            live={!!session && !!recordedPiece(session, expandedPiece.runId) && reacting !== expandedPiece.runId && saving !== expandedPiece.runId}
            onReact={react}
            onDismiss={dismiss}
            saved={!!session && savedOf(session, expandedPiece.runId)}
            onSave={save}
          />
        )}

        {/* The dock (V1) and the steer keyboard (S3, S14), in one sticky block at the
            bottom of the viewport. It is reachable while the stream runs, and it sits
            BELOW the grid rather than over it — the newest tile lands at the top, so
            nothing here covers it. */}
        <div className="muse-steerdock">
          {/* S12's offer, and it is an offer: tapping it PRE-FILLS the instruction and
              does nothing else. No steer is sent, nothing is spent, and the box is left
              for the user to edit or ignore. */}
          {offer && !sheet && (
            <button
              type="button"
              className="muse-steer-offer"
              onClick={() => { setSteerText(offer.instruction); steerInput.current?.focus(); }}
            >
              {offer.line}
            </button>
          )}

          <form
            className="muse-steer"
            onSubmit={(e) => { e.preventDefault(); void doSteer(); }}
          >
            <input
              ref={steerInput}
              className="inp muse-steer-input"
              type="text"
              aria-label="steer the floor"
              placeholder="say what to change — e.g. lose the neon, try dusk light"
              value={steerText}
              maxLength={MAX_INSTRUCTION_CHARS}
              onChange={(e) => setSteerText(e.target.value)}
            />
            {/* Send is the ONLY thing that fires a steer: not blur, not a stray enter in
                the scroll, not the offer above. */}
            <button type="submit" className="btn accent sm muse-steer-send" disabled={!!steerBlock}>
              {steering ? 'reading…' : (steerQuote ? `Steer → ~${steerQuote}` : 'Steer →')}
            </button>
          </form>

          <div className="muse-steer-note mono">
            {steerBlock && steerText.trim() !== ''
              ? steerBlock
              : (steerQuoteError
                ?? `${instructionRemaining(steerText)} characters left · ~ is an estimate: the server prices this run when it settles`)}
          </div>
          {steerError && <div className="muse-steer-note mono">{steerError}</div>}

        <div className="muse-dock">
          <span className="mono muse-dock-count">
            {session
              ? `floor ${floorCounts(session).live}/${floorCounts(session).total} in the draw`
              : (sessionError ? 'no session — reactions are off' : 'opening a session…')}
          </span>
          <button
            type="button"
            className="btn ghost sm"
            disabled={!session}
            onClick={() => setFloorOpen(true)}
          >
            floor ↑
          </button>
        </div>
        {sessionError && <div className="muse-dock-note mono">{sessionError}</div>}
        </div>

        {/* The consent sheet (S9) — a proposal awaiting a ruling, and a DIFFERENT surface
            from the cutting floor above, which is the standing state. */}
        {sheet && (
          <ConsentSheet
            proposal={sheet.proposal}
            vetoed={sheet.vetoed}
            phase={sheet.phase}
            outcome={sheet.outcome}
            applying={applying}
            onVeto={toggleVeto}
            onConfirm={() => void confirmSheet()}
            onClose={() => setSheet(null)}
          />
        )}

        {floorOpen && session && (
          <FloorSheet
            session={session}
            busyKey={floorBusy}
            onToggle={toggleFloorPill}
            onAdd={addToFloor}
            adding={adding}
            onClose={() => setFloorOpen(false)}
          />
        )}
      </div></div>
    </AppShell>
  );
}

/** Headless: one piece's subscription to its own run. Reports terminal upward once,
 *  where `applyRunResult` folds the produced media into the piece. Split out so a held
 *  piece — one that has no tile on screen yet — is still watched.
 *  The subscription ends at terminal (a watcher per finished piece would be an open
 *  stream per finished piece), so the terminal it reports has to carry the run's
 *  outputs already — see `announceTerminal` in lib/runStream.ts. */
function RunWatcher({ runId, onResult }: { runId: string; onResult: (runId: string, r: RunResult) => void }) {
  const { terminal, exitus, error } = useRunStream(runId);
  useEffect(() => {
    if (!terminal) return;
    onResult(runId, { terminal, exitus, error });
  }, [runId, terminal, exitus, error, onResult]);
  return null;
}

/** What every rail — the tile's and the expanded view's — does with one gesture: the two
 *  steers and 😂 are reactions on the piece, ✕ is a dismissal, and ↓ puts the piece back
 *  into the set. Save is offered only where its rail carries it — the expanded view — so
 *  the tile passes no handler and the gesture reads as unavailable rather than silent. */
function railProps(
  key: string,
  runId: string,
  live: boolean,
  reaction: MuseReaction | undefined,
  onReact: (runId: string, reaction: MuseReaction) => void,
  onDismiss: (runId: string) => void,
  saved = false,
  onSave?: (runId: string) => void,
): { disabled: boolean; className: string; onClick?: () => void; title?: string } {
  const REACTIONS: Record<string, MuseReaction> = { up: 'up', down: 'down', laugh: 'note' };
  const asReaction = REACTIONS[key];
  if (asReaction) {
    return {
      disabled: !live,
      className: `muse-gesture${reaction === asReaction ? ' on' : ''}`,
      onClick: () => onReact(runId, asReaction),
    };
  }
  if (key === 'dismiss') {
    return { disabled: !live, className: 'muse-gesture', onClick: () => onDismiss(runId) };
  }
  if (!onSave) return { disabled: true, className: 'muse-gesture' };
  // A piece already in the set is shown as saved and is not offered again: the dataset is
  // append-only, so a second save would put the same media in twice.
  return {
    disabled: !live || saved,
    className: `muse-gesture${saved ? ' on' : ''}`,
    onClick: () => onSave(runId),
    title: saved ? 'saved — this piece is in the set' : 'save this piece back into the set',
  };
}

/** One tile in the stream. Roughly 145px on a phone, which fits three targets legibly —
 *  the two steers and declutter (V8a). They write to the session; a piece the session
 *  ledger does not hold cannot be reacted to and its rail is disabled rather than silent.
 *  The rest of the rail lives in the expanded view. */
function PieceTile({
  piece, onExpand, onResult, reaction, live, onReact, onDismiss,
}: {
  piece: StreamPiece;
  onExpand: (runId: string) => void;
  onResult: (runId: string, r: RunResult) => void;
  reaction: MuseReaction | undefined;
  live: boolean;
  onReact: (runId: string, reaction: MuseReaction) => void;
  onDismiss: (runId: string) => void;
}) {
  return (
    <div className={`muse-tile ${piece.status}`}>
      {piece.status === 'running' && <RunWatcher runId={piece.runId} onResult={onResult} />}
      <button
        type="button"
        className="muse-tile-shot"
        onClick={() => onExpand(piece.runId)}
        title={piece.prompt}
      >
        {piece.media ? (
          piece.media.kind === 'video'
            ? <video className="muse-tile-media" src={piece.media.url} muted loop playsInline />
            : <img className="muse-tile-media" src={piece.media.url} alt="" loading="lazy" />
        ) : (
          <span className="muse-tile-wait mono">
            {piece.status === 'failed' ? (piece.error ?? 'failed') : 'generating…'}
          </span>
        )}
      </button>
      <div className="muse-tile-rail">
        {TILE_GESTURES.map((g) => {
          const { title, ...rail } = railProps(g.key, piece.runId, live, reaction, onReact, onDismiss);
          return (
            <button key={g.key} type="button" {...rail} title={title ?? g.label}>
              {g.glyph}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The expanded piece: the full action rail and the lineage — the fragments that
 *  produced it (V8). 😂 lives here rather than on the tile: it is recorded and it steers
 *  nothing (S4/V9), so it is not one of the three gestures made at speed. */
function ExpandedPiece({
  piece, onClose, reaction, live, onReact, onDismiss, saved, onSave,
}: {
  piece: StreamPiece;
  onClose: () => void;
  reaction: MuseReaction | undefined;
  live: boolean;
  onReact: (runId: string, reaction: MuseReaction) => void;
  onDismiss: (runId: string) => void;
  saved: boolean;
  onSave: (runId: string) => void;
}) {
  return (
    <div className="muse-expanded" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="muse-expanded-card" onClick={(e) => e.stopPropagation()}>
        <div className="muse-expanded-shot">
          {piece.media ? (
            piece.media.kind === 'video'
              ? <video src={piece.media.url} controls playsInline />
              : <img src={piece.media.url} alt="" />
          ) : (
            <span className="muse-tile-wait mono">
              {piece.status === 'failed' ? (piece.error ?? 'failed') : 'generating…'}
            </span>
          )}
        </div>

        <div className="muse-expanded-rail">
          {EXPANDED_GESTURES.map((g) => {
            const { title, ...rail } = railProps(g.key, piece.runId, live, reaction, onReact, onDismiss, saved, onSave);
            return (
              <button key={g.key} type="button" {...rail} title={title ?? g.label}>
                {g.glyph}
              </button>
            );
          })}
          <button type="button" className="btn ghost sm muse-expanded-close" onClick={onClose}>Close</button>
        </div>

        <div className="muse-expanded-prompt mono">{piece.prompt}</div>

        <div className="gc-l">lineage</div>
        <div className="muse-roll-frags mono">
          {lineageOf(piece).map((f, i) => (
            <span key={i} className="muse-roll-frag" style={{ borderColor: categoryColor(f.category) }}>
              [{f.category}] {f.text}{f.trigger ? ` <- ${f.trigger}` : ''}
            </span>
          ))}
        </div>

        <div className="muse-expanded-foot">
          <Link className="mono" to={`/run?id=${piece.runId}`}>open run view →</Link>
        </div>
      </div>
    </div>
  );
}


/**
 * The floor sheet (V1) — pulled up from the dock, the full-fidelity cutting floor.
 *
 * Every fragment the session holds, grouped by category in sampling order, with a
 * live/total count per category. A fragment a steer turned off is DARK AND STILL HERE,
 * and tapping it brings it back: "what did my steer turn off" is the question this sheet
 * exists to answer, and reversibility is why the pull-up sheet won over the cheaper
 * options. Weighted fragments carry their weight.
 *
 * The sheet renders from the session it is handed — the one the server returned — so it
 * shows the same floor after a reload as before it.
 */
function FloorSheet({
  session, busyKey, onToggle, onAdd, adding, onClose,
}: {
  session: MuseSessionView;
  busyKey: string | null;
  onToggle: (pill: FloorPill) => void;
  onAdd: (category: FragmentCategory, text: string) => Promise<boolean>;
  adding: boolean;
  onClose: () => void;
}) {
  const rows = floorSheet(session);
  const { live, total } = floorCounts(session);
  const [addCategory, setAddCategory] = useState<FragmentCategory | ''>('');
  const [addText, setAddText] = useState('');
  const addError = manualAddError(session, addCategory, addText);
  // Silent until the user has said something — a form that opens already complaining
  // reads as broken. Once either field is touched, the reason is on screen rather than
  // hidden behind a disabled button.
  const showError = addCategory !== '' || addText.trim() !== '';

  async function submitAdd(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (addError || addCategory === '' || adding) return;
    if (await onAdd(addCategory, addText)) setAddText('');
  }
  return (
    <div className="muse-sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="muse-sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="muse-sheet-head">
          <span className="gc-l">cutting floor</span>
          <span className="gt-sub mono">{live}/{total} in the draw · tap a fragment to turn it off or back on</span>
          <button type="button" className="btn ghost sm muse-sheet-close" onClick={onClose}>Close</button>
        </div>
        {/* The free widening (noema-242): pick a category, write a fragment, and it lands
            on the floor in the draw. Nothing on this screen composes a phrase that is not
            already here, so this is the form that answers a floor too narrow to work with —
            and it costs nothing to use. */}
        <form className="muse-add" onSubmit={submitAdd}>
          <div className="muse-add-row">
            <select
              className="inp muse-add-cat"
              aria-label="fragment category"
              value={addCategory}
              onChange={(e) => setAddCategory(e.target.value as FragmentCategory | '')}
            >
              <option value="">category…</option>
              {MANUAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input
              className="inp muse-add-text"
              aria-label="fragment text"
              placeholder="write a fragment — e.g. a short, prompt-ready phrase"
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
            />
            <button type="submit" className="btn sm" disabled={!!addError || adding}>
              {adding ? 'adding…' : 'add to the floor'}
            </button>
          </div>
          <div className="gt-sub mono muse-add-note">
            {showError && addError ? addError : 'free — this reaches no model. it lands in the draw at even odds.'}
          </div>
        </form>
        {rows.length === 0 ? (
          <div className="gt-sub mono">this session's floor is empty.</div>
        ) : rows.map((row) => (
          <div key={row.category} className="muse-sheet-cat">
            <div className="muse-cat-row">
              <span className="gc-dot" style={{ background: categoryColor(row.category) }} /> {row.category}
              <span className="gc-n mono">{row.live}/{row.total}</span>
            </div>
            <div className="pref-chips muse-sheet-pills">
              {row.fragments.map((pill) => {
                const key = `${pill.category}:${pill.text}`;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`fchip muse-floor-pill${pill.enabled ? ' on' : ' off'}`}
                    disabled={busyKey === key}
                    title={pill.enabled ? 'in the draw — tap to turn it off' : 'turned off — tap to bring it back'}
                    onClick={() => onToggle(pill)}
                  >
                    <span style={{ background: categoryColor(pill.category), width: 8, height: 8, borderRadius: 2, display: 'inline-block', marginRight: 6 }} />
                    {pill.text}
                    {pill.weight !== 1 && <span className="muse-floor-weight mono"> ×{pill.weight}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The consent sheet (S9) — what a steer proposed, awaiting a ruling.
 *
 * A DIFFERENT SURFACE FROM THE CUTTING FLOOR. The floor sheet is the standing state of the
 * session; this is a proposal about it, and nothing in it has been applied. Every pill is
 * vetoable by tapping, Cancel writes nothing at all, and Confirm is the only thing on this
 * screen that turns a steer into floor writes.
 *
 * Three things it says out loud, each because leaving it unsaid misleads:
 *
 *   HOW MANY SUGGESTIONS WERE DROPPED. The route counts them precisely; swallowing the
 *   count is how a user comes to believe they vetoed something never proposed to them.
 *
 *   THAT THE STREAM IS STILL RUNNING. Pieces already in flight are paid for and the loop
 *   is not held — a piece that lands from the old floor while this is open is correct, and
 *   the next draw after a confirmed write picks the new floor up on its own.
 *
 *   WHAT DID NOT LAND. A confirm that fails part-way keeps what landed and names the rest.
 *
 * It renders no provenance for an addition: a confirmed addition is stored through the
 * floor-fragments route, which files it as a manual fragment, so a "proposed by a steer"
 * label here would claim something the floor does not carry.
 */
function ConsentSheet({
  proposal, vetoed, phase, outcome, applying, onVeto, onConfirm, onClose,
}: {
  proposal: MuseSteerProposal;
  vetoed: ReadonlySet<string>;
  phase: SheetPhase;
  outcome: string | null;
  applying: boolean;
  onVeto: (key: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const pills = proposalPills(proposal);
  const dropped = droppedNote(proposal.dropped);
  const surviving = writesForConfirm(proposal, vetoed, 'confirmed').length;
  return (
    <div className="muse-sheet muse-consent" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="muse-sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="muse-sheet-head">
          <span className="gc-l">proposed changes</span>
          <span className="gt-sub mono">
            {phase === 'confirmed'
              ? 'applied'
              : 'tap a pill to reject it · nothing moves until you confirm'}
          </span>
          <button type="button" className="btn ghost sm muse-sheet-close" onClick={onClose}>Close</button>
        </div>

        {pills.length === 0 ? (
          <div className="gt-sub mono">this steer proposed no changes to your floor.</div>
        ) : (
          <div className="pref-chips muse-consent-pills">
            {pills.map((pill) => (
              <ConsentPill
                key={`${pill.kind}:${pill.key}`}
                pill={pill}
                vetoed={vetoed.has(pill.key)}
                disabled={phase === 'confirmed' || applying}
                onVeto={onVeto}
              />
            ))}
          </div>
        )}

        {dropped && <div className="gt-sub mono muse-consent-dropped">{dropped}</div>}

        {phase === 'confirmed' ? (
          <div className="gt-sub mono muse-consent-outcome">{outcome}</div>
        ) : (
          <>
            <div className="muse-consent-foot">
              <button type="button" className="btn ghost sm" disabled={applying} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn accent sm" disabled={applying} onClick={onConfirm}>
                {applying ? 'applying…' : `Confirm ${surviving} ${surviving === 1 ? 'change' : 'changes'}`}
              </button>
            </div>
            <div className="gt-sub mono">
              Cancel writes nothing. An elimination turns a fragment off and leaves it on the cutting
              floor, where tapping it brings it back. The stream keeps running while this is open —
              pieces already on their way were drawn from the floor as it stands.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One proposed change. A vetoed pill is struck through and stays visible: "what did I say
 *  no to" has to be answerable without closing the sheet, and a veto is reversible until
 *  the confirm. */
function ConsentPill({
  pill, vetoed, disabled, onVeto,
}: {
  pill: SteerPill;
  vetoed: boolean;
  disabled: boolean;
  onVeto: (key: string) => void;
}) {
  return (
    <button
      type="button"
      className={`fchip muse-consent-pill ${pill.kind}${vetoed ? ' vetoed' : ''}`}
      disabled={disabled}
      title={vetoed
        ? 'rejected — tap to put it back in'
        : (pill.kind === 'elimination'
          ? 'turns this fragment off — tap to reject the change'
          : 'puts this fragment on the floor — tap to reject the change')}
      onClick={() => onVeto(pill.key)}
    >
      <span style={{ background: categoryColor(pill.category), width: 8, height: 8, borderRadius: 2, display: 'inline-block', marginRight: 6 }} />
      <span className="muse-consent-verb">{pill.kind === 'elimination' ? 'off' : 'add'}</span>
      {' '}{pill.text}
    </button>
  );
}
