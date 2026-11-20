import { authHeaders, getSession, readHeaders } from './session';

// Session envelope returned by verify-email/login/refresh.
export interface Session { token: string; tokenType: 'Bearer'; expiresIn: number }
export interface AuthResult { session: Session; animaId: string }

// Auth errors carry the backend's `error.code` so screens can branch (auth.invalid,
// conflict.registration, input.malformed, …).
export class AuthApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'AuthApiError';
    this.code = code;
    this.status = status;
  }
}
async function jAuth<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new AuthApiError(body?.error?.code ?? `http.${res.status}`, body?.error?.message ?? res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

// ── Fiat auth (username/password rail) ───────────────────────────────────────
// Anonymous username+password — NO email. Register logs you in immediately (mints a
// session). These deliberately do NOT send a commitment (a named account is a different
// soul than the anon purse); refresh carries the bearer. Errors surface via AuthApiError.code.
// Account recovery (forgot password) is via backup channels bound in the profile, not email.
const authApi = {
  register: (username: string, password: string) =>
    fetch('/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
      .then(jAuth<AuthResult>),
  login: (username: string, password: string) =>
    fetch('/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
      .then(jAuth<AuthResult>),
  refresh: () =>
    fetch('/v1/auth/session/refresh', { method: 'POST', headers: { authorization: `Bearer ${getSession() ?? ''}` } })
      .then(jAuth<AuthResult>),

  // ── Wallet backup / recovery channel ───────────────────────────────────────
  // challenge → sign the returned `statement` → link (authed, binds to your soul) or
  // recover (public, logs into the soul the wallet is bound to). listWallets is authed.
  walletChallenge: (address: string) =>
    fetch('/v1/auth/wallet/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) })
      .then(jAuth<{ token: string; statement: string }>),
  walletLink: (challengeToken: string, signature: string) =>
    fetch('/v1/auth/wallet/link', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ challengeToken, signature }) })
      .then(jAuth<{ address: string; moved?: boolean }>),
  walletRecover: (challengeToken: string, signature: string) =>
    fetch('/v1/auth/wallet/recover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeToken, signature }) })
      .then(jAuth<AuthResult>),
  // Wallet-FIRST signup (public): prove a wallet with no username/password. Mints an account
  // bound to the wallet if it's unknown, or logs into the existing soul if already bound.
  walletRegister: (challengeToken: string, signature: string) =>
    fetch('/v1/auth/wallet/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challengeToken, signature }) })
      .then(jAuth<AuthResult>),
  listWallets: () =>
    fetch('/v1/auth/wallet', { headers: readHeaders() }).then(jAuth<{ wallets: string[] }>),

  // ── Telegram backup / recovery channel ─────────────────────────────────────
  // challenge (authed) → open the deepLink in Telegram + tap Start to bind. status (authed)
  // reflects whether it's linked. recover (public) redeems a code the bot handed the user.
  telegramChallenge: () =>
    fetch('/v1/auth/telegram/challenge', { method: 'POST', headers: authHeaders(), body: '{}' })
      .then(jAuth<{ code: string; deepLink?: string; botUsername?: string }>),
  telegramStatus: () =>
    fetch('/v1/auth/telegram', { headers: readHeaders() }).then(jAuth<{ linked: boolean }>),
  telegramRecover: (code: string) =>
    fetch('/v1/auth/telegram/recover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
      .then(jAuth<AuthResult>),
  // A Mini App launch (the bot's Buy credits button) → a session, verified by Telegram's signature.
  telegramWebApp: (initData: string) =>
    fetch('/v1/auth/telegram/webapp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ initData }) })
      .then(jAuth<AuthResult>),
};

export default authApi;
