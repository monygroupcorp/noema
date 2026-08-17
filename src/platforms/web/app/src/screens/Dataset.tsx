import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { custodyGlyph } from '../lib/datasets';
import { api, type Dataset as DatasetT, type Fragment, type FragmentCategory } from '../lib/api';

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
// rendered as an empty garden, never as an error. Curation (check/uncheck a chip) is local UI
// state only: it decides which fragments a future garden-build would draw from, it does not write
// anything back. No LLM call and no credit rail are touched by any of this.

/** Fixed, deterministic per-category color so a category reads the same everywhere it appears —
 *  not a hash, so the palette stays legible (no two adjacent categories landing on similar hues). */
const CATEGORY_COLOR: Record<FragmentCategory, string> = {
  subject: '#5b8cff', hair: '#8a7cff', outfit: '#c26bd9', pose: '#e0668f', expression: '#e08a55', props: '#c9a13a',
  setting: '#3fae7a', style: '#39a6a0', palette: '#3f8fbf', lighting: '#e0c34a', mood: '#7a8fae',
};

export function categoryColor(category: FragmentCategory): string {
  return CATEGORY_COLOR[category] ?? 'var(--muted)';
}

/** The fragment subset a garden build would actually draw from: everything except the chips the
 *  operator has unchecked (indexed into `fragments` — stable within one loaded snapshot). Pulled
 *  out as its own function so the exclusion is provably load-bearing rather than a cosmetic toggle
 *  (noema-221 non-vacuity: reverting this to a no-op must fail the "excludes unchecked chips" test). */
export function curatedFragments(fragments: Fragment[], excluded: ReadonlySet<number>): Fragment[] {
  return fragments.filter((_, i) => !excluded.has(i));
}

export function Dataset() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [datasets, setDatasets] = useState<DatasetT[] | null>(null);

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

  // Which chips are unchecked, per media item id. Local curation state only — see the file
  // header note; nothing here is persisted or fed to a decompose call.
  const [excludedByItem, setExcludedByItem] = useState<Record<string, Set<number>>>({});
  const toggleFragment = (itemId: string, fragIndex: number) => {
    setExcludedByItem((prev) => {
      const next = new Set(prev[itemId] ?? []);
      if (next.has(fragIndex)) next.delete(fragIndex); else next.add(fragIndex);
      return { ...prev, [itemId]: next };
    });
  };

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

  const crumb = (
    <span className="ph-crumb"><Link to="/datasets">datasets</Link> <span className="sep">/</span> <b>{d.name}</b></span>
  );

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead ds-detail-head">
          <div>
            <h1 className="ds-d-name">{d.name} <span className="ds-badge" style={{ color: 'var(--m-image)' }}><span className="dot" style={{ background: 'var(--m-image)' }} /> {d.modality}</span></h1>
            <div className="sub mono">{d.media.length} {d.modality === 'video' ? 'clips' : 'images'} · {version} · {d.captionsets.length} captionsets · updated {d.mutatum}</div>
          </div>
        </div>

        <div className="ds-detail">
          {/* the media — king */}
          <div className="ds-images">
            <div className="ds-imgs-head"><span className="mono ds-showing">showing {d.captionsets.find((cs) => cs.id === active)?.name ?? '—'} · {version}</span>
            </div>
            {d.media.length === 0 ? (
              <p className="ds-panel-note">no media in this dataset yet.</p>
            ) : (
              <div className="ds-imgrid">
                {d.media.map((m) => {
                  const fragments = m.fragments ?? [];
                  const excluded = excludedByItem[m.id] ?? new Set<number>();
                  return (
                    <figure key={m.id} className="ds-img">
                      <span className="ds-img-tile" style={{ backgroundImage: `url(${m.url})`, backgroundSize: 'cover' }} />
                      <figcaption className="mono">{m.source === 'upload' ? 'uploaded' : 'from a generation'}</figcaption>
                      {fragments.length > 0 && (
                        <div className="pref-chips ds-garden">
                          {fragments.map((f, i) => {
                            const on = !excluded.has(i);
                            const color = categoryColor(f.category);
                            return (
                              <button
                                key={`${f.category}-${i}`}
                                type="button"
                                className={`fchip${on ? ' on' : ''}`}
                                title={`${f.category} · ${f.source}`}
                                onClick={() => toggleFragment(m.id, i)}
                              >
                                <span style={{ background: color, width: 8, height: 8, borderRadius: 2, display: 'inline-block', marginRight: 6 }} />
                                {f.text}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </figure>
                  );
                })}
              </div>
            )}
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
              <div className="capset-actions"><Link className="lnk" to={`/datasets/${d.id}/caption`}>+ new captionset</Link> · <Link className="lnk" to={`/datasets/${d.id}/caption`}>run a caption job</Link></div>
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
            {d.captionsets.length === 0 && <div className="ds-panel-note" style={{ textAlign: 'center' }}>a model learns from the caption layer — make one first</div>}
          </aside>
        </div>
      </div></div>
    </AppShell>
  );
}
