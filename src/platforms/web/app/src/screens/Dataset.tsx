import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { custodyGlyph, gardenSummaryLine, isGardenOpen, toggleGardenId } from '../lib/datasets';
import { api, type Dataset as DatasetT, type MuseSessionView } from '../lib/api';
import {
  ARCHIVE_MEANING,
  archiveStep,
  captionCoverageLine,
  captionPassLabel,
  captionPassNote,
  categoryColor,
  curatedFragments,
  decomposeGateReason,
  isArchived,
  isSameTarget,
  liveRecords,
  replaceDataset,
  sessionCountLine,
  sessionHistoryHref,
  undoOffer,
  type ArchiveDone,
  type ArchiveTarget,
} from '../lib/muse';
import { AddImages } from '../components/AddImages';
import {
  canFireDecompose,
  canOfferDecompose,
  decomposeCaptionsetId,
  decomposeFailureNote,
  decomposePlanNote,
  decomposeRunParam,
  decomposeWorkload,
  launchDecomposeJob,
  withDecomposeRunParam,
} from '../lib/training';
import { useRunStream } from '../lib/runStream';

// Dataset detail (train-dataset-spec.md, render noema-train-dataset.png) — the core asset:
// media (king) + versions + captionsets. Captionsets are a separate versioned layer (the
// lesson); you pick one when you derive a training. The custody hemisphere reflects the
// record's stored custody wherever data is read.
//
// Reads the real `GET /v1/data/datasets/full` list and finds this id client-side — noema-079's
// landed contract has no per-id detail route, only list/listFull/create (apiContract.ts:1503-
// 1521), so listFull + find is the real detail lookup (same pattern Datasets.tsx uses for the
// library grid).
//
// noema-221 (Muse P1) — the chip garden. `fragments` on a media item is data the Muse P0 engine
// (`src/crystal/muse/garden.ts`/`sampler.ts`/`weaver.ts`, merged noema-215/216) already knows how
// to produce; nothing here computes a fragment. An item's `fragments` is filled out-of-band (an
// operator run of `scripts/muse-roll.ts` against the item's caption) and rendered as chips here.
// An empty/absent `fragments` is a valid, expected "nothing has decomposed this item yet" state —
// rendered as an empty garden, never as an error.
//
// noema-323 — the chips here are READ-ONLY display: a label showing what decompose mined,
// nothing more. Curation (which fragments feed a build) now lives on the dataset-wide Muse
// screen (noema-320: chips → session floor → promote), so this screen carries a pointer to it
// instead of its own toggle affordance. One curation surface.
//
// noema-229 (Muse P3) — `categoryColor` and `curatedFragments` now live in `lib/muse.ts`, shared
// with the dataset-wide Muse screen (`/datasets/:id/muse`), and are re-exported here so this
// screen's existing test keeps working unchanged; `categoryColor` still colors each chip's dot.
//
// noema-265 — growing the set has its home here, against the media grid. The panel itself is
// `components/AddImages` (noema-260), rendered on the muse screen too; what this screen adds is
// the chain that follows an append, and it is the SAME chain, from the same pure rules in
// `lib/muse.ts`:
//
//   THE SCREEN REBUILDS FROM WHAT THE APPEND RETURNED. The response carries the new version, the
//   new media and every pass' recomputed coverage, so the header count, the coverage readout and
//   the captionset rows all move together. A screen showing nine images over a 7/7 coverage line
//   is lying about what a caption pass would cost.
//
//   THE COVERAGE GATE TRAVELS WITH THE PANEL. A pass that does not cover the appended images
//   refuses the decompose here exactly as it does on the muse screen — otherwise this surface
//   becomes the way to walk an uncaptioned image past the gate the other one enforces.
//
//   THE CAPTION CONTROL QUOTES THE WHOLE SET. A caption pass reads every image in the set, so the
//   figure on the control is the size of the set after the append, never the size of the append.
//   noema-279 narrowed what an EXTENDING pass reads to the images the chosen pass does not
//   cover, so this figure is now an upper bound on a pass launched from here rather than its
//   exact size; the caption screen quotes the pass it is about to launch before it is launched.
//
// noema-267 — the archive controls, over the server half (noema-266). Removing an image lives
// against the grid it removes from; archiving the whole set lives with the set's own identity in
// the header, not buried in a menu. Both are plain buttons in the flow of the page rather than
// hover affordances, because this screen is used on a phone.
//
//   ASK ONCE, THEN DO IT, THEN OFFER IT BACK. The rules are `archiveStep`/`undoOffer` in
//   `lib/muse.ts` — the screen holds which target is being asked about and what was just
//   archived, and renders what those two return.
//
//   THE SCREEN COUNTS WHAT IS LEFT. Archived media stays on the record (captions and fragments
//   are keyed on its id and have to survive a restore), so the payload still carries it and this
//   screen filters it: the grid, the header count, the coverage line, the caption quote and the
//   decompose plan all read the LIVE media. The server recomputes each pass' stored coverage
//   over the same live set, so a header counting the whole array would contradict the fraction
//   printed beside it.
//
//   AN ARCHIVED SET IS NOT RE-READ FROM THE LIST. It has left `listDatasetsFull` by design, so
//   the archive's own response is put back into local state and the undo is offered from there.

