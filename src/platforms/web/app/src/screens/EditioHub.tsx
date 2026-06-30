import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { COLLECTIONS, STATUS_LABEL, type CollStatus } from '../lib/collections';
import { GARDEN, combinations } from '../lib/editioTraits';

// Collection hub — one collection's home (the editio spine: garden → rules → run → curation →
// export). The hub surface itself wasn't critted, so this is a clean on-brand frame: status +
// collaborators + the flow as steps. Local-first; the hemisphere stays dashed until export.
const statusGlyph: Record<CollStatus, string> = { draft: 'dashed', locked: 'dashed', minted: 'lit' };

export function EditioHub() {
  const { id } = useParams();
  const c = COLLECTIONS.find((x) => x.id === id) ?? COLLECTIONS[0];
  const combos = combinations(GARDEN.categories);
  const minted = c.status === 'minted';

  const STEPS = [
    { n: 1, to: `/collections/${c.id}/garden`, ico: 'sparkles', t: 'Traits garden', s: `${GARDEN.categories.length} categories · ${combos.toLocaleString()} combinations` },
    { n: 2, to: `/collections/${c.id}/rules`, ico: 'workflow', t: 'Trait rules', s: 'exclusions & cohesion' },
    { n: 3, to: `/collections/${c.id}/run`, ico: 'box', t: 'Canonic run', s: `fire the modus · ${c.target.toLocaleString()} pieces` },
    { n: 4, to: `/collections/${c.id}/curation`, ico: 'check', t: 'Curation', s: 'approve into supply' },
    { n: 5, to: `/collections/${c.id}/export`, ico: 'send', t: 'Export & publish', s: 'download · hosting · noesis' },
  ];

  const crumb = <span className="ph-crumb"><Link to="/collections">collections</Link> <span className="sep">/</span> <b>{c.name}</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="ph-head">
          <div>
            <div className="ph-kick noema-kicker">collection · <span className={`hemi2 ${statusGlyph[c.status]}`} /> {STATUS_LABEL[c.status]}</div>
            <h1 className="ph-name">{c.name}</h1>
            <p className="ph-desc">{c.theme} · {c.supply.toLocaleString()} / {c.target.toLocaleString()} pieces · {c.traits} traits</p>
          </div>
          <div className="ph-people">
            <span className="ph-avatars"><span className="av" style={{ background: c.tile }} /><span className="av" /></span>
            <button className="btn"><Ic name="circle-user" /> share ▸</button>
          </div>
        </div>

        <div className="ed-flow">
          {STEPS.map((s, i) => (
            <Link key={s.n} className={`ed-step${minted && s.n < 5 ? ' done' : ''}`} to={s.to}>
              <span className="ed-step-n mono">{s.n}</span>
              <span className="ed-step-ico"><Ic name={s.ico} /></span>
              <span className="ed-step-main"><b>{s.t}</b><span className="ed-step-s mono">{s.s}</span></span>
              {i < STEPS.length - 1 && <span className="ed-step-arrow">→</span>}
            </Link>
          ))}
        </div>

        <div className="ph-band">
          <div className="ph-about">
            <div className="ph-l">about this collection</div>
            <p>A collection is a <b>hub</b> — pure, persistent, multiplayer. Generation + curation are <b>local and reversible</b>; only export/mint crosses to public &amp; permanent. That asymmetry is the spine.</p>
            <div className="ph-meta mono">theme {c.theme} · {c.rarityDelta} of rarity target · local until you publish</div>
          </div>
          <div className="ph-activity">
            <div className="ph-l">activity</div>
            <div className="ph-ev"><span className="av" style={{ background: c.tile }} /><span className="ev-t"><b>you</b> ran the canonic supply <span className="mono ev-meta"><span className="hemi2 dashed" /> local · 2h</span></span></div>
          </div>
        </div>
      </div></div>
    </AppShell>
  );
}
