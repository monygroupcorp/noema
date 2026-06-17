import { useState, type CSSProperties } from 'react';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';

const SWATCHES = ['#5b8cff', '#8b76d6', '#57c8a6', '#d68f6f', '#d66f9a', '#d6c46f'];
const LOOKS = ['Clean', 'N64 / low-poly', 'Vapor', 'Editorial'];

export function Profile() {
  const [accent, setAccent] = useState('#5b8cff');
  const [look, setLook] = useState('Clean');

  // live-preview the accent across this page's subtree (reverts on leaving the screen)
  const pageStyle = { ['--accent' as keyof CSSProperties]: accent } as CSSProperties;

  return (
    <AppShell crumb="profile">
      <div className="page" style={pageStyle}><div className="pw">
        <div className="pagehead"><div>
          <h1>Profile · skins</h1>
          <div className="sub">Decorate freely — your skin is how this identity looks. The system voice stays reserved underneath.</div>
        </div></div>

        <div className="sectionhead">Assets</div>
        <div className="sub" style={{ marginBottom: 'var(--s4)' }}>Bring your own, or generate them.</div>
        <div className="assetslot" onClick={() => {}}>Banner — drop an image or paste a URL</div>
        <div style={{ display: 'flex', gap: 'var(--s4)', marginTop: 'var(--s4)', alignItems: 'flex-end' }}>
          <div className="assetslot pfp">PFP</div>
          <div className="assetslot" style={{ flex: 1 }}>Background</div>
        </div>

        <div className="sectionhead">Accent</div>
        <div className="swatches">
          {SWATCHES.map((c) => (
            <span key={c} className={`sw${accent === c ? ' on' : ''}`} style={{ background: c }} onClick={() => setAccent(c)} />
          ))}
        </div>
        <div className="sub" style={{ marginTop: 'var(--s3)' }}>One signal color — used sparingly.</div>

        <div className="sectionhead">Signature look</div>
        <div className="filters">
          {LOOKS.map((l) => (
            <button key={l} className={`fchip${look === l ? ' on' : ''}`} onClick={() => setLook(l)}>{l}</button>
          ))}
        </div>
        <div className="sub" style={{ marginTop: 'var(--s3)' }}>Heritage: we turn images into video-game-like images.</div>

        <div className="sectionhead">Generate a kit</div>
        <div className="sidecard">
          <div style={{ display: 'flex', gap: 'var(--s3)' }}>
            <input className="inp" placeholder="Describe the vibe…" />
            <button className="btn"><Ic name="sparkles" /> Generate kit</button>
          </div>
          <div className="mono" style={{ color: 'var(--faint)', fontSize: 'var(--fs-xs)', marginTop: 'var(--s3)' }}>
            runs a flow · ≈ $0.08 · skin assets become creations
          </div>
        </div>
      </div></div>
    </AppShell>
  );
}
