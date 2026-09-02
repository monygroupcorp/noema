import { useState, type FormEvent } from 'react';
import { Ic } from '../lib/icons';
import { useSession } from '../state/session';
import { AuthApiError } from '../lib/api';
import { markOnboarded } from '../lib/entry';

// AccountModal — the in-place account gate an anonymous Muse session hits at execution
// (rth's ruling, 2026-09-02: browse and configure freely with no account; the account, then a
// top-up, are asked for only at the point something would actually spend). A lighter-weight
// sibling of Onboard.tsx's `IdentityDoor`, reusing the same `useSession()` register/login calls
// — deliberately NOT a navigation to /onboard, because leaving the screen would lose the very
// session state this modal exists to keep in view while the caller signs up.
//
// Username/password only (no email, matches Onboard.tsx) — wallet/Telegram are the recovery
// rails, not first-run options here; a caller who wants those already knows to use /onboard.

const MIN_PASSWORD = 8;
const MIN_USERNAME = 3;

export function AccountModal({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: () => void }) {
  const { login, register } = useSession();
  const [mode, setMode] = useState<'register' | 'signin'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const reset = () => setErr(null);
  const done = () => { markOnboarded(); onSuccess(); };

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    reset();
    if (username.trim().length < MIN_USERNAME) { setErr(`Username must be at least ${MIN_USERNAME} characters.`); return; }
    if (password.length < MIN_PASSWORD) { setErr(`Password must be at least ${MIN_PASSWORD} characters.`); return; }
    if (password !== confirm) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try { await register(username.trim(), password); done(); }
    catch (e) {
      if (e instanceof AuthApiError && e.code === 'conflict.registration') setErr('That username is taken — try another, or sign in.');
      else setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function onSignin(e: FormEvent) {
    e.preventDefault();
    reset();
    setBusy(true);
    try { await login(username.trim(), password); done(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-scrim" onClick={busy ? undefined : onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--panel)', border: '1px solid var(--hair)', borderRadius: 14,
          padding: 20, width: 'min(420px, 100%)', maxHeight: '86vh', overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <h2 style={{ margin: 0 }}>{mode === 'register' ? 'Save your spot' : 'Sign in'}</h2>
          <button className="btn ghost sm" type="button" onClick={onClose} disabled={busy} aria-label="Close"><Ic name="x" /></button>
        </div>
        <p className="sub" style={{ marginTop: 4, marginBottom: 14 }}>
          {mode === 'register'
            ? 'One more step to fire this — a free account, just a username, no email. Everything you\'ve set up here carries over.'
            : 'Sign in to continue.'}
        </p>

        {mode === 'register' ? (
          <form onSubmit={onRegister} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {err && <div className="sub" style={{ color: 'var(--danger, #d66f6f)' }}>{err}</div>}
            <input className="byo-input" type="text" required placeholder={`username (min ${MIN_USERNAME} chars)`} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" aria-label="username" disabled={busy} />
            <input className="byo-input" type="password" required placeholder={`password (min ${MIN_PASSWORD} chars)`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" aria-label="password" disabled={busy} />
            <input className="byo-input" type="password" required placeholder="confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-label="confirm password" disabled={busy} />
            <button className="btn accent" type="submit" disabled={busy}>{busy ? 'creating…' : 'Create account & continue'}</button>
            <button type="button" className="linkish" style={{ alignSelf: 'center' }} disabled={busy} onClick={() => { reset(); setMode('signin'); }}>I already have an account</button>
          </form>
        ) : (
          <form onSubmit={onSignin} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {err && <div className="sub" style={{ color: 'var(--danger, #d66f6f)' }}>{err}</div>}
            <input className="byo-input" type="text" required placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" aria-label="username" disabled={busy} />
            <input className="byo-input" type="password" required placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-label="password" disabled={busy} />
            <button className="btn accent" type="submit" disabled={busy}>{busy ? 'signing in…' : 'Sign in & continue'}</button>
            <button type="button" className="linkish" style={{ alignSelf: 'center' }} disabled={busy} onClick={() => { reset(); setMode('register'); }}>Create an account instead</button>
          </form>
        )}
      </div>
    </div>
  );
}
