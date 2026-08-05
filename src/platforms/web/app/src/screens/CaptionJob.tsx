import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { api, type Dataset } from '../lib/api';

// Caption job (train-caption-job-spec.md, render noema-train-caption-job.png) — captioning is
// a compute offering you fire and watch fill: a grid captions itself live under an honest seam,
// and you review each caption IN PLACE as it lands (drafts ~, confirm to ✓). Custody (the
// hemisphere) governs THIS job — the captioner reads your images, so where it runs is honest.
// Shares the canonic-run grammar (count hero · progress · done/running/pending cells).
//
// The dataset itself is real (`GET /v1/data/datasets/full`); noema-079 didn't ship a captioning
// backend, so the run/review grid below stays a presentational simulation (unchanged) — only the
// dataset lookup, custody hemisphere, and tile imagery now come from the caller's real record.

const TILE_FALLBACK = ['#2b3a5e', '#324063', '#2f5d56', '#33406b'];
type Cell = { caption: string; state: 'reviewed' | 'draft' | 'running' | 'pending' };
const BASE_CAPS = [
  'full plate armor, snow field, front view', 'helmet off, blue cloak, three-quarter left',
  'raising a glowing frost sword, profile, snow falling', 'from behind, cape detail, mountains',
  'seated by a campfire at dusk', 'frosted visor closeup, ice crystals',
  'running through a snowstorm, motion', 'kneeling, oath, banner behind',
  'shield raised, blizzard', 'on a frozen ridge, dawn', 'sparring stance, courtyard', 'portrait, calm',
];

export function CaptionJob() {
  const { id } = useParams();
  const [datasets, setDatasets] = useState<Dataset[] | null>(null);
  useEffect(() => {
    let live = true;
    api.listDatasetsFull().then(({ datasets: ds }) => { if (live) setDatasets(ds); }).catch(() => { if (live) setDatasets([]); });
    return () => { live = false; };
  }, []);
  const d = (datasets ?? []).find((x) => x.id === id);
  const trigger = 'frostknight';
  const [cells, setCells] = useState<Cell[]>(() =>
    BASE_CAPS.map((c, i): Cell => ({ caption: c, state: i < 6 ? 'reviewed' : i < 10 ? 'draft' : i === 10 ? 'running' : 'pending' })));
  const [editing, setEditing] = useState<number | null>(2);
  const done = cells.filter((c) => c.state === 'reviewed' || c.state === 'draft').length;
  const drafts = cells.filter((c) => c.state === 'draft').length;
  const reviewed = cells.filter((c) => c.state === 'reviewed').length;

  const confirm = (i: number) => setCells((cs) => cs.map((c, j) => (j === i ? { ...c, state: 'reviewed' } : c)));

  if (datasets === null) {
    return <AppShell title="Caption job"><div className="page"><div className="pw wide"><div className="sub mono">loading…</div></div></div></AppShell>;
  }
  if (!d) {
    return (
      <AppShell title="Caption job">
        <div className="page"><div className="pw wide"><div className="sub mono">dataset not found. <Link to="/datasets">back to datasets</Link></div></div></div>
      </AppShell>
    );
  }
  const tiles = d.media.length > 0 ? d.media.map((m) => m.url) : TILE_FALLBACK;
  const hasMedia = d.media.length > 0;

  const crumb = <span className="ph-crumb"><Link to="/datasets">datasets</Link> <span className="sep">/</span> <Link to={`/datasets/${d.id}`}>{d.name}</Link> <span className="sep">/</span> <b>new captionset</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div><h1>Captioning · natural language · v3</h1></div>
        </div>

        {/* setup bar (docked) */}
        <div className="cj-setup">
          <span className="cj-seg"><span className="cj-l">method</span> <b>Natural language</b> · Florence-2</span>
          <span className="cj-seg"><span className="cj-l">trigger</span> <b className="accent">{trigger}</b></span>
          <span className="cj-seg"><span className="cj-l">length</span> <b>medium</b></span>
          <span className="cj-seg"><span className="cj-l">runs in</span> <span className="hemi2 lit" /> <b>our compute</b></span>
          <button className="lnk cj-adjust">adjust setup ▸</button>
        </div>

        {/* run panel */}
        <div className="cj-run">
          <div className="cj-count"><b>{done}</b> / {cells.length} captioned</div>
          <div className="cj-bar"><span style={{ width: `${(done / cells.length) * 100}%` }} /></div>
          <div className="cj-flight mono">1 in flight · ~5s left</div>
        </div>

        {/* honesty seam */}
        <div className="cj-seam mono"><span className="hemi2 lit" /> captioning on our compute — we can see the work.</div>

        {/* grid: run + review in one */}
        <div className="cj-grid">
          {cells.map((c, i) => (
            <figure key={i} className={`cj-cell ${c.state}${editing === i ? ' editing' : ''}`}>
              <span className="cj-tile" style={hasMedia ? { backgroundImage: `url(${tiles[i % tiles.length]})`, backgroundSize: 'cover' } : { background: tiles[i % tiles.length] }} />
              {c.state !== 'pending' && c.state !== 'running' && (
                <button className={`cj-pip ${c.state}`} onClick={() => confirm(i)} title={c.state === 'reviewed' ? 'reviewed' : 'confirm draft'}>{c.state === 'reviewed' ? '✓' : '~'}</button>
              )}
              <figcaption className="mono" onClick={() => c.state !== 'running' && c.state !== 'pending' && setEditing(i)}>
                {c.state === 'running' ? <span className="cj-running">captioning…</span>
                  : c.state === 'pending' ? <span className="cj-pending">pending</span>
                  : <><span className="accent">{trigger}</span>, {c.caption}{editing === i && <span className="cj-cursor" />}</>}
                {editing === i && <span className="cj-edithint">↵ accept · esc cancel</span>}
              </figcaption>
            </figure>
          ))}
        </div>

        {/* footer */}
        <div className="cj-foot">
          <div className="cj-tally mono">{reviewed} reviewed, {drafts} drafts to confirm · click any caption to edit</div>
          <div className="cj-actions">
            <button className="btn ghost">↻ re-caption selected</button>
            <Link className="btn accent" to={`/datasets/${d.id}`}>Save captionset</Link>
          </div>
        </div>
      </div></div>
    </AppShell>
  );
}
