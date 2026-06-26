import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useIdentity } from '../state/identity';
import { Ic } from '../lib/icons';
import { api, type MeStatus } from '../lib/api';

const IMPETUS_USD = 0.000337;

export function Status() {
  const { ident } = useIdentity();
  const [me, setMe] = useState<MeStatus | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let live = true;
    api.meStatus().then((s) => { if (live) setMe(s); }).catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, []);

  const credits = me ? Number(me.balanceImpetus) : 0;
  const usd = me ? (me.balanceUsd || credits * IMPETUS_USD) : 0;
  const runs = me?.gens.length ?? 0;
  const studios = me?.studios.length ?? 0;

  return (
    <AppShell crumb="account">
      <div className="page"><div className="pw">
        <div className="pagehead">
          <div><h1>Account</h1><div className="sub">{ident.name} · {ident.role}</div></div>
          <div className="right"><Link className="btn" to="/funding"><Ic name="plus" /> Add credits</Link></div>
        </div>

        {err && <div className="warn">Couldn’t reach your account on staging.</div>}

        <div className="stats">
          <div className="stat"><div className="l">Balance</div><div className="n">{me ? credits.toLocaleString() : '…'}</div><div className="d">credits · ≈ ${usd.toFixed(2)}</div></div>
          <div className="stat"><div className="l">Runs</div><div className="n">{me ? runs : '…'}</div><div className="d">all time</div></div>
          <div className="stat"><div className="l">Studios</div><div className="n">{me ? studios : '…'}</div><div className="d">warm sessions</div></div>
        </div>

        <div className="sectionhead">Recent runs</div>
        {!me ? (
          <div className="empty"><div className="t">Loading your account…</div></div>
        ) : runs === 0 ? (
          <div className="empty">
            <div className="ico"><Ic name="sparkles" /></div>
            <div className="t">No runs yet — your generations will appear here, and in your <Link to="/space" style={{ color: 'var(--accent-soft)' }}>space</Link>.</div>
          </div>
        ) : (
          <div className="list">
            {me.gens.slice(0, 8).map((gobj, i) => {
              const gn = gobj as { modusId?: string; status?: string; createdAt?: string };
              return (
                <div className="lrow" key={i}>
                  <div className="li-main"><div className="t">{gn.modusId ?? 'run'}</div><div className="s">{gn.status ?? ''}</div></div>
                  <div className="li-right">{gn.createdAt?.slice(0, 10) ?? ''}</div>
                </div>
              );
            })}
          </div>
        )}

        <div className="sub" style={{ marginTop: 'var(--s5)', color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
          Live from staging · {ident.funding === 'named' ? 'signed-in account' : 'anonymous session'}.
        </div>
      </div></div>
    </AppShell>
  );
}
