import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { useSession } from '../state/session';
import { api, AuthApiError } from '../lib/api';
import { markOnboarded } from '../lib/entry';
import { Wordmark } from '../ui/Wordmark';
import type { Execution } from '../lib/idents';
import './onboard.css';

// Auth / onboarding — the front door (auth-spec.md, render noema-auth.png). Two equal,
// honest doors: BRING AN IDENTITY (named) vs STAY ANONYMOUS (local off-grid / guided Bursa).
// The door sets the IDENTITY axis (who we are to you); compute custody (what we see of the
// work) is a per-run choice — said in the footer, never set here.
//
// Door A now carries the REAL fiat session (username/password rail): "Continue with email"
// expands inline into a sign-in / create-account form (useSession). Wallet/Passkey remain
// cosmetic placeholders. Door B (anonymous) stays the local/bearer identity skin.

const MIN_PASSWORD = 8;

export function Onboard() {
  const { setIdentity, setExecution } = useIdentity();
  const navigate = useNavigate();

  // Cosmetic entry (anon door + wallet/passkey placeholders): set the durable profile +
  // session execution mode, mark onboarded, drop into the app shell.
  const enter = (ident: string, exec: Execution) => {
    setIdentity(ident);       // 'studio' = named · 'untitled' = bearer
    setExecution(exec);       // session mode; custody is still per-run inside the app
    markOnboarded();
    navigate('/app');
  };

  return (
    <div className="auth-root">
      <header className="auth-head">
        <Wordmark height={26} />
        <h1 className="auth-display">Make anything.<br />We never have to see it.</h1>
        <p className="auth-sub">Choose how you enter — you decide what we can know.</p>
      </header>

      <div className="auth-doors">
        {/* Door A — bring an identity (real account) */}
        <IdentityDoor enter={enter} />

        {/* Door B — stay anonymous (slate / dashed hemisphere) */}
        <section className="door anon">
          <div className="door-h">
            <span className="hemi dashed" aria-hidden="true" />
            <h2>Stay anonymous</h2>
          </div>
          <p className="door-d">No account. Run on your own machine — nothing ever leaves — or fund a bearer purse to use our compute without a name.</p>
          <button className="door-cta slate" onClick={() => enter('untitled', 'local')}>Enter local · off-grid →</button>
          <button className="door-opt" onClick={() => enter('untitled', 'rented')}><Ic name="venetian-mask" /> Set up a Bursa <span className="opt-meta">pay anonymously</span></button>
          <p className="door-warn">* a Bursa is anonymous only if funded from a shielded wallet. A doxxed source links you to us at funding time — permanently.</p>
          <div className="door-knows"><span className="hemi dashed sm" aria-hidden="true" /> noema knows: <b>nothing*</b></div>
        </section>
      </div>

      <footer className="auth-foot">your door sets who you are to us — compute custody (local · TEE · remote) is your call on every run</footer>
    </div>
  );
}

// Door A: collapsed (buttons) → email form (sign in / create). On login/verify success the
// session context navigates; here we mark the named profile + onboarded and enter the app.
function IdentityDoor({ enter }: { enter: (ident: string, exec: Execution) => void }) {
  const { login, register } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'collapsed' | 'signin' | 'register'>('collapsed');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const [sent, setSent] = useState(false);          // register → "check your email"
  const [busy, setBusy] = useState(false);

  const reset = () => { setErr(null); setUnverified(false); setResent(false); };

  async function onSignin(e: FormEvent) {
    e.preventDefault();
    reset(); setBusy(true);
    try {
      await login(email.trim(), password);
      markOnboarded();
      navigate('/app');            // session is live; enter identified
    } catch (e) {
      if (e instanceof AuthApiError && e.code === 'auth.email_unverified') { setUnverified(true); setErr('Verify your email before signing in.'); }
      else setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    reset();
    if (password.length < MIN_PASSWORD) { setErr(`Password must be at least ${MIN_PASSWORD} characters.`); return; }
    if (password !== confirm) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try { await register(email.trim(), password); setSent(true); }
    catch (e) {
      if (e instanceof AuthApiError && e.code === 'conflict.registration') setErr('Could not create the account. Try signing in, or reset your password.');
      else setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function resend() {
    try { await api.auth.resendVerification(email.trim()); setResent(true); } catch { setResent(true); }
  }

  return (
    <section className="door">
      <div className="door-h">
        <span className="hemi lit" aria-hidden="true" />
        <h2>Bring an identity</h2>
      </div>

      {mode === 'collapsed' && (
        <>
          <p className="door-d">Sign in or create an account. Synced across web, Telegram, and the API — pick up anywhere.</p>
          <button className="door-cta primary" onClick={() => { reset(); setMode('signin'); }}>Continue with email</button>
          <button className="door-opt" onClick={() => enter('studio', 'rented')}><Ic name="wallet" /> Wallet</button>
          <button className="door-opt" onClick={() => enter('studio', 'rented')}><Ic name="key-round" /> Passkey</button>
          <div className="door-knows"><span className="hemi lit sm" aria-hidden="true" /> noema knows: <b>it's you</b></div>
        </>
      )}

      {mode !== 'collapsed' && sent && (
        <>
          <p className="door-d"><Ic name="send" /> We sent a verification link to <b>{email.trim()}</b>. Click it to activate your account and sign in.</p>
          <button className="door-opt" onClick={resend}>Resend link</button>
          <button className="door-cta primary" onClick={() => { setSent(false); setMode('signin'); }}>Back to sign in</button>
        </>
      )}

      {mode === 'signin' && !sent && (
        <form className="door-auth" onSubmit={onSignin}>
          <p className="door-d">Sign in to your account.</p>
          {err && <div className="warn">{err}</div>}
          {unverified && (
            <div className="auth-note">
              {resent ? 'Verification email sent — check your inbox.'
                : <>Didn't get the link? <span className="linkish" role="button" tabIndex={0} onClick={resend} style={{ color: 'var(--accent-soft)', cursor: 'pointer', textDecoration: 'underline' }}>Resend verification</span>.</>}
            </div>
          )}
          <input className="byo-input" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-label="email" />
          <input className="byo-input" type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-label="password" />
          <button className="door-cta primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <div className="link-row">
            <button type="button" className="linkish" onClick={() => { reset(); setMode('register'); }}>Create an account</button>
            <Link to="/forgot-password">Forgot password?</Link>
          </div>
          <p className="auth-note">Work or credits from anonymous browsing stay with that anonymous session — they don't move into your account.</p>
        </form>
      )}

      {mode === 'register' && !sent && (
        <form className="door-auth" onSubmit={onRegister}>
          <p className="door-d">Create your account — one identity across web, Telegram, and the API.</p>
          {err && <div className="warn">{err}</div>}
          <input className="byo-input" type="email" required placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" aria-label="email" />
          <input className="byo-input" type="password" required placeholder={`Password (min ${MIN_PASSWORD} chars)`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" aria-label="password" />
          <input className="byo-input" type="password" required placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-label="confirm password" />
          <button className="door-cta primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          <div className="link-row">
            <button type="button" className="linkish" onClick={() => { reset(); setMode('signin'); }}>I already have an account</button>
          </div>
        </form>
      )}
    </section>
  );
}
