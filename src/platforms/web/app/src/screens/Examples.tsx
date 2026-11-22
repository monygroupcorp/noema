import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import {
  SHOWCASE_EXAMPLES,
  FEATURE_LABEL,
  distinctStyles,
  applyExampleFilters,
  launchTarget,
  isFired,
  type ShowcaseExample,
  type ExampleFeature,
  type ExampleKind,
} from '../lib/exampleGallery';
import './feed.css';

const FEATURES: (ExampleFeature | 'All')[] = ['All', 'make', 'muse', 'collections', 'model'];
const KINDS: (ExampleKind | 'All')[] = ['All', 'image', 'video'];

function Media({ example }: { example: ShowcaseExample }) {
  if (!isFired(example)) {
    return (
      <div className="empty" style={{ height: '100%' }}>
        <div className="t">Not generated yet</div>
        <div className="s">This row is real and launchable — its preview lands once it's fired.</div>
      </div>
    );
  }
  if (example.kind === 'video') {
    return <video src={example.mediaUrl} poster={example.thumbUrl} muted loop playsInline preload="metadata" />;
  }
  return <img src={example.thumbUrl ?? example.mediaUrl} alt={example.title} loading="lazy" />;
}

function ExampleTile({ example }: { example: ShowcaseExample }) {
  return (
    <div className="feed-tile">
      <div className="ft-media"><Media example={example} /></div>
      <div className="ft-foot" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
        <span className="t" style={{ fontWeight: 600 }}>{example.title}</span>
        <span className="s" style={{ color: 'var(--muted)', fontSize: 13 }}>{example.blurb}</span>
        <span className="s" style={{ color: 'var(--faint)', fontSize: 12 }}>
          {FEATURE_LABEL[example.feature]} · {example.kind}{example.style.length ? ` · ${example.style.join(', ')}` : ''}
        </span>
        <Link className="btn" to={launchTarget(example)}>
          <Ic name="arrow-right" /> Launch this
        </Link>
      </div>
    </div>
  );
}

// Facet chips — the same "one filtering model" Catalog.tsx's CatalogFilters establishes
// (DESIGN.md D-56): every axis narrows the same list, and 'All' clears it.
function FacetRow<T extends string>({ label, options, value, onChange, display }: {
  label: string;
  options: T[];
  value: T;
  onChange: (v: T) => void;
  display?: (v: T) => string;
}) {
  return (
    <div className="cat-filters" role="group" aria-label={label}>
      {options.map((opt) => (
        <button
          type="button"
          key={opt}
          className={`cat-chip${value === opt ? ' on' : ''}`}
          aria-pressed={value === opt}
          onClick={() => onChange(opt)}
        >
          {display ? display(opt) : opt}
        </button>
      ))}
    </div>
  );
}

export function Examples() {
  const [feature, setFeature] = useState<ExampleFeature | 'All'>('All');
  const [kind, setKind] = useState<ExampleKind | 'All'>('All');
  const [style, setStyle] = useState<string | 'All'>('All');

  const styles = useMemo(() => ['All', ...distinctStyles(SHOWCASE_EXAMPLES)] as (string | 'All')[], []);
  const shown = useMemo(
    () => applyExampleFilters(SHOWCASE_EXAMPLES, feature, kind, style),
    [feature, kind, style],
  );

  return (
    <AppShell title="Examples">
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div>
            <h1>Examples</h1>
            <div className="sub">
              A small set made on noema — not scraped, not stock. Pick one close to what you want
              and launch it straight into a run you can change before firing.
            </div>
          </div>
        </div>

        <div className="cat-toolbar cat-narrow" role="group" aria-label="Narrow the examples">
          <FacetRow label="What it is" options={FEATURES} value={feature} onChange={setFeature}
            display={(v) => (v === 'All' ? 'All' : FEATURE_LABEL[v as ExampleFeature])} />
          <FacetRow label="Kind" options={KINDS} value={kind} onChange={setKind} />
          <FacetRow label="Style" options={styles} value={style} onChange={setStyle} />
        </div>

        {shown.length === 0 ? (
          <div className="empty">
            <div className="t">No example matches that combination</div>
            <div className="s">Clear a facet above to see more.</div>
          </div>
        ) : (
          <div className="feed-grid">
            {shown.map((example) => <ExampleTile key={example.id} example={example} />)}
          </div>
        )}
      </div></div>
    </AppShell>
  );
}
