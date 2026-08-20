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
} from '../lib/api';
import { useRunStream } from '../lib/runStream';
import {
  canFireDecompose,
  canOfferDecompose,
  decomposeCaptionsetId,
  launchCaptionJob,
  launchDecomposeJob,
} from '../lib/training';
import {
  admitPiece,
  appendFailureNote,
  appendMediaRequest,
  applyRunResult,
  buildGarden,
  captionCoverageLine,
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
  latestSession,
  launchBlockReason,
  launchLabel,
  lineageOf,
  manualAddError,
  manualAddRequest,
  mergedExclusions,
  nextPieceDecision,
  pieceRecord,
  decomposeGateReason,
  poolDatasetFragments,
  reactionOf,
  recordedPiece,
  releasePending,
  replaceDataset,
  rollAt,
  rollCurated,
  savedOf,
  streamColumns,
  streamPiece,
  streamStatusLine,
  t2iFlows,
  weightWrites,
  EMPTY_STREAM,
  EXPANDED_GESTURES,
  MANUAL_CATEGORIES,
  TILE_GESTURES,
  type FloorPill,
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
// created, and the request carries no `pinnedModels` — a trigger word rides the prompt
// text and `src/crystal/loraResolver.ts` resolves it server-side, exactly as it does
// for `Card.tsx` and every other run in the product.
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

/** Upload one file to R2 through the signed-PUT path and return its permanent URL —
 *  the same two-step contract `Datasets.tsx` and `Profile.tsx` upload through, so there
 *  is one upload path in the app rather than a second one here. */
async function uploadImage(file: File): Promise<string> {
  const { signedUrl, permanentUrl } = await api.signUpload({ filename: file.name, contentType: file.type });
  const put = await fetch(signedUrl, { method: 'PUT', headers: { 'content-type': file.type }, body: file });
  if (!put.ok) throw new Error(`upload failed (${put.status})`);
  return permanentUrl;
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
  // that this resolves. One waiter per run, removed as it is resolved.
  const settlers = useRef(new Map<string, (r: RunResult) => void>());
  const onPieceResult = useCallback((runId: string, result: RunResult) => {
    setStream((s) => applyRunResult(s, runId, result));
    const waiting = settlers.current.get(runId);
    if (waiting) {
      settlers.current.delete(runId);
      waiting(result);
    }
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
      for (const write of weightWrites(next, runId, reaction)) {
        next = (await api.setMuseFragmentWeight(session.id, write.fragment, write.weight)).session;
      }
      setSession(next);
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
      return true;
    } catch (e) {
      setSessionError(`that fragment didn't land: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    } finally {
      setAdding(false);
    }
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
    if (!id_) return;
    setFlowLoading(true);
    api.getFlow(id_)
      .then((f) => setBlockReason(ignitionBlockReason(f)))
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

  const stopRef = useRef(false);
  const runningRef = useRef(false);
  // One token per launch. A loop parked on a settlement that never arrives — a closed
  // page, an unmount — must not wake up later and fire into a stream someone else
  // started, so every await is followed by a generation check.
  const generationRef = useRef(0);
  useEffect(() => () => { generationRef.current += 1; runningRef.current = false; }, []);

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
        });
        if (!decision.fire) { end = decision.stop ?? 'user'; break; }

        const modus = modusRef.current;
        if (!modus) { end = 'user'; break; }

        // A fresh draw at an advancing index: the sampler is deterministic by design, so
        // a fixed index would fire one prompt over and over. The floor is re-read here,
        // which is what lets a steer mid-stream reach the very next piece.
        const draw = rollAt(flatRef.current, outOfPlayRef.current, fired);

        let runId: string;
        try {
          const { run } = await api.createRun(ignitionRequest(modus, draw.prompt));
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
        setStream((s) => admitPiece(s, streamPiece(runId, draw.prompt, draw.fragments), frozenRef.current));

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
  const total = d.media.length;
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
          {captioning ? 'starting…' : `Caption all ${total} ${total === 1 ? 'image' : 'images'} →`}
        </button>
        <span className="gt-sub mono">
          a caption pass captions every image in the set, not only the ones just added — this one is
          {' '}{total} {total === 1 ? 'image' : 'images'} · billed like any other run
        </span>
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
              <select className="cer-input" value={modusId ?? ''} disabled={phase === 'running' || phase === 'stopping'}
                onChange={(e) => selectFlow(e.target.value)}>
                <option value="">choose a workflow…</option>
                {(flows ?? []).map((f) => (
                  <option key={f.id} value={f.id}>{f.nomen ?? f.id}{f.versio ? ` · ${f.versio}` : ''}</option>
                ))}
              </select>
            </label>

            <fieldset className="muse-mode" disabled={phase === 'running' || phase === 'stopping'}>
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

          {/* The warning is a GATE, not a caption (V5). An infinite stream carries no
              count, so the balance is the only thing that ends it on its own; the
              acknowledgement is what stands in for the count that is not there. */}
          {config.mode === 'infinite' && (
            <label className="muse-ack">
              <input
                type="checkbox"
                checked={config.acknowledged}
                disabled={phase === 'running' || phase === 'stopping'}
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
            {phase === 'running' || phase === 'stopping' ? (
              <button type="button" className="btn accent muse-stop" disabled={phase === 'stopping'} onClick={requestStop}>
                {phase === 'stopping' ? 'stopping after this piece…' : 'stop'}
              </button>
            ) : (
              <button type="button" className="btn accent muse-launch" disabled={!!blockLaunch} onClick={() => void launch()}>
                {launchLabel(config, quote)}
              </button>
            )}
            <span className="muse-state mono">{streamStatusLine(phase, stopCause, firedCount, config, quote)}</span>
          </div>

          {flowLoading && <div className="gt-sub mono">reading inputs…</div>}
          {blockLaunch && phase !== 'running' && phase !== 'stopping' && (
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

        {/* The dock: the floor in one line, and the handle that pulls the sheet up (V1).
            The counts come off the session, so they say what the floor holds rather than
            what this screen last did to it. */}
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
 *  piece — one that has no tile on screen yet — is still watched. */
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

/** What one chosen file is doing, as words. A row that says nothing while a batch runs
 *  is a row the user cannot tell apart from a stuck one. */
const FILE_STATE: Record<string, string> = {
  waiting: 'waiting',
  uploading: 'uploading…',
  added: 'uploaded',
  failed: 'did not upload',
};

/**
 * Add images to the moodboard (noema-260) — V7's second exit, and the only control on
 * this screen that writes to the DATASET rather than to the session.
 *
 * Three properties it holds, each of them a rule rather than a preference:
 *
 *   AN EMPTY SELECTION FIRES NOTHING. No signature, no PUT, no append. An append of
 *   nothing would still mint a dataset version and recompute every pass' coverage over
 *   an unchanged set — a version recording that nothing happened.
 *
 *   A FILE THAT FAILS DOES NOT TAKE THE BATCH WITH IT. What uploaded is appended and
 *   what did not is named. Abandoning the whole batch on one failure loses the user's
 *   other files for no reason.
 *
 *   THE SET IS REBUILT FROM THE RESPONSE. The append returns the whole dataset — the
 *   new version, the new media, and every caption pass' recomputed coverage — and that
 *   is what the screen re-renders from. A locally patched copy would be a version
 *   behind and would show a coverage denominator that no longer exists.
 */
function AddImages({
  dataset, open, onOpenChange, onAppended, next,
}: {
  dataset: DatasetT;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAppended: (dataset: DatasetT) => void;
  next: ReactNode;
}) {
  const [pending, setPending] = useState<File[]>([]);
  const [states, setStates] = useState<Record<number, string>>({});
  const [appending, setAppending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function append() {
    if (appending) return;
    // The refusal is the pure one: `appendMediaRequest` returns null for an empty list,
    // and nothing is signed, uploaded or posted.
    if (appendMediaRequest(pending.map((f) => f.name)) === null) {
      setMsg({ ok: false, text: 'choose some images first' });
      return;
    }
    setAppending(true);
    setMsg(null);
    setStates(Object.fromEntries(pending.map((_, i) => [i, 'waiting'])));

    const uploaded: string[] = [];
    const failed: string[] = [];
    for (const [i, file] of pending.entries()) {
      setStates((st) => ({ ...st, [i]: 'uploading' }));
      try {
        uploaded.push(await uploadImage(file));
        setStates((st) => ({ ...st, [i]: 'added' }));
      } catch {
        failed.push(file.name);
        setStates((st) => ({ ...st, [i]: 'failed' }));
      }
    }

    const request = appendMediaRequest(uploaded);
    if (!request) {
      setMsg({ ok: false, text: appendFailureNote(failed) ?? 'nothing uploaded, so nothing was added' });
      setAppending(false);
      return;
    }
    try {
      const { dataset: updated } = await api.addDatasetMedia(dataset.id, request);
      onAppended(updated);
      setPending([]);
      const n = request.mediaUrls.length;
      const note = appendFailureNote(failed);
      setMsg({
        ok: true,
        text: `${n} ${n === 1 ? 'image' : 'images'} added — the set is now ${updated.media.length}`
          + (note ? ` · ${note}` : '')
          + '. captioning is the next step; nothing has been spent yet.',
      });
    } catch (e) {
      setMsg({ ok: false, text: `those images uploaded but weren't added to the set: ${errText(e)}` });
    } finally {
      setAppending(false);
    }
  }

  const label = pending.length === 0
    ? 'Add images — free'
    : `Add ${pending.length} ${pending.length === 1 ? 'image' : 'images'} — free`;

  return (
    <section className="muse-add-images">
      <details open={open} onToggle={(e) => onOpenChange((e.target as HTMLDetailsElement).open)}>
        <summary className="muse-manual-summary">add images to the moodboard</summary>
        <div className="muse-add-images-body">
          <div className="gt-sub mono">
            Three steps, and only the first is free: the images join the set, a caption pass has to
            read the set, and a decompose is what turns those captions into fragments on the floor.
          </div>
          <div className="muse-add-images-row">
            <input
              type="file" accept="image/*" multiple disabled={appending}
              aria-label="images to add"
              onChange={(e) => { setPending(Array.from(e.target.files ?? [])); setStates({}); setMsg(null); }}
            />
            <button type="button" className="btn accent sm" disabled={appending || pending.length === 0}
              onClick={() => void append()}>
              {appending ? 'uploading…' : label}
            </button>
          </div>
          {pending.length > 0 && (
            <ul className="muse-add-files mono">
              {pending.map((f, i) => (
                <li key={`${i}:${f.name}`} className={`muse-add-file-row ${states[i] ?? 'waiting'}`}>
                  <span className="muse-add-file-name">{f.name}</span>
                  <span className="muse-add-file-state">{FILE_STATE[states[i] ?? 'waiting']}</span>
                </li>
              ))}
            </ul>
          )}
          {msg && <div className="gt-sub mono">{msg.text}</div>}
          {next}
        </div>
      </details>
    </section>
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
