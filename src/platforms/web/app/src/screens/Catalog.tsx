import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { type FlowSummary } from '../lib/api';
import { flowSummaries } from '../lib/flows';
import { isPinned, togglePin, usePins } from '../lib/pins';

// Only the fields the live /v1/flows payload actually carries. License / size / run-locality
// are NOT in FlowSummary, so we don't show them at all rather than invent them (P0-4,
// compliance-sensitive: license especially must never be fabricated).
// `verb` is the canon-verb axis (make/effect/animate/... , noema-054's resolver via
// `modusGenus`) — parallel to `media` (the categoria/modality axis), not a replacement.
interface UIFlow { id: string; name: string; media: string; version: string; verb: string }

// Modality swatch colour — the same five tokens the canvas ports use, promoted
// to shared --m-* tokens in noema-theme.css (one palette, two surfaces).
const MOD_TOKEN: Record<string, string> = {
  text: 'var(--m-text)', image: 'var(--m-image)', video: 'var(--m-video)', audio: 'var(--m-audio)', '3d': 'var(--m-3d)',
};

// The modality facet. 'All' is the no-filter value, the same value the task chips use.
export const MODALITIES: { key: string; label: string }[] = [
  { key: 'All', label: 'Any modality' },
  { key: 'image', label: 'Image' },
  { key: 'video', label: 'Video' },
  { key: '3d', label: '3D' },
  { key: 'audio', label: 'Audio' },
  { key: 'text', label: 'Text' },
];

export type SortKey = 'popular' | 'name';
export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'popular', label: 'Popular' },
  { key: 'name', label: 'Name' },
];

// "FLUX Schnell — text to image" → "FLUX Schnell"
// Exported (rather than kept module-private) so the filter logic below can be exercised by
// a plain vitest unit test — this app has no jsdom/@testing-library/react (see
// BuyCreditsModal.test.ts), so screen tests exercise exported pure logic and static markup.
export function toUI(f: FlowSummary): UIFlow {
  const nomen = (typeof f.nomen === 'string' && f.nomen) || f.id;
  const name = nomen.split('—')[0].trim();
  const media = (typeof f.categoria === 'string' && f.categoria) || 'other';
  return {
    id: f.id,
    name,
    media,
    version: (typeof f.versio === 'string' && f.versio) || '',
    verb: (typeof f.modusGenus === 'string' && f.modusGenus) || 'other',
  };
}

// The distinct canon verbs present in the fetched flow list, sorted — no hardcoded
// allowlist, so a new verb noema-054's resolver starts emitting shows up automatically.
export function distinctVerbs(flows: UIFlow[]): string[] {
  return Array.from(new Set(flows.map((f) => f.verb))).sort();
}

// One filtering model (DESIGN.md D-56): text search, the task chips, and the modality facet
// all narrow the same list, and 'All' clears a facet.
export function applyFilters(flows: UIFlow[], query: string, mediaFilter: string, verbFilter: string): UIFlow[] {
  const ql = query.trim().toLowerCase();
  return flows.filter(
    (f) =>
      (!ql || (f.name + ' ' + f.id + ' ' + f.media).toLowerCase().includes(ql)) &&
      (mediaFilter === 'All' || f.media === mediaFilter) &&
      (verbFilter === 'All' || f.verb === verbFilter)
  );
}

