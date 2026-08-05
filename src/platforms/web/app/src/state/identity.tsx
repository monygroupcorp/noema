import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { type Ident, type Execution } from '../lib/idents';
import { useSession } from './session';
import { api } from '../lib/api';

// The current identity, DERIVED from the active session + live balance — no longer a
// mock seed. Funding follows auth: a signed-in fiat session is `named` (identified),
// the anon-commitment path is `bearer`. The balance is the real `/v1/me/status`
// snapshot. Everything execution-dependent (redaction, what we can see, the composer
// hint) is still derived from (funding × session.execution) in lib/idents.
//
// MULTI-ACCOUNT: `idents` is now the REAL list — every held login (state/session.tsx)
// mapped to an Ident, plus the always-present anonymous slot (the implicit "no account"
// path). `setIdentity(id)` is real too: a real animaId → switchAccount; the 'anon'
// sentinel → step onto the anon slot keeping your saved logins.

// Per-account execution mode (Decision 6) — namespaced by scope, legacy read-fallback.
const loadExec = (scope: string): Execution =>
  ((localStorage.getItem(`noema-${scope}-exec`) ?? localStorage.getItem('noema-exec')) as Execution) || 'rented';

// The anonymous slot — the implicit "no account" identity you always fall back to.
const ANON_ID = 'anon';
const anonIdent = (bal: string): Ident => ({
  id: ANON_ID, name: 'anonymous', role: 'bearer purse', funding: 'bearer', glyph: '◷', bal, exp: '—',
});
const namedIdent = (animaId: string, username: string | undefined, bal: string): Ident => {
  const name = username ?? 'account';
  return { id: animaId, name, role: name, funding: 'named', glyph: name[0]?.toUpperCase() ?? 'A', bal, exp: '—', chipColor: '#cdd2ff' };
};

interface IdentityCtx {
  ident: Ident;                          // the ACTIVE profile (anima), derived from the active session
  idents: Ident[];                       // every held login + the anon slot (last)
  setIdentity: (id: string) => void;     // real: switchAccount / go-anonymous
  execution: Execution;                  // the session's execution mode — same profile, different locus
  setExecution: (e: Execution) => void;  // exclusive by construction (a single value per window)
}

const Ctx = createContext<IdentityCtx | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const { session, accounts, ready, switchAccount, goAnonymous } = useSession();
  const [balance, setBalance] = useState<string | null>(null);

  // Execution mode is per-account (Keyring Decision 6): it's a posture of *who you are*, so
  // it's namespaced by the active animaId like the workspace, with a legacy read-fallback.
  const execScope = session?.animaId ?? 'anon';
  const [execution, setExecution] = useState<Execution>(() => loadExec(execScope));
  const [loadedExecScope, setLoadedExecScope] = useState<string>(execScope);
  if (loadedExecScope !== execScope) {
    setLoadedExecScope(execScope);
    setExecution(loadExec(execScope));
  }

  // Pull the real balance snapshot once auth settles, and whenever the ACTIVE account changes.
  // Anon-capable: /v1/me/status answers the commitment path too. The balance is the active
  // account's; inactive held logins show '…' (we don't fan out a status call per account).
  useEffect(() => {
    if (!ready) return;
    let live = true;
    setBalance(null);
    api.meStatus()
      .then((s) => { if (live && s?.balanceImpetus != null) setBalance(Number(s.balanceImpetus).toLocaleString()); })
      .catch(() => { /* leave balance null → shows a loading dash */ });
    return () => { live = false; };
  }, [ready, session?.animaId]);

  const activeBal = balance != null ? `${balance} credits` : '…';

  const ident: Ident = useMemo(
    () => (session ? namedIdent(session.animaId, session.username, activeBal) : anonIdent(activeBal)),
    [session, activeBal],
  );

  // The real switcher list: held logins first (active one carries the live balance), anon slot last.
  const idents: Ident[] = useMemo(() => {
    const rows = accounts.map((a) =>
      namedIdent(a.animaId, a.username, a.animaId === session?.animaId ? activeBal : '…'));
    return [...rows, anonIdent(session ? '…' : activeBal)];
  }, [accounts, session, activeBal]);

  const setIdentity = (id: string) => { if (id === ANON_ID) goAnonymous(); else void switchAccount(id); };

  // The two trust axes tag <html>, but from different layers: funding from the profile,
  // execution from the session. CSS shifts the accent off them (anonymous funding steps
  // back; private execution steps back further).
  useEffect(() => {
    const el = document.documentElement;
    el.classList.remove('fund-named', 'fund-bearer', 'exec-rented', 'exec-tee', 'exec-local');
    el.classList.add('fund-' + ident.funding, 'exec-' + execution);
    localStorage.setItem(`noema-${execScope}-exec`, execution);
  }, [ident.funding, execution, execScope]);

  return (
    <Ctx.Provider value={{ ident, idents, setIdentity, execution, setExecution }}>
      {children}
    </Ctx.Provider>
  );
}

export function useIdentity() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useIdentity must be used within IdentityProvider');
  return v;
}
