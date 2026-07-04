import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, getSession, setSession, type AuthResult } from '../lib/api';
import { connectWallet } from '../lib/wallet';

// The REAL fiat session — a JWT the backend resolves to an animaId. This is the
// authoritative "who is signed in" layer; state/identity.tsx now DERIVES the current
// identity (funding + balance) from it. When a session is present, every /v1 call in
// lib/api carries `Authorization: Bearer …` instead of the anon commitment, so the
// account's own credits/collections/settings load.
//
// Anonymous username+password — NO email. Register logs you straight in. Identity note:
// the anon commitment and a named anima are DIFFERENT souls — anon work does not migrate
// on login. The login screen says so.

interface SessionState { token: string; animaId: string; username?: string }

// The username isn't echoed by refresh — cache it locally so the account readout
// survives a reload. Cleared on logout.
const NAME_KEY = 'noema-session-username';
const rememberName = (username?: string) => { if (username) localStorage.setItem(NAME_KEY, username); };
const recallName = (): string | undefined => localStorage.getItem(NAME_KEY) ?? undefined;

interface SessionCtx {
  session: SessionState | null;   // null = logged out (anon commitment path)
  ready: boolean;                 // false until the initial refresh settles
  register: (username: string, password: string) => Promise<void>;   // mints a session (auto-login)
  login: (username: string, password: string) => Promise<void>;
  recoverWithWallet: () => Promise<void>;   // prove a linked wallet → log straight in
  recoverWithTelegram: (code: string) => Promise<void>;   // paste a bot recovery code → log in
  logout: () => void;
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<SessionState | null>(null);
  const [ready, setReady] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Adopt a fresh {session, animaId} — persist the token and schedule a pre-expiry refresh.
  function adopt(res: AuthResult, username?: string) {
    const nm = username ?? recallName();
    rememberName(nm);
    setSession(res.session.token);
    setSessionState({ token: res.session.token, animaId: res.animaId, username: nm });
    scheduleRefresh(res.session.expiresIn);
  }

  function scheduleRefresh(expiresIn: number) {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    // Refresh a minute before expiry (clamped to a sane window); silently drop on failure.
    const ms = Math.max(30_000, (expiresIn - 60) * 1000);
    refreshTimer.current = setTimeout(() => {
      api.auth.refresh()
        .then((res) => adopt(res, session?.username))
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

  const register = async (username: string, password: string) => {
    const res = await api.auth.register(username, password); // 201 — mints a session (no verify step)
    adopt(res, username);
  };

  const login = async (username: string, password: string) => {
    const res = await api.auth.login(username, password);
    adopt(res, username);
  };

  // Forgot-password recovery: prove control of a linked wallet, log straight in. The
  // username isn't known here (recall from a prior session if any) — the animaId is what matters.
  const recoverWithWallet = async () => {
    const wallet = await connectWallet();
    const { token, statement } = await api.auth.walletChallenge(wallet.address);
    const signature = await wallet.signMessage(statement);
    const res = await api.auth.walletRecover(token, signature);
    adopt(res);
  };

  // Forgot-password recovery via Telegram: the user pastes a code the bot handed them.
  const recoverWithTelegram = async (code: string) => {
    const res = await api.auth.telegramRecover(code.trim());
    adopt(res);
  };

  const logout = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    localStorage.removeItem(NAME_KEY);
    setSession(null);
    setSessionState(null);
  };

  return (
    <Ctx.Provider value={{ session, ready, register, login, recoverWithWallet, recoverWithTelegram, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used within SessionProvider');
  return v;
}