// 'popular' is the order the registry serves the list in; 'name' is alphabetical.
export function sortFlows(flows: UIFlow[], sort: SortKey): UIFlow[] {
  if (sort !== 'name') return flows;
  return [...flows].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export interface CatalogFiltersProps {
  verbs: string[];
  verb: string; onVerb: (v: string) => void;
  media: string; onMedia: (m: string) => void;
  sort: SortKey; onSort: (s: SortKey) => void;
  shown: number; total: number;
}

// The one control row that narrows the list (DESIGN.md D-31): the task chips — the axis that
// tells FLUX Schnell (make) from FLUX i2i (effect) when both are "image" — with the modality
// facet and the sort beside them as labelled selects whose current value is visible without
// opening them (D-56), and the result count where it can always be seen (REFERENCES.md
// REF-17). Chips are the fast path on a phone: one tap narrows 41 models to a task.
export function CatalogFilters({ verbs, verb, onVerb, media, onMedia, sort, onSort, shown, total }: CatalogFiltersProps) {
  return (
    <div className="cat-toolbar cat-narrow" role="group" aria-label="Narrow the list">
      <div className="cat-filters" role="group" aria-label="Task">
        <button type="button" className={`cat-chip${verb === 'All' ? ' on' : ''}`} aria-pressed={verb === 'All'} onClick={() => onVerb('All')}>
          All
        </button>
        {verbs.map((v) => (
          <button type="button" key={v} className={`cat-chip${verb === v ? ' on' : ''}`} aria-pressed={verb === v} onClick={() => onVerb(v)}>
            {v}
          </button>
        ))}
      </div>
      <div className="cat-controls">
        <label className="cat-select cat-select-mod">
          <span>modality</span>
          <select value={media} onChange={(e) => onMedia(e.target.value)}>
            {MODALITIES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
        <label className="cat-select cat-select-sort">
          <span>sort</span>
          <select value={sort} onChange={(e) => onSort(e.target.value as SortKey)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </label>
        <span className="cat-count mono" aria-live="polite">
          {shown === total ? `${total.toLocaleString()} models` : `${shown.toLocaleString()} of ${total.toLocaleString()} models`}
        </span>
      </div>
    </div>
  );
}

export function Catalog() {
  const [flows, setFlows] = useState<UIFlow[] | null>(null);
  const [err, setErr] = useState(false);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('All');
  const [verbFilter, setVerbFilter] = useState('All');
  const [sort, setSort] = useState<SortKey>('popular');
  // Subscribe so the list re-renders whenever any pin is toggled anywhere in the app
  // (this row's own star, Card.tsx's pin button, or another tab).
  usePins();

  useEffect(() => {
    let live = true;
    flowSummaries()
      .then((list) => { if (live) setFlows(list.map(toUI)); })
      .catch(() => { if (live) { setErr(true); setFlows([]); } });
    return () => { live = false; };
  }, []);

  const verbs = useMemo(() => distinctVerbs(flows || []), [flows]);

  const shown = useMemo(
    () => sortFlows(applyFilters(flows || [], q, filter, verbFilter), sort),
    [flows, q, filter, verbFilter, sort],
  );

  const models = flows?.length ?? 0;
  const narrowed = q.trim() !== '' || filter !== 'All' || verbFilter !== 'All';
  const clear = () => { setQ(''); setFilter('All'); setVerbFilter('All'); };

  return (
    <AppShell crumb="Catalogue">
      <div className="page"><div className="pw wide">
        <div className="registry">

          <div className="corpus">
            <h1 className="corpus-big">
              {flows === null
                ? <span style={{ color: 'var(--faint)' }}>loading the corpus…</span>
                : <>
                    <span className="n">{models.toLocaleString()}</span> open models — yours to run.
                  </>}
            </h1>
            <div className="corpus-meta">
              {err
                ? 'couldn’t reach the live catalog — the staging cluster may be unreachable from here'
                : 'every weight open-source · run remote or local · nothing proprietary, nothing locked'}
            </div>
          </div>

          <div className="cat-toolbar">
            <div className="cat-search">
              <Ic name="search" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${models.toLocaleString()} models — name, task, architecture…`} />
            </div>
          </div>

          {flows !== null && (
            <CatalogFilters
              verbs={verbs}
              verb={verbFilter} onVerb={setVerbFilter}
              media={filter} onMedia={setFilter}
              sort={sort} onSort={setSort}
              shown={shown.length} total={models}
            />
          )}

          <div className="reg-bar">
            <span className="c-name">Model</span>
            <span className="c-mod">Modality</span>
            <span className="c-ver">Version</span>
          </div>

          {shown.map((f) => {
            const pinned = isPinned(f.id);
            return (
              <Link key={f.id} className="reg-row" to={`/card?id=${encodeURIComponent(f.id)}`}>
                <div className="reg-name">
                  <span className="nm">{f.name}</span>
                  <span className="id">{f.id}</span>
                </div>
                <div className="reg-mod">
                  <span className="mg" style={{ background: MOD_TOKEN[f.media] || 'var(--muted)' }} />
                  {f.media}
                </div>
                <div className="reg-ver mono">{f.version || '—'}</div>
                <button
                  className={`pin${pinned ? ' on' : ''}`}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin({ id: f.id, name: f.name }); }}
                  title={pinned ? 'Unpin from rail' : 'Pin to rail'}
                  aria-pressed={pinned}
                >
                  <Ic name="star" />
                </button>
              </Link>
            );
          })}

          {flows === null && <div className="empty"><div className="t">Loading the registry…</div></div>}
          {flows && !err && shown.length === 0 && (
            <div className="empty">
              <div className="t">No models match.</div>
              {narrowed && <button type="button" className="btn ghost" onClick={clear}>Show all {models.toLocaleString()}</button>}
            </div>
          )}

        </div>
      </div></div>
    </AppShell>
  );
}
