import { useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { PRESETS, FUNDING_LABEL } from '../lib/idents';
import { Chip } from '../shell/Chip';

export function Keyring() {
  const { ident, idents, setIdentity } = useIdentity();
  const [pick, setPick] = useState<string>(PRESETS[0].id);

  return (
    <AppShell crumb="keyring">
      <div className="page"><div className="pw">
        <div className="pagehead"><div>
          <h1>Keyring</h1>
          <div className="sub">Your profiles live only in this browser. We hold no map between them — switching is a private act we never witness.</div>
        </div></div>

        <div className="sectionhead">Profiles</div>
        <div className="list">
          {idents.map((d) => {
            const active = d.id === ident.id;
            return (
              <div className="lrow" key={d.id} onClick={() => setIdentity(d.id)}>
                <Chip d={d} />
                <div className="li-main">
                  <div className="t">{d.funding === 'bearer' ? 'anonymous' : d.name}</div>
                  <div className="s">{FUNDING_LABEL[d.funding]} · {d.bal} · {d.exp}</div>
                </div>
                <div className="li-right">
                  {active ? <span className="badge accent">active</span> : 'switch'}
                </div>
              </div>
            );
          })}
        </div>
        <div className="sub" style={{ marginTop: 'var(--s3)', color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
          Going private (TEE) or running on your own machine is a <b>session mode</b>, not a separate profile — switch it per window from the identity menu. Any profile can use it.
        </div>

        <div className="sectionhead">New profile</div>
        <div className="sub" style={{ marginBottom: 'var(--s4)' }}>A fresh profile is a fresh galaxy. Choose how you’re known — each builds its own history and XP.</div>
        <div className="tierpick">
          {PRESETS.map((o) => (
            <div key={o.id} className={`tieropt${pick === o.id ? ' on' : ''}`} onClick={() => setPick(o.id)}>
              <div className="tchip"><Ic name={o.ico} /></div>
              <div className="tmain"><div className="t">{o.t}</div><div className="s">{o.s}</div></div>
            </div>
          ))}
        </div>
        <button className="btn" onClick={() => alert(`create a new ${pick} profile (todo)`)}>Create profile</button>

        <div className="warn" style={{ marginTop: 'var(--s6)' }}>
          Profiles are unlinkable by construction. We cannot merge, recover, or correlate them for you — that is the point.
        </div>
      </div></div>
    </AppShell>
  );
}
