import { useNavigate } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { useSession } from '../state/session';
import { FUNDING_LABEL } from '../lib/idents';
import { Chip } from '../shell/Chip';

// Keyring — the real multi-account switcher (Twitter model). One browser holds several
// named logins at once; you switch between them freely, each with its own projects,
// history, and settings. This is NOT the old "unlinkable profiles" mock: saved logins
// are exactly that — logins this browser remembers, linkable by it (and by any recovery
// channel bound to them). The unlinkability promise belongs to the anonymous slot alone.

export function Keyring() {
  const { ident, idents } = useIdentity();
  const { switchAccount, goAnonymous, signOutActive, signOutAll, accounts } = useSession();
  const navigate = useNavigate();

  const select = (id: string) => { if (id === ident.id) return; if (id === 'anon') goAnonymous(); else void switchAccount(id); };
  const addAccount = () => navigate('/onboard?add=1');

  return (
    <AppShell crumb="keyring">
      <div className="page"><div className="pw">
        <div className="pagehead"><div>
          <h1>Keyring</h1>
          <div className="sub">Your saved logins, all in this one browser. Switch between them freely — each keeps its own projects, history, and settings.</div>
        </div></div>

        <div className="sectionhead">Accounts</div>
        <div className="list">
          {idents.map((d) => {
            const active = d.id === ident.id;
            const anon = d.funding === 'bearer';
            return (
              <div className="lrow" key={d.id} onClick={() => select(d.id)}>
                <Chip d={d} />
                <div className="li-main">
                  <div className="t">{anon ? 'anonymous' : d.name}</div>
                  <div className="s">{FUNDING_LABEL[d.funding]} · {d.bal}{anon ? ' · unlinkable' : ''}</div>
                </div>
                <div className="li-right">
                  {active
                    ? <span className="badge accent">active</span>
                    : <span>switch</span>}
                  {active && !anon && (
                    <button
                      className="linkish"
                      style={{ marginLeft: 'var(--s3)' }}
                      onClick={(e) => { e.stopPropagation(); signOutActive(); }}
                    >sign out</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="btnrow" style={{ marginTop: 'var(--s4)', display: 'flex', gap: 'var(--s3)' }}>
          <button className="btn" onClick={addAccount}><Ic name="plus" /> Add account</button>
          {accounts.length > 0 && (
            <button className="btn ghost" onClick={signOutAll}>Sign out of all</button>
          )}
        </div>

        <div className="sub" style={{ marginTop: 'var(--s4)', color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
          Running on your own machine is a <b>session mode</b>, not a separate account — switch it per window from the identity menu. Any account can use it. (TEE is on the roadmap.)
        </div>

        <div className="sectionhead">On unlinkability</div>
        <div className="warn" style={{ marginTop: 'var(--s2)' }}>
          The <b>anonymous</b> slot is unlinkable by construction — no wallet, no name, and we hold no map
          tying it to your named accounts. The saved logins above are not that: they are logins this browser
          remembers, linkable by it and by any wallet or Telegram you bind for recovery. Switch freely, but
          know the difference.
        </div>
      </div></div>
    </AppShell>
  );
}
