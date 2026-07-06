import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  api, AuthApiError, getAccounts, upsertAccount, setActiveAnimaId, dropActiveAccount, clearAllAccounts,
  setPendingToken, takeLegacySession, type AuthResult, type StoredAccount, type SessionStore,
} from '../lib/api';
import { connectWallet } from '../lib/wallet';

// The REAL fiat session layer — now MULTI-ACCOUNT (the Twitter model). One browser
// holds several named logins at once, keyed by animaId, with a single ACTIVE pointer.
// state/identity.tsx DERIVES the visible identity from the active session. Each account
// is already an independent backend soul (register/login mints a per-anima JWT), so
// holding N of them needs NO new backend — it's a client store (lib/api.ts) + an active
// pointer. When an account is active, every /v1 call carries its `Authorization: Bearer …`;
// with none active we fall back to the anon commitment path (the implicit "no account" slot).
//
// Anonymous username+password — NO email. Register logs you straight in. The anon
// commitment and a named anima are DIFFERENT souls — anon work does not migrate on login.

interface SessionState { token: string; animaId: string; username?: string }

// Refresh a live token this long before it lapses; also the "is this near expiry?" window
// a switch uses to decide instant-activate vs refresh-then-activate.
const REFRESH_LEAD_MS = 60_000;

const activeOf = (s: SessionStore): SessionState | null => {
  const a = s.accounts.find((x) => x.animaId === s.activeAnimaId);
  return a ? { token: a.token, animaId: a.animaId, username: a.username } : null;
};
const nearExpiry = (a?: StoredAccount): boolean => !a?.expiresAt || a.expiresAt - Date.now() < REFRESH_LEAD_MS;

interface SessionCtx {
  session: SessionState | null;       // the ACTIVE account (null = anon commitment path)
  accounts: StoredAccount[];          // every held login
  activeAnimaId: string | null;
  ready: boolean;                     // false until the initial refresh settles
  register: (username: string, password: string) => Promise<void>;   // mints + adds an account (auto-login)
  login: (username: string, password: string) => Promise<void>;      // adds/activates an account
  recoverWithWallet: () => Promise<void>;       // prove a linked wallet → add + activate that soul
  recoverWithTelegram: (code: string) => Promise<void>;   // paste a bot recovery code → add + activate
  switchAccount: (animaId: string) => Promise<void>;      // re-point the active account
  goAnonymous: () => void;            // deactivate to the anon slot, KEEPING held logins
  signOutActive: () => void;          // drop the active account → next held, else anon
  signOutAll: () => void;             // drop every account → anon
}

const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [store, setStore] = useState<SessionStore>({ accounts: [], activeAnimaId: null });
  const [ready, setReady] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const session = useMemo(() => activeOf(store), [store]);

  // Adopt a fresh {session, animaId} — upsert it as the active account (additive: a new
  // animaId appends, an existing one updates in place) and schedule its pre-expiry refresh.
  function adopt(res: AuthResult, username?: string) {
    const expiresAt = Date.now() + (res.session.expiresIn ?? 0) * 1000;
    setStore(upsertAccount({ animaId: res.animaId, token: res.session.token, username, expiresAt }));
    scheduleRefresh(expiresAt);
  }

  // Refresh the ACTIVE account a minute before expiry; silently drop on failure (the next
  // guarded call re-auths). Reads the current active username at fire time (avoids stale closure).
  function scheduleRefresh(expiresAt?: number) {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    const ms = Math.max(30_000, (expiresAt ?? Date.now() + 90_000) - Date.now() - REFRESH_LEAD_MS);
    refreshTimer.current = setTimeout(() => {
      const cur = getAccounts();
      const active = cur.accounts.find((a) => a.animaId === cur.activeAnimaId);
      api.auth.refresh()
        .then((res) => adopt(res, active?.username))
        .catch(() => {/* token likely expired — leave it; next guarded call re-auths */});
    }, ms);
  }

  // On mount: migrate a pre-multi-account single token (once), then validate the active
  // account via refresh — hydrating its animaId and renewing the token.
  useEffect(() => {
    const legacy = takeLegacySession();     // pre-multi-account single token, if any
    if (legacy) setPendingToken(legacy.token);   // let refresh sign with it until it's adopted
    const initial = getAccounts();
    setStore(initial);
    if (!initial.activeAnimaId && !legacy) { setReady(true); return; }
    let live = true;
    const priorName = legacy?.username ?? activeOf(initial)?.username;
    api.auth.refresh()
      .then((res) => { if (live) adopt(res, priorName); })
      .catch((err) => {
        if (!live) return;
        setPendingToken(null);
        // Drop the account ONLY when the token is genuinely rejected (401/403). Everything else
        // — offline (fetch TypeError), a 5xx, or a proxy/gateway error — means the infra is down,
        // NOT that the token is bad, so we keep the stored account on its stale token; a later
        // reload re-validates it. A blip must not sign you out. Legacy migration can't survive
        // any failure (no animaId to keep an account around).
        const rejected = err instanceof AuthApiError && (err.status === 401 || err.status === 403);
        if (legacy || rejected) setStore(dropActiveAccount());
      })
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

  // Forgot-password recovery: prove control of a linked wallet, adopt that soul. The username
  // isn't known here — the animaId is what matters (the derived readout falls back to 'account').
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

  // Switch the active account. Activate immediately (instant if the token is still live),
  // then refresh-then-adopt in the background when it's near expiry. If that refresh fails
  // the account stays active on its stale token; guarded /v1 calls then fail until the user
  // re-signs in through the door (there is no global 401 interceptor — TODO: auto re-login).
  const switchAccount = async (animaId: string) => {
    const cur = getAccounts();
    const target = cur.accounts.find((a) => a.animaId === animaId);
    if (!target) return;
    setStore(setActiveAnimaId(animaId));   // instant — target's token is now the bearer
    if (nearExpiry(target)) {
      try { adopt(await api.auth.refresh(), target.username); }
      catch {/* stale — leave active; guarded calls fail until a manual re-sign-in */}
    } else {
      scheduleRefresh(target.expiresAt);
    }
  };

  // Step off every account onto the anon commitment path WITHOUT dropping your saved logins
  // — the "browse logged out but keep your accounts" move. Distinct from signOutActive.
  const goAnonymous = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    setStore(setActiveAnimaId(null));
  };

  // Sign out of the ACTIVE account only — activate the next held account, or fall to anon.
  const signOutActive = () => {
    const next = dropActiveAccount();
    setStore(next);
    const active = next.accounts.find((a) => a.animaId === next.activeAnimaId);
    if (active) scheduleRefresh(active.expiresAt);
    else if (refreshTimer.current) clearTimeout(refreshTimer.current);
  };

  const signOutAll = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    setStore(clearAllAccounts());
  };

  return (
    <Ctx.Provider value={{
      session, accounts: store.accounts, activeAnimaId: store.activeAnimaId, ready,
      register, login, recoverWithWallet, recoverWithTelegram, switchAccount, goAnonymous, signOutActive, signOutAll,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used within SessionProvider');
  return v;
}
