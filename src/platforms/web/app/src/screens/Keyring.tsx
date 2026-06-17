import { useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { TIER_LABEL, type Tier } from '../lib/idents';
import { Chip } from '../shell/Chip';

const TIER_OPTS: { tier: Tier; ico: string; t: string; s: string }[] = [
  { tier: 'identified', ico: 'user-round', t: 'Identified', s: 'Signed in. We keep your work and your galaxy.' },
  { tier: 'anon', ico: 'venetian-mask', t: 'Anonymous', s: 'A bearer purse. We see the work, never who you are.' },
  { tier: 'tee', ico: 'eye-off', t: 'Private', s: 'Sealed compute over your tunnel. We see nothing but the meter.' },
];

export function Keyring() {
  const { ident, idents, setIdentity } = useIdentity();
  const [pick, setPick] = useState<Tier>('identified');

  return (
    <AppShell crumb="keyring">
      <div className="page"><div className="pw">
        <div className="pagehead"><div>
          <h1>Keyring</h1>
          <div className="sub">Your identities live only in this browser. We hold no map between them — switching is a private act we never witness.</div>
        </div></div>

        <div className="sectionhead">Identities</div>
        <div className="list">
          {idents.map((d) => {
            const active = d.id === ident.id;
            return (
              <div className="lrow" key={d.id} onClick={() => setIdentity(d.id)}>
                <Chip d={d} />
                <div className="li-main">
                  <div className="t">{d.tier === 'anon' ? 'anonymous' : d.name}</div>
                  <div className="s">{TIER_LABEL[d.tier]} · {d.bal}</div>
                </div>
                <div className="li-right">
                  {active ? <span className="badge accent">active</span> : 'switch'}
                </div>
              </div>
            );
          })}
        </div>

        <div className="sectionhead">New identity</div>
        <div className="sub" style={{ marginBottom: 'var(--s4)' }}>A fresh identity is a fresh galaxy. Choose how much we can see.</div>
        <div className="tierpick">
          {TIER_OPTS.map((o) => (
            <div key={o.tier} className={`tieropt${pick === o.tier ? ' on' : ''}`} onClick={() => setPick(o.tier)}>
              <div className="tchip"><Ic name={o.ico} /></div>
              <div className="tmain"><div className="t">{o.t}</div><div className="s">{o.s}</div></div>
            </div>
          ))}
        </div>
        <button className="btn" onClick={() => alert(`create a new ${pick} identity (todo)`)}>Create identity</button>

        <div className="warn" style={{ marginTop: 'var(--s6)' }}>
          Identities are unlinkable by construction. We cannot merge, recover, or correlate them for you — that is the point.
        </div>
      </div></div>
    </AppShell>
  );
}
