import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { useSession } from '../state/session';
import { FUNDING_LABEL, type Ident } from '../lib/idents';
import { Chip } from '../shell/Chip';

// Keyring — the real multi-account switcher (Twitter model). One browser holds several
// named logins at once; you switch between them freely, each with its own projects,
// history, and settings. This is NOT the old "unlinkable profiles" mock: saved logins
// are exactly that — logins this browser remembers, linkable by it (and by any recovery
// channel bound to them). The unlinkability promise belongs to the anonymous slot alone.
//
// Each row carries its own actions (REF-33: the row is where you act on an item), built from
// what the session state can really do: switch to a login (switchAccount / goAnonymous) and
// forget a login on this browser (forgetAccount). There is no rename — the name is the
// account's username, held by the server — and the anonymous slot is never removed, because
// it is not a stored login at all: it is what remains when none is active.

export const ANON_NOTE = 'always here · not removable';

// What the second step of a remove says is lost. Forgetting is client-side only: the account
// keeps everything; this browser just stops holding its login.
export function removeLoss(name: string, wasActive: boolean, nextName: string | null): string {
  const base = `This browser forgets the login for ${name}. The account and everything on it stay as they are; to use it here again you sign in with its password or a recovery wallet or Telegram.`;
  if (!wasActive) return base;
  return `${base} You are switched to ${nextName ?? 'the anonymous slot'} right away.`;
}

export interface KeyringRowProps {
  d: Ident;
  active: boolean;
  /** Open the two-step remove on this row. */
  confirming: boolean;
  /** Who takes over if this (active) login is removed — a username, or null for the anonymous slot. */
  nextName: string | null;
  onSwitch: (id: string) => void;
  onRemoveAsk: (id: string) => void;
  onRemoveConfirm: (id: string) => void;
  onRemoveCancel: () => void;
}

export function KeyringRow({ d, active, confirming, nextName, onSwitch, onRemoveAsk, onRemoveConfirm, onRemoveCancel }: KeyringRowProps) {
  const anon = d.funding === 'bearer';
  const name = anon ? 'anonymous' : d.name;
  return (
    <div className={`lrow kr${active ? ' is-active' : ''}`} data-ident={d.id}>
      <Chip d={d} />
      <div className="li-main">
        <div className="t">{name}</div>
        <div className="s">{FUNDING_LABEL[d.funding]} · {d.bal}{anon ? ' · unlinkable' : ''}</div>
      </div>
      <div className="kr-acts">
        {active && <span className="badge accent">active</span>}
        {!active && (
          <button type="button" className="btn ghost kr-switch" onClick={() => onSwitch(d.id)} aria-label={`Switch to ${name}`}>
            Switch to
          </button>
        )}
        {anon
          ? <span className="kr-note">{ANON_NOTE}</span>
          : !confirming && (
            <button
              type="button"
              className="btn ghost kr-remove"
              onClick={() => onRemoveAsk(d.id)}
              aria-label={`Remove ${name} from this browser`}
            >
              <Ic name="trash-2" /> Remove from this browser
            </button>
          )}
      </div>
      {confirming && !anon && (
        <div className="kr-confirm" role="group" aria-label={`Remove ${name} from this browser?`}>
          <div className="kr-confirm-text">
            <b>Remove {name} from this browser?</b> {removeLoss(name, active, nextName)}
          </div>
          <div className="kr-acts">
            <button type="button" className="btn ghost bad kr-remove-yes" onClick={() => onRemoveConfirm(d.id)}>Yes, remove it</button>
            <button type="button" className="btn ghost kr-remove-no" onClick={onRemoveCancel}>Keep it</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function Keyring() {
  const { ident, idents } = useIdentity();
  const { switchAccount, goAnonymous, forgetAccount, signOutAll, accounts } = useSession();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState<string | null>(null);

  const select = (id: string) => { if (id === ident.id) return; if (id === 'anon') goAnonymous(); else void switchAccount(id); };
  const remove = (id: string) => { setConfirming(null); forgetAccount(id); };
  const addAccount = () => navigate('/onboard?add=1');

  // Who takes over when the active login is removed: the session falls to the last remaining
  // held account, else the anonymous slot (state/session.tsx forgetAccount).
  const nextAfter = (id: string): string | null => {
    const rest = accounts.filter((a) => a.animaId !== id);
    const last = rest[rest.length - 1];
    return last ? (last.username ?? 'account') : null;
  };

  return (
    <AppShell crumb="Keyring">
      <div className="page"><div className="pw">
        <div className="pagehead"><div>
          <h1>Keyring</h1>
          <div className="sub">Your saved logins, all in this one browser. Switch between them freely — each keeps its own projects, history, and settings.</div>
        </div></div>

        <div className="sectionhead">Accounts</div>
        <div className="list">
          {idents.map((d) => (
            <KeyringRow
              key={d.id}
              d={d}
              active={d.id === ident.id}
              confirming={confirming === d.id}
              nextName={nextAfter(d.id)}
              onSwitch={select}
              onRemoveAsk={setConfirming}
              onRemoveConfirm={remove}
              onRemoveCancel={() => setConfirming(null)}
            />
          ))}
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
