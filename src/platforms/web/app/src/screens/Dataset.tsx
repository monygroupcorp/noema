import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { DATASETS, custodyGlyph, CUSTODY_LABEL, type Custody } from '../lib/datasets';

// Dataset detail (train-dataset-spec.md, render noema-train-dataset.png) — the core asset:
// media (king) + versions + captionsets, with a media-custody dial. Captionsets are a separate
// versioned layer (the lesson); you pick one when you derive a training. Custody is the
// hemisphere everywhere data is read.
const CUSTODY_OPTS: { c: Custody; label: string }[] = [
  { c: 'local', label: 'Local' }, { c: 'sealed', label: 'TEE' }, { c: 'remote', label: 'Remote' },
];
// representative captions per tile (placeholder for real per-item captions)
const CAPS = ['frostknight, full plate, snow field, front', 'frostknight, helmet off, blue cloak, 3/4 L',
  'frostknight, raising frost sword, profile', 'frostknight, seated, campfire, dusk',
  'frostknight, frosted visor closeup, ice', 'frostknight, running, snowstorm, motion'];

export function Dataset() {
  const { id } = useParams();
  const navigate = useNavigate();
  const d = DATASETS.find((x) => x.id === id) ?? DATASETS[0];
  const [custody, setCustody] = useState<Custody>(d.custody);
  const [activeSet, setActiveSet] = useState(d.captionsets[0]?.id ?? '');
  const tiles = Array.from({ length: Math.min(d.count, 9) }, (_, i) => d.tiles[i % d.tiles.length]);

  const crumb = (
    <span className="ph-crumb"><Link to="/datasets">datasets</Link> <span className="sep">/</span> <b>{d.name}</b></span>
  );

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead ds-detail-head">
          <div>
            <div className="noema-kicker" style={{ marginBottom: 8 }}>dataset · the core asset</div>
            <h1 className="ds-d-name">{d.name} <span className="ds-badge" style={{ color: 'var(--m-image)' }}><span className="dot" style={{ background: 'var(--m-image)' }} /> {d.modality}</span></h1>
            <div className="sub mono">{d.count} {d.modality === 'video' ? 'clips' : 'images'} · {d.version} · {d.captionsets.length} captionsets · updated {d.updated}</div>
          </div>
        </div>

        <div className="ds-detail">
          {/* the media — king */}
          <div className="ds-images">
            <div className="ds-imgs-head"><span className="noema-kicker">the images · what noema learns from</span>
              <span className="mono ds-showing">showing {d.captionsets.find((c) => c.id === activeSet)?.name ?? '—'} · {d.version}</span>
            </div>
            <div className="ds-imgrid">
              {tiles.map((t, i) => (
                <figure key={i} className="ds-img">
                  <span className="ds-img-tile" style={{ background: t }} />
                  <figcaption className="mono">{CAPS[i % CAPS.length]}</figcaption>
                </figure>
              ))}
            </div>
          </div>

          {/* the panels */}
          <aside className="ds-side">
            <div className="ds-panel">
              <div className="ds-panel-l">media custody · what we see</div>
              <div className="seg custody-seg">
                {CUSTODY_OPTS.map((o) => (
                  <button key={o.c} className={custody === o.c ? 'on' : ''} onClick={() => setCustody(o.c)}>
                    <span className={`hemi2 ${custodyGlyph(o.c)}`} /> {o.label}
                  </button>
                ))}
              </div>
              <p className="ds-panel-note">{custody === 'sealed' ? 'sealed — your images live in your enclave; we hold them, we can’t read them.'
                : custody === 'local' ? 'local — the media never leaves your machine.' : 'remote — we host the media on our compute.'}</p>
            </div>

            <div className="ds-panel">
              <div className="ds-panel-l">captionsets · {d.captionsets.length} · pick to train</div>
              {d.captionsets.length === 0 ? (
                <p className="ds-panel-note">no captionset yet — a model learns from a caption layer. Run a caption job to make one.</p>
              ) : d.captionsets.map((c) => (
                <button key={c.id} className={`capset${activeSet === c.id ? ' on' : ''}`} onClick={() => setActiveSet(c.id)}>
                  <span className={`radio${activeSet === c.id ? ' on' : ''}`} />
                  <span className="cs-main"><span className="nm">{c.name}</span><span className="cs-sub mono"><span className={`hemi2 ${custodyGlyph(c.custody)}`} /> {c.method} · {c.coverage}</span></span>
                </button>
              ))}
              <div className="capset-actions"><Link className="lnk" to={`/datasets/${d.id}/caption`}>+ new captionset</Link> · <Link className="lnk" to={`/datasets/${d.id}/caption`}>run a caption job</Link></div>
            </div>

            <div className="ds-panel">
              <div className="ds-panel-l">versions</div>
              {d.versions.map((v) => (
                <div key={v.v} className={`verrow${v.v === d.version ? ' on' : ''}`}>
                  <span className="dot" /> <b>{v.v}</b> · {v.count} {d.modality === 'video' ? 'clips' : 'images'}<span className="when mono">{v.when}</span>
                </div>
              ))}
            </div>

            <button className="btn accent block ds-train" disabled={d.captionsets.length === 0}
              onClick={() => navigate(`/datasets/${d.id}/derive`)}>Train a model from this →</button>
            {d.captionsets.length === 0 && <div className="ds-panel-note" style={{ textAlign: 'center' }}>caption it first</div>}
          </aside>
        </div>
      </div></div>
    </AppShell>
  );
}
