import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { GARDEN, combinations, VALUE_LABEL } from '../lib/editioTraits';

// Traits garden (editio-garden-spec.md, render noema-editio-garden-tester.png §1) — define the
// axes. Categories on the left; the selected category's traits as cards. Each card shows the
// PUBLIC FACE (title + rarity) and, below the dashed line, the MECHANISM — the typed value that
// feeds the modus (prompt / image·ref / number·cfg). The header keeps the combination count
// live as the nudge (combinations grow quadratically).
export function TraitsGarden() {
  const { id } = useParams();
  const cats = GARDEN.categories;
  const [active, setActive] = useState(cats[2].id);
  const cat = cats.find((c) => c.id === active) ?? cats[0];
  const combos = combinations(cats);

  const crumb = <span className="ph-crumb"><Link to="/collections">collections</Link> <span className="sep">/</span> <Link to={`/collections/${id}`}>{GARDEN.collection}</Link> <span className="sep">/</span> <b>traits</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="garden-head">
          <div><div className="noema-kicker" style={{ marginBottom: 6 }}>traits · the garden</div>
            <h1>{GARDEN.collection}</h1></div>
          <div className="garden-nudge">
            <span className="gn-count mono">{cats.length} categories · <b className="accent">{combos.toLocaleString()}</b> combinations</span>
            <span className="gn-ai"><span className="hemi2 lit" /> Add an Eyewear category to double your space →</span>
          </div>
        </div>

        <div className="garden">
          {/* categories */}
          <aside className="garden-cats">
            <div className="gc-l">categories <button className="gc-add">+</button></div>
            {cats.map((c) => (
              <button key={c.id} className={`gc-item${active === c.id ? ' on' : ''}`} onClick={() => setActive(c.id)}>
                <span className="gc-dot" style={{ background: c.color }} /> {c.name}<span className="gc-n mono">{c.traits.length}</span>
              </button>
            ))}
            <button className="gc-new">+ new category</button>
          </aside>

          {/* trait cards */}
          <div className="garden-traits">
            <div className="gt-head">
              <span className="gt-title">{cat.name} <span className="gt-badge">shows on nft</span></span>
              <button className="btn ghost sm"><Ic name="wand-sparkles" /> generate variants</button>
            </div>
            <div className="gt-sub mono">{cat.traits.length} traits · the value is a prompt fragment the modus splices in</div>
            <div className="gt-grid">
              {cat.traits.map((t) => (
                <div key={t.id} className="traitcard">
                  <div className="tc-preview" style={{ background: t.kind === 'number' ? 'var(--panel)' : t.tint }}>
                    {t.kind === 'number' ? <span className="tc-num">{t.value}</span> : <span className="tc-chip" style={{ background: t.tint }} />}
                  </div>
                  <div className="tc-title"><b>{t.title}</b><span className="tc-rarity mono">{t.rarity != null ? `${t.rarity}%` : '—'}</span></div>
                  <div className="tc-feeds">
                    <span className="tc-feeds-l mono">feeds modus</span> <span className={`tc-kind ${t.kind}`}>{VALUE_LABEL[t.kind]}</span>
                  </div>
                  <div className="tc-value mono">{t.value}</div>
                </div>
              ))}
              <button className="traitcard add"><Ic name="plus" /><span>add trait / generate</span></button>
            </div>
          </div>
        </div>

        <div className="garden-foot">
          <Link className="btn ghost" to={`/collections/${id}`}>← hub</Link>
          <Link className="btn accent" to={`/collections/${id}/rules`}>Next · trait rules →</Link>
        </div>
      </div></div>
    </AppShell>
  );
}