export { categoryColor, curatedFragments };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

// noema-319 — the caption a tile shows is the ACTIVE captionset's, keyed by media id. Sparse by
// design (`DatasetCaptionset.captions` — see lib/api.ts): a captionset written before the field
// existed, or a media item this pass has not reached yet, carries no entry, which is a valid
// "nothing here yet" state rather than an error. Pure and standalone so the grid's read and the
// test below exercise the same rule.
export function captionFor(dataset: Pick<DatasetT, 'captionsets'>, activeSetId: string, mediaId: string): string | null {
  const set = dataset.captionsets.find((cs) => cs.id === activeSetId);
  return set?.captions?.[mediaId] ?? null;
}

export function Dataset() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [search, setSearchParams] = useSearchParams();
  const [datasets, setDatasets] = useState<DatasetT[] | null>(null);

  // The list read, callable again: a finished decompose writes fragments onto the record
  // server-side, so the chips arrive through a re-read rather than through the run's outputs.
  const loadDatasets = useCallback(async () => {
    const { datasets: ds } = await api.listDatasetsFull().catch(() => ({ datasets: [] as DatasetT[] }));
    setDatasets(ds);
  }, []);

  useEffect(() => {
    let live = true;
    api.listDatasetsFull()
      .then(({ datasets: ds }) => { if (live) setDatasets(ds); })
      .catch(() => { if (live) setDatasets([]); });
    return () => { live = false; };
  }, []);

  const d = (datasets ?? []).find((x) => x.id === id);
  const [activeSet, setActiveSet] = useState<string | null>(null);
  // Seed the active captionset from the loaded record the first time it resolves.
  useEffect(() => {
    if (d && activeSet === null) setActiveSet(d.captionsets[0]?.id ?? '');
  }, [d, activeSet]);

  // Which media items' fragment gardens are open (noema-283). Closed by default; per item,
  // keyed by media id — opening one does not open the rest.
  const [openGardens, setOpenGardens] = useState<Set<string>>(new Set());
  const toggleGarden = (itemId: string) => setOpenGardens((prev) => toggleGardenId(prev, itemId));

  // Decomposing the SELECTED captionset — the rung between a caption pass and the garden
  // above. The pass is metered (one chat call per caption) and it is WATCHED, not awaited:
  // the dispatch returns a run id at once and the pass continues server-side, so the screen
  // subscribes to the run and re-reads the dataset when it goes terminal, which is what fills
  // the chips. The rules — offered at all, which captionset, when armed — live in
  // `lib/training.ts`.
  //
  // The run id rides `?run=`, the same way the caption screen carries its pass (noema-321): a
  // pass that outlives its request must also survive leaving the screen, or a user who
  // navigates away loses a run that is still spending. A launch writes the param with
  // `replace` (Back must not step through run states) and a mount reads it back.
  const [decomposeRun, setDecomposeRun] = useState<string | null>(() => decomposeRunParam(search));
  const [decomposeMsg, setDecomposeMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [starting, setStarting] = useState(false);
  const mountRunChecked = useRef(false);

  const decomposeStream = useRunStream(decomposeRun ?? undefined);
  const decomposeTerminal = decomposeStream.terminal;
  // What the control and the notes below read as "a pass is running": a run is attached and it
  // has not gone terminal, or a dispatch is on the wire.
  const decomposing = starting || (decomposeRun !== null && decomposeTerminal === null);

  // A `?run=` carried in on mount gets ONE validating fetch. A run that is gone, or was never
  // this caller's (ownership is server-side), must clear rather than leave the screen showing a
  // pass that is not running — `useRunStream`'s poll fallback reads a persistent 404 as "still
  // pending", so the check belongs here. A run started from this screen is known good and is
  // never re-checked.
  useEffect(() => {
    if (mountRunChecked.current) return;
    mountRunChecked.current = true;
    const carried = decomposeRun;
    if (!carried) return;
    let live = true;
    api.getRun(carried).catch(() => {
      if (!live) return;
      setDecomposeRun(null);
      setSearchParams((prev) => withDecomposeRunParam(prev, null), { replace: true });
      setDecomposeMsg({ ok: false, text: 'that decompose is gone or not yours' });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The pass landing. Fragments are written onto the DATASET, so the result arrives through a
  // re-read of the record rather than through the run's own exitus.
  useEffect(() => {
    if (!decomposeRun || decomposeTerminal === null) return;
    if (decomposeTerminal === 'failed') {
      setDecomposeMsg({ ok: false, text: `decompose failed: ${decomposeStream.error ?? 'no reason reported'}` });
      return;
    }
    let live = true;
    void (async () => {
      await loadDatasets();
      if (!live) return;
      setDecomposeMsg({ ok: true, text: 'decompose finished — the chips below come from it' });
    })();
    return () => { live = false; };
  }, [decomposeRun, decomposeTerminal, decomposeStream.error, loadDatasets]);
  // noema-278 — the whole-set path, off by default. A decompose runs one model call per item,
  // and an item that already carries fragments has already been through the extractor, so the
  // default pass is the new work only. This is the explicit ask for everything, and the control
  // beside it says how many images that is before it is pressed.
  const [redoAll, setRedoAll] = useState(false);

  // The sessions broken off this dataset (noema-274). A count and a door, nothing more —
  // the history itself is a screen over, so this panel stays the quiet thing it was. The
  // read is a list; no run is fetched here and nothing is written, so it cannot move
  // which session the muse door resumes.
  const [museSessions, setMuseSessions] = useState<MuseSessionView[] | null>(null);
  useEffect(() => {
    if (!id) return;
    let live = true;
    api.listMuseSessions(id)
      .then(({ sessions }) => { if (live) setMuseSessions(sessions); })
      .catch(() => { if (live) setMuseSessions([]); });
    return () => { live = false; };
  }, [id]);

  // Adding images (noema-265). The append returns the whole dataset; putting THAT back into the
  // list is what re-reads the screen — nothing here patches a local copy.
  const [addOpen, setAddOpen] = useState(false);

  // Archiving (noema-267). `asking` is the control whose question is open; `done` is what was just
  // archived, which is what the undo is offered over. `now` only exists so the offer expires on
  // its own rather than sitting there until the next render.
  const [asking, setAsking] = useState<ArchiveTarget | null>(null);
  const [done, setDone] = useState<ArchiveDone | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [archiveErr, setArchiveErr] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!done) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [done]);

  // The archive call itself, once a press has been confirmed. Both routes return the WHOLE
  // dataset, so the response goes back into the list and the screen re-reads from it.
  async function runArchive(target: ArchiveTarget) {
    setArchiving(true);
    setArchiveErr(null);
    try {
      const updated = target.kind === 'dataset'
        ? await api.archiveDataset(target.datasetId)
        : await api.archiveDatasetMedia(target.datasetId, target.mediaId);
      setDatasets((ds) => replaceDataset(ds, updated));
      setDone({ target, at: Date.now() });
      setNow(Date.now());
    } catch (e) {
      setArchiveErr(errText(e));
    } finally {
      setArchiving(false);
    }
  }

  // One press on an archive control: the first asks, a second press on the SAME control does it.
  function pressArchive(target: ArchiveTarget) {
    const step = archiveStep(asking, target);
    if (step.ask) { setAsking(target); setArchiveErr(null); return; }
    setAsking(null);
    void runArchive(step.archive);
  }

  async function takeItBack(target: ArchiveTarget) {
    setArchiving(true);
    setArchiveErr(null);
    try {
      const updated = target.kind === 'dataset'
        ? await api.restoreDataset(target.datasetId)
        : await api.restoreDatasetMedia(target.datasetId, target.mediaId);
      setDatasets((ds) => replaceDataset(ds, updated));
      setDone(null);
    } catch (e) {
      setArchiveErr(errText(e));
    } finally {
      setArchiving(false);
    }
  }

  async function doDecompose(dataset: DatasetT, selectedId: string | null) {
    const captionsetId = decomposeCaptionsetId(dataset, selectedId);
    // With `redo` the workload is the whole pass, so the pending count is not what gates it.
    const pending = redoAll ? undefined : decomposeWorkload(dataset, captionsetId).pending;
    if (!canFireDecompose({ captionsetId, inFlight: decomposing, pending })) return;
    setStarting(true);
    setDecomposeMsg(null);
    try {
      const run = await launchDecomposeJob({ datasetId: dataset.id, captionsetId: captionsetId!, redo: redoAll });
      if (run.status === 'failed') {
        setDecomposeMsg({ ok: false, text: `decompose failed: ${run.failure?.message ?? 'no reason reported'}` });
        return;
      }
      // The dispatch is done, the pass is not: attach to the run and let the watch above
      // finish the story. The id goes into the URL in the same breath, so it is on the
      // record before anything can navigate away from it.
      setDecomposeRun(run.id);
      setSearchParams((prev) => withDecomposeRunParam(prev, run.id), { replace: true });
      setDecomposeMsg({ ok: true, text: `decompose started · run ${run.id.slice(0, 8)}` });
    } catch (e) {
      // A refusal because this dataset is ALREADY decomposing comes back through here, and
      // it is a status rather than a failure — `decomposeFailureNote` is what tells them
      // apart, so a second press reads as "one is running" instead of as an error.
      setDecomposeMsg({ ok: false, text: decomposeFailureNote(String((e as Error).message)) });
    } finally {
      setStarting(false);
    }
  }

  if (datasets === null) {
    return <AppShell title="Dataset"><div className="page"><div className="pw wide"><div className="sub mono">loading…</div></div></div></AppShell>;
  }
  if (!d) {
    return (
      <AppShell title="Dataset">
        <div className="page"><div className="pw wide">
          <div className="sub mono">dataset not found. <Link to="/datasets">back to datasets</Link></div>
        </div></div>
      </AppShell>
    );
  }
  const active = activeSet ?? (d.captionsets[0]?.id ?? '');
  const version = d.versions[d.versions.length - 1]?.v ?? '—';
  // The working set, and the record every readout below is derived from. Archived media is
  // still on `d` — it has to be, so a restore can bring its caption and its chips back — so
  // `working` is what the grid renders and what every count, quote and gate is taken over.
  const live = liveRecords(d.media);
  const working = { ...d, media: live };
  const archivedSet = isArchived(d);
  const undo = undoOffer(done, now);
  const nextCaptionsetId = decomposeCaptionsetId(working, active);
  const decomposeGate = decomposeGateReason(working, nextCaptionsetId);
  // What the next decompose would actually run, and the sentence that says it. Derived from
  // the dataset the server last returned — the same record the chips above are rendered from.
  const decomposeWork = decomposeWorkload(working, nextCaptionsetId);
  const decomposeArmed = canFireDecompose({
    captionsetId: nextCaptionsetId,
    inFlight: decomposing,
    ...(redoAll ? {} : { pending: decomposeWork.pending }),
  }) && !decomposeGate;

  // What an appended image still needs, in the order it needs it: what the chosen pass covers
  // now, what a pass over the set would cover and cost, and the decompose that stays refused
  // until it has run. Every figure is derived from the dataset the server last returned.
  const afterAppend = (
    <div className="muse-add-next">
      <div className="muse-add-readout mono">{captionCoverageLine(working, nextCaptionsetId)}</div>
      <div className="muse-add-step">
        <Link className="btn ghost sm" to={`/datasets/${d.id}/caption`}>{captionPassLabel(working)}</Link>
        <span className="gt-sub mono">{captionPassNote(working)}</span>
      </div>
      {decomposeGate && <div className="gt-sub mono">{decomposeGate}</div>}
    </div>
  );

  const crumb = (
    <span className="ph-crumb"><Link to="/datasets">datasets</Link> <span className="sep">/</span> <b>{d.name}</b></span>
  );

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead ds-detail-head">
          <div>
            <h1 className="ds-d-name">{d.name} <span className="ds-badge" style={{ color: 'var(--m-image)' }}><span className="dot" style={{ background: 'var(--m-image)' }} /> {d.modality}</span></h1>
            {/* The count is the LIVE media — archiving two of nine and still reading nine would
                contradict the coverage line beside it, which the server has already moved. */}
            <div className="sub mono">{live.length} {d.modality === 'video' ? 'clips' : 'images'} · {version} · {d.captionsets.length} captionsets · updated {d.mutatum}</div>
          </div>
          {/* Archiving the SET, with the set's own identity — not buried in a menu. It asks
              once, says what archive means, and offers the set back after. */}
          <div className="right ds-archive">
            {archivedSet ? (
              <button className="btn ghost sm" type="button" disabled={archiving}
                onClick={() => void takeItBack({ kind: 'dataset', datasetId: d.id })}>
                {archiving ? 'working…' : 'take this set back'}
              </button>
            ) : (
              <>
                <button className="btn ghost sm" type="button" disabled={archiving}
                  onClick={() => pressArchive({ kind: 'dataset', datasetId: d.id })}>
                  {isSameTarget(asking, { kind: 'dataset', datasetId: d.id }) ? 'archive this set? press again' : 'archive this set'}
                </button>
                {isSameTarget(asking, { kind: 'dataset', datasetId: d.id }) && (
                  <button className="btn ghost sm" type="button" onClick={() => setAsking(null)}>keep it</button>
                )}
              </>
            )}
            <div className="sub ds-archive-note">{ARCHIVE_MEANING}</div>
            {archivedSet && <div className="sub mono">this set is archived — it is out of your datasets until you take it back.</div>}
            {archiveErr && <div className="sub mono">that did not go through: {archiveErr}</div>}
          </div>
        </div>

        {/* The offer to take back whatever was just archived, for as long as it stands. */}
        {undo && (
          <div className="ds-undo">
            <span className="sub mono">{undo.line}</span>
            <button className="btn ghost sm" type="button" disabled={archiving}
              onClick={() => void takeItBack(undo.target)}>{undo.label}</button>
          </div>
        )}

        <div className="ds-detail">
          {/* the media — king */}
          <div className="ds-images">
            <div className="ds-imgs-head"><span className="mono ds-showing">showing {d.captionsets.find((cs) => cs.id === active)?.name ?? '—'} · {version}</span>
            </div>
            {live.length === 0 ? (
              <p className="ds-panel-note">no media in this dataset yet.</p>
            ) : (
              <div className="ds-imgrid">
                {live.map((m) => {
                  const fragments = m.fragments ?? [];
                  return (
                    <figure key={m.id} className="ds-img">
                      <span className="ds-img-tile" style={{ backgroundImage: `url(${m.url})`, backgroundSize: 'cover' }} />
                      <figcaption className="mono">{m.source === 'upload' ? 'uploaded' : 'from a generation'}</figcaption>
                      {/* noema-319 — the active captionset's caption, read-only here. Editing
                          stays on the caption screen; this is just so a caption is visible at
                          all without leaving the grid. */}
                      <p className="ds-img-caption mono">{captionFor(working, active, m.id) ?? 'no caption yet'}</p>
                      {/* Removing ONE image, against the grid it leaves. Asks once; the second
                          press does it and the undo appears above. */}
                      <div className="ds-img-actions">
                        <button className="btn ghost sm" type="button" disabled={archiving}
                          onClick={() => pressArchive({ kind: 'media', datasetId: d.id, mediaId: m.id })}>
                          {isSameTarget(asking, { kind: 'media', datasetId: d.id, mediaId: m.id }) ? 'remove it? press again' : 'remove'}
                        </button>
                        {isSameTarget(asking, { kind: 'media', datasetId: d.id, mediaId: m.id }) && (
                          <button className="btn ghost sm" type="button" onClick={() => setAsking(null)}>keep it</button>
                        )}
                      </div>
                      {fragments.length > 0 && (
                        <>
                          {/* Opening the garden only reveals the chips below — read-only display,
                              not a curation control (noema-323). */}
                          <button
                            type="button"
                            className="ds-garden-toggle"
                            onClick={() => toggleGarden(m.id)}
                          >
                            {gardenSummaryLine(fragments.length, 0)} {isGardenOpen(openGardens, m.id) ? '▾' : '▸'}
                          </button>
                          {isGardenOpen(openGardens, m.id) && (
                            <div className="pref-chips ds-garden">
                              {fragments.map((f, i) => {
                                const color = categoryColor(f.category);
                                return (
                                  // A label, not a control (noema-323) — `<span>`, no onClick, no
                                  // checked/unchecked state. `.fchip` is a SHARED class
                                  // (styles/app.css, also used by `.fund-actions`) that carries
                                  // `cursor:pointer`; that file stays untouched, so the
                                  // non-clickable cursor is set here instead.
                                  <span
                                    key={`${f.category}-${i}`}
                                    className="fchip"
                                    style={{ cursor: 'default' }}
                                    title={`${f.category} · ${f.source}`}
                                  >
                                    <span style={{ background: color, width: 8, height: 8, borderRadius: 2, display: 'inline-block', marginRight: 6 }} />
                                    {f.text}
                                  </span>
                                );
                              })}
                            </div>
                          )}
                        </>
                      )}
                    </figure>
                  );
                })}
              </div>
            )}

            {/* noema-323 — the chips above are read-only; this is the pointer to where curation
                actually happens, shown only once there is something to curate. */}
            {live.some((m) => (m.fragments ?? []).length > 0) && (
              <div className="sub mono ds-muse-pointer">
                <Link to={`/datasets/${d.id}/muse`}>curate in muse →</Link>
              </div>
            )}

            {/* Growing the set (noema-265) — against the grid it grows, and the append's response
                is what the screen re-renders from. */}
            <AddImages
              dataset={working}
              open={addOpen}
              onOpenChange={setAddOpen}
              onAppended={(updated) => setDatasets((ds) => replaceDataset(ds, updated))}
              next={afterAppend}
              title="add images to this dataset"
            />
          </div>

          {/* the panels */}
          <aside className="ds-side">
            <div className="ds-panel">
              <div className="ds-panel-l">captionsets · {d.captionsets.length} · pick to train</div>
              {d.captionsets.length === 0 ? (
                <p className="ds-panel-note">no captionset yet — a model learns from a caption layer. Run a caption job to make one.</p>
              ) : d.captionsets.map((cs) => (
                <button key={cs.id} className={`capset${active === cs.id ? ' on' : ''}`} onClick={() => setActiveSet(cs.id)}>
                  <span className={`radio${active === cs.id ? ' on' : ''}`} />
                  <span className="cs-main"><span className="nm">{cs.name}</span><span className="cs-sub mono"><span className={`hemi2 ${custodyGlyph(d.custody)}`} /> {cs.method} · {cs.coverage}</span></span>
                </button>
              ))}
              <div className="capset-actions">
                {/* ONE door. The two controls that stood here pointed at the same route under two
                    labels, and the distinction they implied is not real: a caption pass extends
                    the selected pass, and a second captionset is worth having only when a
                    different captioner will produce it. The caption screen carries the opt-out
                    for the fresh-set case, so it stays reachable deliberately rather than as a
                    second identical button. The selected pass rides the link, so the screen
                    opens on the one that was picked here. */}
                <Link className="btn ghost sm"
                  to={active ? `/datasets/${d.id}/caption?captionset=${encodeURIComponent(active)}` : `/datasets/${d.id}/caption`}>
                  {active ? 'caption the uncaptioned →' : 'run a caption job'}
                </Link>
                {/* noema-319 — a door to LOOK, separate from the door that launches a pass. The
                    caption-pass link above reads as billed work; this one just opens the same
                    screen's view/edit surface on the set already selected here. */}
                {active && (
                  <Link className="btn ghost sm mono"
                    to={`/datasets/${d.id}/caption?captionset=${encodeURIComponent(active)}`}>
                    view / edit captions
                  </Link>
                )}
                {canOfferDecompose(working) && (
                  <button className="btn ghost sm" type="button"
                    disabled={!decomposeArmed}
                    onClick={() => void doDecompose(working, active)}>
                    {decomposing ? 'decomposing…' : redoAll ? 're-decompose all →' : 'decompose →'}
                  </button>
                )}
              </div>
              {canOfferDecompose(working) && (
                <>
                  <p className="ds-panel-note">{decomposePlanNote(decomposeWork, redoAll)}</p>
                  <label className="ds-panel-note">
                    <input type="checkbox" checked={redoAll} disabled={decomposing}
                      onChange={(e) => setRedoAll(e.currentTarget.checked)} />
                    {' '}re-decompose images that already have chips
                  </label>
                </>
              )}
              <p className="ds-panel-note">{captionCoverageLine(working, nextCaptionsetId)}</p>
              {decomposeGate && <p className="ds-panel-note">{decomposeGate}</p>}
              {decomposing && (
                <p className="ds-panel-note">
                  a decompose is running on this dataset — one pass per caption, and it keeps
                  going on our side whether or not this page is open. Only one runs at a time.
                  {decomposeRun && ` run ${decomposeRun.slice(0, 8)} · ${decomposeStream.elapsedSec}s elapsed`}
                </p>
              )}
              {decomposeMsg && <p className="ds-panel-note">{decomposeMsg.text}</p>}
            </div>

            <div className="ds-panel">
              <div className="ds-panel-l">versions</div>
              {d.versions.map((v) => (
                <div key={v.v} className={`verrow${v.v === version ? ' on' : ''}`}>
                  <span className="dot" /> <b>{v.v}</b> · {v.count} {d.modality === 'video' ? 'clips' : 'images'}<span className="when mono">{v.when}</span>
                </div>
              ))}
            </div>

            {/* The door is always open — with no captionset yet it opens onto the caption job,
                which is how a dataset gets one. Training without a caption layer is the thing
                this path exists to replace, so it is a redirect, not a dead button. */}
            <button className="btn accent block ds-train"
              onClick={() => navigate(d.captionsets.length === 0 ? `/datasets/${d.id}/caption` : `/datasets/${d.id}/derive`)}>
              {d.captionsets.length === 0 ? 'Caption it, then train →' : 'Train a model from this →'}
            </button>
            <Link className="btn ghost block" to={`/datasets/${d.id}/muse`}>muse →</Link>
            {/* Beside the door, not behind it: how many sessions this dataset has, and the
                way to the ones that are not the current work. */}
            {sessionCountLine(museSessions ?? []) && (
              <div className="ds-muse-history">
                <span className="ds-panel-note">{sessionCountLine(museSessions ?? [])}</span>
                <Link className="ds-muse-history-link" to={sessionHistoryHref(d.id)}>past sessions →</Link>
              </div>
            )}
            {d.captionsets.length === 0 && <div className="ds-panel-note" style={{ textAlign: 'center' }}>a model learns from the caption layer — make one first</div>}
          </aside>
        </div>
      </div></div>
    </AppShell>
  );
}
