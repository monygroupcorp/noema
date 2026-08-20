import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import {
  api,
  type Dataset as DatasetT,
  type FlowSummary,
  type Fragment,
  type MuseReaction,
  type MuseSessionView,
} from '../lib/api';
import { useRunStream } from '../lib/runStream';
import {
  canFireDecompose,
  canOfferDecompose,
  decomposeCaptionsetId,
  launchDecomposeJob,
} from '../lib/training';
import {
  admitPiece,
  applyRunResult,
  buildGarden,
  canFire,
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
  lineageOf,
  mergedExclusions,
  pieceRecord,
  poolDatasetFragments,
  reactionOf,
  recordedPiece,
  releasePending,
  rollCurated,
  streamColumns,
  streamPiece,
  t2iFlows,
  weightWrites,
  EMPTY_STREAM,
  EXPANDED_GESTURES,
  TILE_GESTURES,
  type FloorPill,
  type IgnitionQuote,
  type RollReport,
  type RunResult,
  type StreamPiece,
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
  // Per-roll quote / fire state, keyed by roll index within the current report.
  const [quotes, setQuotes] = useState<Record<number, IgnitionQuote>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [fired, setFired] = useState<Record<number, { error?: string }>>({});

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

  const onPieceResult = useCallback((runId: string, result: RunResult) => {
    setStream((s) => applyRunResult(s, runId, result));
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
    setQuotes({});
    setFired({});
    if (!id_) return;
    setFlowLoading(true);
    api.getFlow(id_)
      .then((f) => setBlockReason(ignitionBlockReason(f)))
      .catch((e) => setBlockReason(`could not read this workflow's inputs (${e instanceof Error ? e.message : String(e)})`))
      .finally(() => setFlowLoading(false));
  }

  // The prompt that fires is the prompt on screen — the edited text when there is one,
  // never the pre-edit roll, and never a fresh roll (rolling again at fire time would
  // generate a different prompt than the one that was quoted and approved).
  const promptOf = (index: number, rolled: string) => edits[index] ?? rolled;

  async function doQuote(index: number, prompt: string) {
    if (!modusId) return;
    setBusy(index);
    setFired((prev) => ({ ...prev, [index]: {} }));
    try {
      const r = await api.quote(ignitionRequest(modusId, prompt));
      setQuotes((prev) => ({ ...prev, [index]: { modusId, prompt, impetus: r.impetus } }));
    } catch (e) {
      setQuotes((prev) => { const next = { ...prev }; delete next[index]; return next; });
      setFired((prev) => ({ ...prev, [index]: { error: `quote failed: ${e instanceof Error ? e.message : String(e)}` } }));
    } finally {
      setBusy(null);
    }
  }

  async function doFire(index: number, prompt: string, lineage: readonly Fragment[]) {
    if (!modusId) return;
    if (!canFire(quotes[index] ?? null, modusId, prompt, blockReason)) return;
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
    // A new roll's prompts have never been quoted; carrying a stale quote across would
    // arm the fire button against a number that priced a different prompt.
    setQuotes({});
    setFired({});
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
                    disabled={!canFireDecompose({ captionsetId: decomposeCaptionsetId(d, decomposeSet), inFlight: decomposing })}
                    onClick={() => void doDecompose(d)}>
                    {decomposing ? 'Decomposing…' : 'Decompose these captions →'}
                  </button>
                </div>
                <div className="muse-decompose-note mono">
                  {decomposing
                    ? 'reading every caption in this set — one pass per caption, this stays open until the last one is written'
                    : 'reads every caption in this set and stores the fragments on the images they came from · billed like any other run'}
                </div>
                {decomposeMsg && <div className="muse-decompose-note mono">{decomposeMsg.text}</div>}
              </>
            ) : (
              <div className="s">
                Muse rolls prompts from decomposed captions — this dataset has none yet. Caption it, then
                decompose those captions to grow the garden.
              </div>
            )}
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
            <span className="gn-count mono">{flat.length} fragments · {flat.length - outOfPlay.size} in play across {counts.filter((c) => c.count > 0).length} categories</span>
          </div>
        </div>

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

            <div className="muse-roll-controls">
              <label className="cc-field cc-narrow"><span>Rolls</span>
                <input className="cer-input" type="number" min={1} max={50} value={count}
                  onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} /></label>
              <button className="btn accent" disabled={flat.length - outOfPlay.size === 0} onClick={roll}>
                Roll →
              </button>
            </div>

            {/* ignition target: every t2i workflow the catalog offers, in a dropdown */}
            <div className="muse-roll-controls">
              <label className="cc-field"><span>Fire at</span>
                <select className="cer-input" value={modusId ?? ''} onChange={(e) => selectFlow(e.target.value)}>
                  <option value="">choose a workflow…</option>
                  {(flows ?? []).map((f) => (
                    <option key={f.id} value={f.id}>{f.nomen ?? f.id}{f.versio ? ` · ${f.versio}` : ''}</option>
                  ))}
                </select>
              </label>
              {flows !== null && flows.length === 0 && (
                <span className="gt-sub mono">no text-to-image workflow is available.</span>
              )}
              {flowLoading && <span className="gt-sub mono">reading inputs…</span>}
              {blockReason && <span className="gt-sub mono">{blockReason}</span>}
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
                      {/* Quote first, always: the cost is on screen before a run exists.
                          Editing the prompt invalidates the quote (canFire compares the
                          quoted text to the text on screen), so the button re-arms only
                          after the edited prompt has been priced. */}
                      <button
                        className="btn ghost sm"
                        disabled={!modusId || !!blockReason || busy === r.index || promptOf(r.index, r.prompt).trim() === ''}
                        onClick={() => doQuote(r.index, promptOf(r.index, r.prompt))}
                      >
                        {busy === r.index ? 'working…' : 'Quote'}
                      </button>
                      {(() => {
                        const prompt = promptOf(r.index, r.prompt);
                        const q = quotes[r.index] ?? null;
                        const armed = canFire(q, modusId, prompt, blockReason);
                        return (
                          <>
                            {q && (
                              <span className="gt-sub mono">
                                {armed ? `${q.impetus} credits` : 'edited — quote again'}
                              </span>
                            )}
                            <button
                              className="btn accent sm"
                              disabled={!armed || busy === r.index}
                              onClick={() => doFire(r.index, prompt, r.fragments)}
                            >
                              Generate →
                            </button>
                          </>
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
            live={!!session && !!recordedPiece(session, expandedPiece.runId) && reacting !== expandedPiece.runId}
            onReact={react}
            onDismiss={dismiss}
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
 *  steers and 😂 are reactions on the piece, ✕ is a dismissal, and save is still its own
 *  rung and stays inert. */
function railProps(
  key: string,
  runId: string,
  live: boolean,
  reaction: MuseReaction | undefined,
  onReact: (runId: string, reaction: MuseReaction) => void,
  onDismiss: (runId: string) => void,
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
  return { disabled: true, className: 'muse-gesture', title: 'save — arrives with save-back' };
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
  piece, onClose, reaction, live, onReact, onDismiss,
}: {
  piece: StreamPiece;
  onClose: () => void;
  reaction: MuseReaction | undefined;
  live: boolean;
  onReact: (runId: string, reaction: MuseReaction) => void;
  onDismiss: (runId: string) => void;
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
            const { title, ...rail } = railProps(g.key, piece.runId, live, reaction, onReact, onDismiss);
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
  session, busyKey, onToggle, onClose,
}: {
  session: MuseSessionView;
  busyKey: string | null;
  onToggle: (pill: FloorPill) => void;
  onClose: () => void;
}) {
  const rows = floorSheet(session);
  const { live, total } = floorCounts(session);
  return (
    <div className="muse-sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="muse-sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="muse-sheet-head">
          <span className="gc-l">cutting floor</span>
          <span className="gt-sub mono">{live}/{total} in the draw · tap a fragment to turn it off or back on</span>
          <button type="button" className="btn ghost sm muse-sheet-close" onClick={onClose}>Close</button>
        </div>
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
