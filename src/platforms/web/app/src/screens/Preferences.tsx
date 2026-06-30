import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';

// Preferences profile (preferences-spec.md, render noema-preferences.png) — your portable
// generation defaults, per slash command, that travel across web · Telegram · API. The hero
// command-preview is the signature device (same .noema-frame as the dashboard/run monitor):
// it answers "what does my command do, everywhere?". Custody stays a per-run choice (not here).

interface Chip { k: string; v: string; accent?: boolean }
interface Command { cmd: string; kind: string; chips: Chip[]; preview: string; addable?: boolean }

const COMMANDS: Command[] = [
  { cmd: '/make', kind: 'image', preview: '/make a frost knight → flux.1 dev · 1024² · ✦frostknight · 4',
    chips: [{ k: 'model', v: 'Flux.1 dev' }, { k: 'size', v: '1024²' }, { k: 'cfg', v: '4' }, { k: '✦', v: 'frostknight', accent: true }] },
  { cmd: '/animate', kind: 'video', preview: '/animate drift over ice → LTX · 5s · 24fps', addable: true,
    chips: [{ k: 'model', v: 'LTX' }, { k: 'len', v: '5s' }, { k: 'fps', v: '24' }] },
  { cmd: '/effect', kind: 'edit', preview: '/effect make it dusk → Canny 0.7 · holds pose',
    chips: [{ k: 'control', v: 'Canny' }, { k: 'strength', v: '0.7' }, { k: 'model', v: 'Flux.1 dev' }] },
  { cmd: '/upscale', kind: 'enhance', preview: '/upscale → 4× · UltraSharp · face-restore',
    chips: [{ k: 'factor', v: '4×' }, { k: 'model', v: 'UltraSharp' }, { k: 'face', v: 'on' }] },
];

export function Preferences() {
  const [autoApply, setAutoApply] = useState(true);
  const crumb = <span className="ph-crumb"><Link to="/app">you</Link> <span className="sep">/</span> <b>Preferences</b></span>;
  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pref-tabs">
          <Link to="/app" className="pref-tab">Overview</Link>
          <span className="pref-tab on">Preferences</span>
        </div>

        <p className="pref-sub">Your defaults for every generation — configure each command once; they travel with you across <b>web · Telegram · API</b>.</p>
        <div className="pref-honesty mono"><span className="hemi2 dashed" /> custody stays a per-run choice · these are defaults, override inline anytime</div>

        {/* hero command-preview — the signature */}
        <div className="noema-frame pref-hero">
          <div className="pref-hero-l noema-kicker">how it resolves — anywhere you type it</div>
          <div className="pref-cmd"><span className="accent">/make</span> a frost knight in a snowstorm</div>
          <div className="pref-chips">
            <Chips chips={[{ k: 'model', v: 'Flux.1 dev' }, { k: 'size', v: '1024²' }, { k: 'steps', v: '30' }, { k: 'cfg', v: '4' }, { k: 'your model', v: '✦ frostknight', accent: true }, { k: 'count', v: '4' }]} />
          </div>
        </div>

        {/* command cards */}
        <div className="pref-l noema-kicker">commands</div>
        <div className="pref-grid">
          {COMMANDS.map((c) => (
            <div key={c.cmd} className="pref-card">
              <div className="pref-card-h"><span className="accent mono">{c.cmd}</span><span className="pref-kind">{c.kind}</span><button className="lnk">edit ▸</button></div>
              <div className="pref-chips">
                <Chips chips={c.chips} />
                {c.addable && <button className="chip-add">+ add</button>}
              </div>
              <div className="pref-preview"><span className="pp-l mono">preview</span><span className="pp-v mono">{c.preview}</span></div>
            </div>
          ))}
        </div>

        {/* cross-cutting */}
        <div className="pref-l noema-kicker">across all commands</div>
        <div className="pref-grid">
          <div className="pref-card">
            <div className="pref-card-h"><Ic name="sparkles" /><b>Style &amp; your models</b><button className="lnk">edit ▸</button></div>
            <div className="ac-row"><span className="ac-rk mono">default style</span><span className="ac-rv">cinematic · cold <button className="lnk">change ▸</button></span></div>
            <div className="ac-row"><span className="ac-rk mono">negative prompt</span><span className="ac-rv">blurry, text, watermark</span></div>
            <div className="ac-row"><span className="ac-rk mono">auto-apply ✦ frostknight</span><button className={`toggle${autoApply ? ' on' : ''}`} onClick={() => setAutoApply((v) => !v)}><span /></button></div>
          </div>
          <div className="pref-card">
            <div className="pref-card-h"><Ic name="send" /><b>Output &amp; delivery</b><button className="lnk">edit ▸</button></div>
            <div className="ac-row"><span className="ac-rk mono">format</span><span className="ac-rv">PNG · max quality <button className="lnk">change ▸</button></span></div>
            <div className="ac-row"><span className="ac-rk mono">land in</span><span className="ac-rv">current project <button className="lnk">change ▸</button></span></div>
            <div className="ac-row"><span className="ac-rk mono">telegram: deliver as</span><span className="ac-rv">album <button className="lnk">change ▸</button></span></div>
          </div>
        </div>
      </div></div>
    </AppShell>
  );
}

function Chips({ chips }: { chips: Chip[] }) {
  return <>{chips.map((c, i) => (
    <span key={i} className={`pchip${c.accent ? ' accent' : ''}`}><span className="ck">{c.k}</span> <b>{c.v}</b></span>
  ))}</>;
}
