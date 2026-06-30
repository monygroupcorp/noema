import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useIdentity } from '../state/identity';
import { Ic } from '../lib/icons';

// Account / settings (account-spec.md, renders noema-account.png + noema-account-compute.png).
// The control panel for the privacy machine — posture + sovereignty up front, then a card per
// account concern, each opening a sub-nav detail page. Two corrections baked in:
//  · the account compute default is AVAILABILITY (cost/speed: Economy/Balanced/Fastest), never
//    a custody default — custody (local/TEE/remote) is a per-run choice in the console.
//  · NOEMA is multi-interface (web · Telegram · API) — the posture names this "reach".

const SECTIONS = [
  { key: 'account', label: 'Account', ico: 'circle-user' },
  { key: 'billing', label: 'Billing & credits', ico: 'wallet' },
  { key: 'compute', label: 'Compute', ico: 'server' },
  { key: 'api', label: 'API keys', ico: 'key-round' },
  { key: 'security', label: 'Security & privacy', ico: 'eye-off' },
];

type Availability = 'economy' | 'balanced' | 'fastest';
const AVAIL: { key: Availability; glyph: string; t: string; s: string }[] = [
  { key: 'economy', glyph: '◔', t: 'Economy', s: 'Wait for spot / cheaper GPUs. Lowest credits.' },
  { key: 'balanced', glyph: '◑', t: 'Balanced', s: 'Wait briefly for a cheaper slot, then proceed.' },
  { key: 'fastest', glyph: '●', t: 'Fastest', s: 'Always grab the fastest available. Higher credits.' },
];

export function AccountSettings() {
  const { section } = useParams();
  const { ident } = useIdentity();
  const anon = ident.funding === 'bearer';
  const credits = ident.bal.match(/(\d[\d,]*)\s*credits?/)?.[1] ?? '4,820';

  // ── account home ──────────────────────────────────────────────────────────
  if (!section) {
    return (
      <AppShell title="Settings">
        <div className="page"><div className="pw wide">
          <div className="pagehead"><div>
            <h1>Account</h1>
            <div className="sub">Your account across every interface — web · Telegram · API. Tune what we see; your work stays yours.</div>
          </div></div>

          {/* posture instrument — the dashboard device, reused */}
          <div className="noema-frame ac-posture">
            <div className="ac-pcell">
              <div className="ac-l">identity</div>
              <div className="ac-v"><span className={`hemi2 ${anon ? 'dashed' : 'lit'}`} /> {anon ? 'anonymous' : 'you · signed in'} <Link className="ac-link" to="/account/security">go anonymous ▸</Link></div>
            </div>
            <div className="ac-pcell">
              <div className="ac-l">live · what we can see</div>
              <div className="ac-v">the meter · 2 sealed sessions</div>
            </div>
            <div className="ac-pcell">
              <div className="ac-l">reach</div>
              <div className="ac-v">web · Telegram · API</div>
            </div>
          </div>

          {/* sovereignty trio — a right, shown up front */}
          <div className="ac-sov">
            <button className="btn ghost"><Ic name="arrow-up" /> Export everything</button>
            <button className="btn ghost amber"><span className="hemi2 dashed" /> Go anonymous</button>
            <button className="btn ghost bad"><Ic name="x" /> Delete account &amp; data</button>
          </div>

          {/* section cards */}
          <div className="ac-cards">
            <SectionCard to="/account/billing" ico="wallet" name="Billing &amp; credits">
              <Row k="plan" v={<b>Subscription · $20/mo</b>} />
              <Row k="credits" v={<span className="gold"><span className="gem">◈</span> {credits} · resets 12d</span>} />
              <Row k="payment" v={<><b>card</b> · ···· 4242</>} />
              <div className="ac-note mono"><span className="hemi2 dashed" /> anonymous purse (Bursa): <span className="gold">◈ 1,200</span> · bearer · fund from a shielded wallet</div>
            </SectionCard>
            <SectionCard to="/account/api" ico="key-round" name="API keys">
              <Row k="sk-noema-···· a3f9" v={<><b>active</b> · 84k calls</>} />
              <Row k="sk-noema-···· 0c12" v={<span className="muted">revoked</span>} />
              <div className="ac-note mono">OpenAI-compatible endpoint · <span className="accent">+ new key</span></div>
            </SectionCard>
            <SectionCard to="/account/compute" ico="server" name="Compute &amp; sessions">
              <Row k="availability" v={<><span className="fillg">◑</span> <b>balanced</b> · wait briefly for cheaper</>} />
              <Row k="sealed sessions" v={<><span className="rdot good" /> 2 live</>} />
              <Row k="local runner" v={<><b>RTX 4090</b> · connected</>} />
              <div className="ac-note mono">custody (local · TEE · remote) is chosen per run, not here.</div>
            </SectionCard>
            <SectionCard to="/account/security" ico="eye-off" name="Security &amp; privacy">
              <Row k="devices" v={<><b>2</b> active</>} />
              <Row k="conditional anonymity" v={<span className="accent">learn the rule ▸</span>} />
            </SectionCard>
          </div>

          {/* preferences pointer */}
          <div className="ac-prefptr">
            <Ic name="sparkles" /> Generation defaults for <span className="mono">/make · /effect · …</span> — portable across web · Telegram · API — live in your <Link to="/preferences">preferences profile ▸</Link>
          </div>
        </div></div>
      </AppShell>
    );
  }

  // ── detail page (sub-nav + pane) ──────────────────────────────────────────
  const active = SECTIONS.find((s) => s.key === section) ?? SECTIONS[0];
  const crumb = <span className="ph-crumb"><Link to="/account">Settings</Link> <span className="sep">/</span> <b>{active.label}</b></span>;
  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="settings-layout">
          <aside className="settings-nav">
            <div className="sn-l">settings</div>
            {SECTIONS.map((s) => (
              <Link key={s.key} to={`/account/${s.key}`} className={`sn-item${s.key === section ? ' on' : ''}`}>
                <Ic name={s.ico} /> {s.label}
              </Link>
            ))}
          </aside>
          <div className="settings-pane">
            {section === 'compute' ? <ComputeDetail /> : (
              <>
                <h1>{active.label}</h1>
                <div className="sub">This section opens here from the account home’s <b>manage ▸</b>.</div>
                <div className="empty" style={{ marginTop: 'var(--s5)' }}><div className="t">{active.label} detail — building this pane in a later pass.</div></div>
              </>
            )}
          </div>
        </div>
      </div></div>
    </AppShell>
  );
}

