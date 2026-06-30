import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { COLLECTIONS } from '../lib/collections';

// Trait rules (editio-rules-spec.md, render noema-editio-rules.png) — exclusions & cohesion as
// readable sentences: broad MOTIF rules (one rule covers every trait in the motif) + TRAIT
// exceptions (a specific trait beats the motif rule). AI suggests; the human applies. Feasibility
// is enforced — if valid combos fall below supply, the run is hard-blocked here.
export function TraitRules() {
  const { id } = useParams();
  const c = COLLECTIONS.find((x) => x.id === id) ?? COLLECTIONS[0];
  const [view, setView] = useState<'list' | 'grid'>('list');
  const crumb = <span className="ph-crumb"><Link to={`/collections/${id}`}>{c.name}</Link> <span className="sep">/</span> <b>rules</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div><h1>Trait rules</h1><div className="sub mono">broad motif rules · trait exceptions</div></div>
          <div className="right"><span className="badge ok">feasible ✓</span></div>
        </div>

        <div className="tr-toolbar">
          <div className="seg tr-view">
            <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>≡ List</button>
            <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>▦ Grid · motif×motif</button>
          </div>
          <button className="btn">+ add rule</button>
        </div>

        {view === 'list' ? (
          <>
            <div className="rl-sec"><span className="noema-kicker">motif rules · broad strokes</span><span className="rl-hint mono">one rule covers every trait in the motif</span></div>
            <div className="rl-row"><span className="rl-op exclude">✕</span><span className="motif frost">Frost <span className="m-n">6 traits</span></span> <span className="rl-verb">excludes</span> <span className="motif ember">Ember <span className="m-n">5 traits</span></span><span className="rl-cost mono">−312 combos</span></div>
            <div className="rl-row"><span className="rl-op cohesion">⇄</span><span className="motif arcane">Arcane <span className="m-n">4 traits</span></span> <span className="rl-verb">prefers its own motif</span> <span className="rl-tag">cohesion</span><span className="rl-cost mono">weights ↑</span></div>

            <div className="rl-sec"><span className="noema-kicker">trait exceptions · overrides</span><span className="rl-hint mono">a specific trait beats the motif rule above</span></div>
            <div className="rl-row"><span className="rl-op allow">✓</span><b>Frostfire crown</b> <span className="rl-verb">allowed with</span> <span className="motif ember">Ember</span> <span className="rl-tag">intentional clash</span><span className="rl-cost mono good">+18</span></div>
            <div className="rl-row"><span className="rl-op exclude">✕</span><b>Wizard hat</b> <span className="rl-verb">excludes</span> <b>Cathedral cape</b> <span className="rl-tag">prompts clash</span><span className="rl-cost mono">−84</span></div>

            <div className="rl-ai">
              <div className="rl-ai-l noema-kicker">✦ noema noticed</div>
              <p>Three <b>Ember</b> traits have no rule against <span className="motif frost sm">Frost</span> backgrounds — and they scored low together in your tests. Extend <b>Frost excludes Ember</b> to cover them?</p>
              <div className="rl-ai-actions"><button className="btn accent sm">Extend rule</button><button className="btn ghost sm">Dismiss</button></div>
            </div>
          </>
        ) : (
          <div className="empty"><div className="t">motif × motif grid — the pairwise matrix collapsed to motifs.</div></div>
        )}

        <div className="rl-foot">
          <span className="mono"><span className="good">✓ 1,802 valid</span> / 1,944 supply</span>
          <div className="rl-feas"><span className="cj-bar"><span style={{ width: '93%' }} /></span></div>
          <span className="rl-legend mono"><span className="rl-dot exclude" /> exclude <span className="rl-dot require" /> require</span>
        </div>
        <div className="garden-foot">
          <Link className="btn ghost" to={`/collections/${id}/garden`}>← garden</Link>
          <Link className="btn accent" to={`/collections/${id}/run`}>Next · canonic run →</Link>
        </div>
      </div></div>
    </AppShell>
  );
}
