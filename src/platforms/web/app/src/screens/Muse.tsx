import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { api, type Dataset as DatasetT, type FlowSummary } from '../lib/api';
import {
  buildGarden,
  canFire,
  categoryColor,
  flattenGarden,
  gardenCounts,
  ignitionBlockReason,
  ignitionRequest,
  poolDatasetFragments,
  rollCurated,
  t2iFlows,
  type IgnitionQuote,
  type RollReport,
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
  const [fired, setFired] = useState<Record<number, { runId?: string; error?: string }>>({});

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

  async function doFire(index: number, prompt: string) {
    if (!modusId) return;
    if (!canFire(quotes[index] ?? null, modusId, prompt, blockReason)) return;
    setBusy(index);
    try {
      const { run } = await api.createRun(ignitionRequest(modusId, prompt));
      setFired((prev) => ({ ...prev, [index]: { runId: run.id } }));
    } catch (e) {
      setFired((prev) => ({ ...prev, [index]: { error: e instanceof Error ? e.message : String(e) } }));
    } finally {
      setBusy(null);
    }
  }

  // The dataset-wide garden. Pools every media item's fragments (not one item's — that is
  // Dataset.tsx's job) and builds it in one pass. Recomputed only when the dataset's media
  // actually changes, not on every curation toggle.
  const build = useMemo(() => (d ? buildGarden(poolDatasetFragments(d.media)) : null), [d]);
  const counts = useMemo(() => (build ? gardenCounts(build.garden) : []), [build]);
  const flat = useMemo(() => (build ? flattenGarden(build.garden) : []), [build]);

  function roll() {
    if (flat.length === 0) return;
    setReport(rollCurated(flat, excluded, count));
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
            <div className="s">
              Muse rolls prompts from decomposed captions — this dataset has none yet. Caption it, then
              decompose those captions to grow the garden.
            </div>
            <Link className="btn accent" to={`/datasets/${d.id}`}>← back to {d.name}</Link>
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
            <span className="gn-count mono">{flat.length} fragments · {flat.length - excluded.size} in play across {counts.filter((c) => c.count > 0).length} categories</span>
          </div>
        </div>

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
              <button className="btn accent" disabled={flat.length - excluded.size === 0} onClick={roll}>
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
                              onClick={() => doFire(r.index, prompt)}
                            >
                              Generate →
                            </button>
                          </>
                        );
                      })()}
                      {fired[r.index]?.runId && (
                        <Link className="mono" to={`/run?id=${fired[r.index]!.runId}`}>open run view →</Link>
                      )}
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
      </div></div>
    </AppShell>
  );
}
