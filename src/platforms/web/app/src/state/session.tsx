import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, getSession, setSession, type AuthResult } from '../lib/api';

// The REAL fiat session — a JWT the backend resolves to an animaId. This is the
// authoritative "who is signed in" layer; state/identity.tsx now DERIVES the current
// identity (funding + balance) from it. When a session is present, every /v1 call in
// lib/api carries `Authorization: Bearer …` instead of the anon commitment, so the
// account's own credits/collections/settings load.
//
// Identity note: the anon commitment and a named anima are DIFFERENT souls — anon
// work does not migrate on login. The login screen says so.

interface SessionState { token: string; animaId: string; email?: string }

// The email isn't echoed by refresh/verify — cache it locally so the account readout
// survives a reload. Cleared on logout.
const EMAIL_KEY = 'noema-session-email';
const rememberEmail = (email?: string) => { if (email) localStorage.setItem(EMAIL_KEY, email); };
const recallEmail = (): string | undefined => localStorage.getItem(EMAIL_KEY) ?? undefined;

interface SessionCtx {
  session: SessionState | null;   // null = logged out (anon commitment path)
  ready: boolean;                 // false until the initial refresh settles
  register: (email: string, password: string) => Promise<void>;   // no session — verify first
  login: (email: string, password: string) => Promise<void>;
  verifyEmail: (token: string) => Promise<void>;                  // auto-login
  logout: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<SessionState | null>(null);
  const [ready, setReady] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt a fresh {session, animaId} — persist the token and schedule a pre-expiry refresh.
  function adopt(res: AuthResult, email?: string) {
    const em = email ?? recallEmail();
    rememberEmail(em);
    setSession(res.session.token);
    setSessionState({ token: res.session.token, animaId: res.animaId, email: em });
    scheduleRefresh(res.session.expiresIn);
  }

  function scheduleRefresh(expiresIn: number) {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    // Refresh a minute before expiry (clamped to a sane window); silently drop on failure.
    const ms = Math.max(30_000, (expiresIn - 60) * 1000);
    refreshTimer.current = setTimeout(() => {
      api.auth.refresh()
        .then((res) => adopt(res, session?.email))
        .catch(() => {/* token likely expired — leave it; next guarded call re-auths */});
    }, ms);
  }

  // On mount: if a token is already stored, validate + hydrate animaId via refresh.
  useEffect(() => {
    const stored = getSession();
    if (!stored) { setReady(true); return; }
    let live = true;
    api.auth.refresh()
      .then((res) => { if (live) adopt(res); })
      .catch(() => { if (live) { setSession(null); setSessionState(null); } })
      .finally(() => { if (live) setReady(true); });
    return () => {
      live = false;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const register = async (email: string, password: string) => {
    await api.auth.register(email, password); // 202 — no session; user must verify their email
  };

  const login = async (email: string, password: string) => {
    const res = await api.auth.login(email, password);
    adopt(res, email);
  };

  const verifyEmail = async (token: string) => {
    const res = await api.auth.verifyEmail(token);
    adopt(res);
  };

  const logout = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    localStorage.removeItem(EMAIL_KEY);
    setSession(null);
    setSessionState(null);
  };

  return (
    <Ctx.Provider value={{ session, ready, register, login, verifyEmail, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used within SessionProvider');
  return v;
}