function ComputeDetail() {
  const [avail, setAvail] = useState<Availability>(() => (localStorage.getItem('noema-availability') as Availability) || 'balanced');
  const set = (a: Availability) => { setAvail(a); localStorage.setItem('noema-availability', a); };
  return (
    <>
      <h1>Compute</h1>
      <div className="sub">Your cost-vs-speed preference, your sealed sessions, and your own machine.</div>

      <div className="ac-panel">
        <div className="ac-panel-l">availability · cost vs speed for remote runs</div>
        <div className="avail-grid">
          {AVAIL.map((a) => (
            <button key={a.key} className={`availcard${avail === a.key ? ' on' : ''}`} onClick={() => set(a.key)}>
              <div className="av-t"><span className="fillg">{a.glyph}</span> {a.t}</div>
              <div className="av-s">{a.s}</div>
            </button>
          ))}
        </div>
        <div className="ac-note mono">↳ custody (local · TEE · remote) is a per-run choice in the console — not a default set here.</div>
      </div>

      <div className="ac-panel">
        <div className="ac-panel-l">active sessions · sealed enclaves</div>
        <SessionRow name="Frostfire drake · training" detail="SEV-SNP · WireGuard tunnel up · 2.1 it/s" state="~6m left" />
        <SessionRow name="Canvas · Drake composite" detail="idle enclave · holds 12m then tears down" state="idle" />
      </div>

      <div className="ac-panel">
        <div className="ac-panel-l">local runner · your machine</div>
        <div className="ac-runner">
          <span className="rdot good" />
          <div className="ac-runner-main"><b>workstation · RTX 4090</b><span className="mono">connected · runs local workflows off-grid</span></div>
          <span className="ac-runner-status mono">off-grid</span>
        </div>
      </div>
    </>
  );
}

function SessionRow({ name, detail, state }: { name: string; detail: string; state: string }) {
  return (
    <div className="ac-session">
      <span className="hemi2 ring" />
      <div className="ac-sess-main"><b>{name}</b><span className="mono">{detail}</span></div>
      <span className="ac-sess-state"><span className="rdot good" /> {state}</span>
      <button className="btn ghost danger sm">■ stop</button>
    </div>
  );
}

function SectionCard({ to, ico, name, children }: { to: string; ico: string; name: string; children: React.ReactNode }) {
  return (
    <div className="ac-card">
      <div className="ac-card-h"><span className="ac-card-ico"><Ic name={ico} /></span><b dangerouslySetInnerHTML={{ __html: name }} /><Link className="ac-manage" to={to}>manage ▸</Link></div>
      <div className="ac-card-body">{children}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="ac-row"><span className="ac-rk mono">{k}</span><span className="ac-rv">{v}</span></div>;
}
