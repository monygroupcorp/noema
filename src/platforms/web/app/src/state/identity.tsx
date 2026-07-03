import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { type Ident, type Execution } from '../lib/idents';
import { useSession } from './session';
import { api } from '../lib/api';

// The current identity, DERIVED from the real session + live balance — no longer a
// mock seed. Funding follows auth: a signed-in fiat session is `named` (identified),
// the anon-commitment path is `bearer`. The balance is the real `/v1/me/status`
// snapshot. Everything execution-dependent (redaction, what we can see, the composer
// hint) is still derived from (funding × session.execution) in lib/idents.
//
// There is exactly ONE real identity per browser session, so `idents` is a singleton
// and `setIdentity` is a no-op kept for call-site compatibility — switching who you are
// is login/logout (the Account menu), not a local profile toggle.

interface IdentityCtx {
  ident: Ident;                          // the durable profile (anima), derived from session
  idents: Ident[];
  setIdentity: (id: string) => void;
  execution: Execution;                  // the session's execution mode — same profile, different locus
  setExecution: (e: Execution) => void;  // exclusive by construction (a single value per window)
}

const Ctx = createContext<IdentityCtx | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const { session, ready } = useSession();
  const [balance, setBalance] = useState<string | null>(null);
  const [execution, setExecution] = useState<Execution>(
    () => (localStorage.getItem('noema-exec') as Execution) || 'rented',
  );

  // Pull the real balance snapshot once auth settles, and whenever the account changes.
  // Anon-capable: /v1/me/status answers the commitment path too.
  useEffect(() => {
    if (!ready) return;
    let live = true;
    api.meStatus()
      .then((s) => { if (live && s?.balanceImpetus != null) setBalance(Number(s.balanceImpetus).toLocaleString()); })
      .catch(() => { /* leave balance null → shows a loading dash */ });
    return () => { live = false; };
  }, [ready, session?.animaId]);

  const ident: Ident = useMemo(() => {
    const named = !!session;
    const email = session?.email;
    const name = named ? (email?.split('@')[0] ?? 'account') : 'anonymous';
    const bal = balance != null ? `${balance} credits` : '…';
    return {
      id: session?.animaId ?? 'anon',
      name,
      role: named ? (email ?? 'account') : 'bearer purse',
      funding: named ? 'named' : 'bearer',
      glyph: named ? (name[0]?.toUpperCase() ?? 'A') : '◷',
      bal,
      exp: '—',
      ...(named ? { chipColor: '#cdd2ff' } : {}),
    };
  }, [session, balance]);

  // The two trust axes tag <html>, but from different layers: funding from the profile,
  // execution from the session. CSS shifts the accent off them (anonymous funding steps
  // back; private execution steps back further).
  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove('fund-named', 'fund-bearer', 'exec-rented', 'exec-tee', 'exec-local');
    el.classList.add('fund-' + ident.funding, 'exec-' + execution);
    localStorage.setItem('noema-exec', execution);
  }, [ident.funding, execution]);

  return (
    <Ctx.Provider value={{ ident, idents: [ident], setIdentity: () => {}, execution, setExecution }}>
      {children}
    </Ctx.Provider>
  );
}

export function useIdentity() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useIdentity must be used within IdentityProvider');
  return v;
}
