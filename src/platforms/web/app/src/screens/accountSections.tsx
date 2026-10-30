import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { StudioEntry } from '../lib/api';

// The account's settings sections — one list, read by the account home (its cards), the
// settings sub-nav (its entries), and the /account/:section router. Every section is a link
// (REF-34); a section another screen owns carries `to` and the route redirects there, so no
// section ever renders as a stub (D-63).
//
// The settings nav uses the left rail's nouns (D-69): the saved-logins switcher is "Keyring"
// here because the rail calls it that. Personal API keys are not a feature yet, so they are
// absent from the interface rather than listed with a "coming soon" pane.
export type Section = { key: string; label: string; ico: string; to?: string };

export const SECTIONS: Section[] = [
  { key: 'account', label: 'Account', ico: 'circle-user', to: '/account' },
  { key: 'billing', label: 'Billing & credits', ico: 'wallet', to: '/funding' },
  { key: 'compute', label: 'Compute', ico: 'server' },
  { key: 'preferences', label: 'Preferences', ico: 'sparkles', to: '/preferences' },
  { key: 'keyring', label: 'Keyring', ico: 'key-round', to: '/keyring' },
];

export type SectionRoute =
  | { kind: 'home' }
  | { kind: 'redirect'; to: string }
  | { kind: 'pane'; section: Section };

// Where /account/:section lands. A key nobody lists goes back to the account home rather than
// silently rendering some other section under the wrong address.
export function resolveSection(key: string | undefined): SectionRoute {
  if (!key) return { kind: 'home' };
  const section = SECTIONS.find((s) => s.key === key);
  if (!section) return { kind: 'redirect', to: '/account' };
  if (section.to) return { kind: 'redirect', to: section.to };
  return { kind: 'pane', section };
}

export type Availability = 'economy' | 'balanced' | 'fastest';
export const AVAIL: { key: Availability; glyph: string; t: string; s: string }[] = [
  { key: 'economy', glyph: '◔', t: 'Economy', s: 'Wait for spot / cheaper GPUs. Lowest credits.' },
  { key: 'balanced', glyph: '◑', t: 'Balanced', s: 'Wait briefly for a cheaper slot, then proceed.' },
  { key: 'fastest', glyph: '●', t: 'Fastest', s: 'Always grab the fastest available. Higher credits.' },
];

const AVAIL_KEY = 'noema-availability';

// The availability preference is a real local setting — read it, don't invent it. Storage can
// be absent (a server render, a locked-down browser); then the default stands.
export function readAvailability(): Availability {
  try {
    const v = localStorage.getItem(AVAIL_KEY) as Availability | null;
    return v && AVAIL.some((a) => a.key === v) ? v : 'balanced';
  } catch {
    return 'balanced';
  }
}

export function writeAvailability(a: Availability) {
  try { localStorage.setItem(AVAIL_KEY, a); } catch { /* preference stays for this view only */ }
}

const fmtWarm = (ms?: number) => (ms == null ? 'idle' : ms <= 0 ? 'draining' : `~${Math.round(ms / 60000)}m left`);

// The one section with a pane of its own: cost-vs-speed for remote runs, and the live studios.
export function ComputeDetail({ studios, initialAvailability }: { studios: StudioEntry[] | null; initialAvailability: Availability }) {
  const [avail, setAvail] = useState<Availability>(initialAvailability);
  const set = (a: Availability) => { setAvail(a); writeAvailability(a); };
  return (
    <>
      <h1>Compute</h1>
      <div className="sub">Your cost-vs-speed preference, private-tunnel sessions, and your own machine.</div>

      <div className="ac-panel">
        <div className="ac-panel-l">availability · cost vs speed for remote runs</div>
        <div className="avail-grid">
          {AVAIL.map((a) => (
            <button key={a.key} className={`availcard${avail === a.key ? ' on' : ''}`} aria-pressed={avail === a.key} onClick={() => set(a.key)}>
              <div className="av-t"><span className="fillg">{a.glyph}</span> {a.t}</div>
              <div className="av-s">{a.s}</div>
            </button>
          ))}
        </div>
        <div className="ac-note mono">↳ every run executes on our compute — this sets cost vs speed, not custody.</div>
      </div>

      <div className="ac-panel">
        <div className="ac-panel-l">active sessions · your studios <Link to="/studio" className="accent" style={{ float: 'right', fontWeight: 400 }}>open studio ▸</Link></div>
        {studios === null ? (
          <div className="ac-note mono">Loading your sessions…</div>
        ) : studios.length === 0 ? (
          <div className="ac-note mono">no live studios — <Link to="/studio" className="accent">lease one</Link> to warm a GPU.</div>
        ) : (
          studios.map((s) => (
            <SessionRow key={s.studioId} name={s.label} detail={`${s.status} · ${s.guestsToday} guest gens · net ≈ $${s.netUsd.toFixed(2)}`} state={fmtWarm(s.warmRemainingMs)} />
          ))
        )}
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

// Renders the pane a section owns. Only sections without `to` reach here.
export function SectionPane({ section, studios, initialAvailability }: { section: Section; studios: StudioEntry[] | null; initialAvailability: Availability }) {
  switch (section.key) {
    case 'compute':
      return <ComputeDetail studios={studios} initialAvailability={initialAvailability} />;
    default:
      // Unreachable while SECTIONS and this switch agree; the test holds them to it.
      return null;
  }
}
