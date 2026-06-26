import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useIdentity } from '../state/identity';
import {
  IDENTITY_PRIV, WORK_PRIV, EXECUTION_SHORT, EXECUTIONS,
  isPrivateExec, canSee,
} from '../lib/idents';
import { meterFor, type WarmItem } from '../lib/meter';
import { Ic } from '../lib/icons';
import { Chip } from './Chip';

// The one account surface (top-right) — fuses what used to be three: the identity/trust
// control, the compute meter, and the rail's Vault/Profile/Ledger menu. Navigation lives
// left; everything that is "you" — who you are, what you're spending, what compute you hold —
// lives here. The trigger stays glanceable (name · balance · live-count); detail is one click in.
const ACCT_LINKS = [
  { to: '/vault', ico: 'key-round', label: 'Vault' },
  { to: '/compute', ico: 'server', label: 'Compute' },
  { to: '/profile', ico: 'palette', label: 'Profile' },
  { to: '/status', ico: 'receipt-text', label: 'Ledger' },
];

export function Account() {
  const { ident, idents, setIdentity, execution, setExecution } = useIdentity();
  const here = useLocation().pathname;
  const meter = useMemo(() => meterFor(execution, ident), [execution, ident]);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const [warm, setWarm] = useState<WarmItem[]>(meter.warm);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setWarm(meter.warm); }, [meter.locus, meter.shown]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t.closest('#acctpop') && !t.closest('.acctbtn')) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  const who = IDENTITY_PRIV[ident.funding];
  const work = WORK_PRIV[execution];
  const privateExec = isPrivateExec(execution);
  const { can, cant } = canSee(ident.funding, execution);
  const name = ident.funding === 'bearer' ? 'anonymous' : ident.name;
  const credits = ident.bal.match(/(\d[\d,]*)\s*credits?/)?.[1] ?? null;

  const usedGb = warm.reduce((s, w) => s + w.vramGb, 0);
  const pct = meter.shown ? Math.min(100, Math.round((usedGb / meter.vramTotalGb) * 100)) : 0;
  const evict = (id: string) => setWarm((w) => w.filter((x) => x.id !== id));
  const pin = (id: string) => setWarm((w) => w.map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x)));
  const q = meter.queue[0];
  const offerEvict = q?.evicts && warm.some((w) => w.name === q.evicts) ? q.evicts : null;

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ right: Math.max(12, window.innerWidth - r.right), top: r.bottom + 8 });
    setOpen((o) => !o);
  }

  return (
    <div className="account">
      <button className="mebtn acctbtn" ref={btnRef} onClick={toggle}>
        <Chip d={ident} />
        <span className="nm">{name}</span>
        {credits && <span className="acct-bal mono">{credits} cr</span>}
        {meter.shown && <span className="acct-live"><span className="mdot" />{meter.podCount}</span>}
        <span className="cv"><Ic name="chevron-down" /></span>
      </button>

      {open && (
        <div id="acctpop" className="open" style={pos}>
          <div className="tp-head">
            <Chip d={ident} />
            <div>
              <div className="nm">{name}</div>
              <div className="role">{ident.role} · {ident.exp}</div>
            </div>
            <span className="acct-trust">
              <span className="trust-mini"><Ic name={who[0]} /> {who[1]}</span>
              {privateExec && <span className="trust-mini work"><Ic name={work[0]} /> {work[1]}</span>}
            </span>
          </div>

          {/* wallet */}
          <div className="tp-sec acct-wallet">
            <div><div className="bal-n">{credits ?? '—'} <span>credits</span></div>{ident.bal !== `${credits} credits` && <div className="bal-sub">{ident.bal}</div>}</div>
            <Link className="btn sm" to="/funding" onClick={() => setOpen(false)}><Ic name="plus" /> Add</Link>
          </div>

          {/* execution mode — same profile, exclusive locus */}
          <div className="tp-sec">
            <div className="tp-l">execution · this window</div>
            <div className="execmode" role="group">
              {EXECUTIONS.map((e) => (
                <button key={e} className={`em${execution === e ? ' on' : ''}`} onClick={() => setExecution(e)}>
                  <Ic name={WORK_PRIV[e][0]} /> {EXECUTION_SHORT[e]}
                </button>
              ))}
            </div>
            <div className="tp-cant" style={{ marginTop: 6 }}>one mode at a time — switching ends the other; your profile stays the same</div>
          </div>

          {/* live compute — only when standing (the meter, folded in) */}
          {meter.shown && (
            <div className="tp-sec">
              <div className="tp-l">live compute</div>
              <div className="mp-head">
                <div className="mp-locus"><Ic name={work[0]} /> {meter.podLabel}</div>
                <div className={`mp-cost${meter.metered ? '' : ' free'}`}>{meter.costLabel}</div>
              </div>
              <div className="mp-vram">
                <div className="bar"><span style={{ width: `${pct}%` }} /></div>
                <div className="lbl mono">{usedGb.toFixed(1)} / {meter.vramTotalGb} GB</div>
              </div>
              <div className="mp-sub">
                <div className="mp-ll">warm</div>
                {warm.map((w) => (
                  <div className="mp-row" key={w.id}>
                    <span className="nm">{w.name}{w.pinned && <span className="pin"><Ic name="star" /></span>}</span>
                    <span className="mono gb">{w.vramGb.toFixed(1)} GB</span>
                    <span className={`st ${w.status}`}>{w.status}</span>
                    <span className="acts">
                      <button onClick={() => pin(w.id)} title={w.pinned ? 'unpin' : 'pin'}><Ic name="star" /></button>
                      <button onClick={() => evict(w.id)} title="evict"><Ic name="x" /></button>
                    </span>
                  </div>
                ))}
                <div className="mp-ll">staged · {meter.locus === 'tee' ? 'piped through your tunnel' : 'on your machine'}</div>
                {meter.staged.map((s) => (
                  <div className="mp-row staged" key={s.id}>
                    <span className="nm">{s.name}</span><span className="mono gb">{s.size}</span>
                    <span className="st piped"><Ic name={work[0]} /> {meter.locus === 'tee' ? 'in tunnel' : 'local'}</span>
                  </div>
                ))}
                <div className="mp-ll">queue</div>
                {meter.queue.map((qi) => (
                  <div className="mp-row queue" key={qi.id}>
                    <span className="nm">{qi.verb}</span><span className="mono gb">needs {qi.needsGb} GB</span>
                    {qi.evicts && <span className="st evict">evicts {qi.evicts}</span>}
                  </div>
                ))}
                {offerEvict && (
                  <div className="mp-offer">
                    <span className="orb" /> Concierge: low on VRAM — evict <b>{offerEvict}</b> to fit the queue?
                    <button onClick={() => { const t = warm.find((w) => w.name === offerEvict); if (t) evict(t.id); }}>Evict</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* trust summary — the full "what reaches us" table is the ambient rail-bottom panel */}
          <div className="tp-sec">
            <div className="tp-l">noema can see</div>
            <div className="tp-can">{can.length ? can.join(' · ') : 'nothing'}</div>
            {cant.length > 0 && <div className="tp-cant">hidden — {cant.join(', ')}</div>}
          </div>

          {/* account links (were the rail's Account menu) */}
          <div className="tp-sec acct-links">
            {ACCT_LINKS.map((l) => (
              <Link key={l.to} to={l.to} className={`acct-link${here === l.to ? ' on' : ''}`} onClick={() => setOpen(false)}>
                <Ic name={l.ico} /> {l.label}
              </Link>
            ))}
          </div>

          {/* profiles (were the rail's keyring) */}
          <div className="tp-sec">
            <div className="tp-l">profiles</div>
            {idents.map((d) => (
              <button key={d.id} className={`acct-prof${d.id === ident.id ? ' on' : ''}`} onClick={() => setIdentity(d.id)}>
                <Chip d={d} />
                <span className="nm">{d.funding === 'bearer' ? 'anonymous' : d.name}</span>
                <span className="meta mono">{d.exp}</span>
                {d.id === ident.id && <span className="dot" />}
              </button>
            ))}
            <Link className="tp-manage" to="/keyring" onClick={() => setOpen(false)}>Manage profiles →</Link>
          </div>
        </div>
      )}
    </div>
  );
}
