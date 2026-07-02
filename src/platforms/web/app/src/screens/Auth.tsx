import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { Wordmark } from '../ui/Wordmark';
import { api, AuthApiError } from '../lib/api';
import { useSession } from '../state/session';
import './onboard.css';

// The auth screens the email links land on — verify-email + reset-password (paths
// fixed by the backend) plus forgot-password. The primary sign-in / create entry
// lives inline in the Onboard front door; these are the standalone token handlers.
// They reuse the onboard "door" aesthetic — no separate auth surface.

const MIN_PASSWORD = 8;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// A single centered door on the standalone onboarding backdrop.
function TokenShell({ children }: { children: ReactNode }) {
  return (
    <div className="auth-root">
      <header className="auth-head"><Wordmark height={26} /></header>
      <div className="door auth-token">{children}</div>
    </div>
  );
}

const input = (props: React.InputHTMLAttributes<HTMLInputElement>) =>
  <input className="byo-input" style={{ width: '100%' }} {...props} />;

// ── /verify-email?token=… — auto-login on the emailed link ──────────────────────
export function VerifyEmail() {
  const { verifyEmail } = useSession();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'verifying' | 'ok' | 'error'>('verifying');
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (!token) { setState('error'); setErr('This verification link is missing its token.'); return; }
    let live = true;
    verifyEmail(token)
      .then(() => { if (!live) return; setState('ok'); setTimeout(() => navigate('/app'), 900); })
      .catch((e) => { if (!live) return; setState('error'); setErr(errMsg(e)); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function resend(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    try { await api.auth.resendVerification(email.trim()); } catch { /* always-202 */ }
    setResent(true);
  }

  return (
    <TokenShell>
      {state === 'verifying' && <><h2>Verifying…</h2><p className="door-d">Confirming your email address.</p></>}
      {state === 'ok' && <><h2><Ic name="check" /> You're in</h2><p className="door-d">Email verified. Taking you to the app…</p></>}
      {state === 'error' && (
        <>
          <h2>Link invalid or expired</h2>
          <p className="door-d">{err || 'This verification link is no longer valid.'}</p>
          {resent ? (
            <p className="door-d">If that email exists and is unverified, a fresh link is on its way.</p>
          ) : (
            <form onSubmit={resend} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {input({ type: 'email', required: true, placeholder: 'you@example.com', value: email, onChange: (e) => setEmail(e.target.value), autoComplete: 'email', 'aria-label': 'email to resend verification to' })}
              <button className="door-cta primary" type="submit">Resend link</button>
            </form>
          )}
          <div className="auth-alt"><Link to="/onboard">Back to sign in</Link></div>
        </>
      )}
    </TokenShell>
  );
}

// ── /forgot-password — request a reset link ─────────────────────────────────────
export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await api.auth.forgot(email.trim()); } catch { /* always-202, never reveal */ }
    finally { setBusy(false); setSent(true); }
  }

  return (
    <TokenShell>
      {sent ? (
        <>
          <h2><Ic name="send" /> Check your email</h2>
          <p className="door-d">If an account exists for <b>{email.trim()}</b>, we sent a link to reset your password.</p>
          <div className="auth-alt"><Link to="/onboard">Back to sign in</Link></div>
        </>
      ) : (
        <>
          <h2>Reset your password</h2>
          <p className="door-d">Enter your email and we'll send a reset link.</p>
          <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {input({ type: 'email', required: true, placeholder: 'you@example.com', value: email, onChange: (e) => setEmail(e.target.value), autoComplete: 'email', 'aria-label': 'email' })}
            <button className="door-cta primary" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
          </form>
          <div className="auth-alt"><Link to="/onboard">Back to sign in</Link></div>
        </>
      )}
    </TokenShell>
  );
}

// ── /reset-password?token=… — set a new password from the emailed link ──────────
export function ResetPassword() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!token) { setErr('This reset link is missing its token.'); return; }
    if (password.length < MIN_PASSWORD) { setErr(`Password must be at least ${MIN_PASSWORD} characters.`); return; }
    if (password !== confirm) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try { await api.auth.reset(token, password); setDone(true); setTimeout(() => navigate('/onboard'), 1100); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(false); }
  }

  return (
    <TokenShell>
      {done ? (
        <><h2><Ic name="check" /> Password reset</h2><p className="door-d">Your password has been changed. Taking you to sign in…</p></>
      ) : (
        <>
          <h2>Choose a new password</h2>
          <p className="door-d">Enter a new password for your account.</p>
          {err && <div className="warn">{err}</div>}
          <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {input({ type: 'password', required: true, placeholder: `New password (min ${MIN_PASSWORD} chars)`, value: password, onChange: (e) => setPassword(e.target.value), autoComplete: 'new-password', 'aria-label': 'new password' })}
            {input({ type: 'password', required: true, placeholder: 'Confirm new password', value: confirm, onChange: (e) => setConfirm(e.target.value), autoComplete: 'new-password', 'aria-label': 'confirm new password' })}
            <button className="door-cta primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</button>
          </form>
          <div className="auth-alt"><Link to="/onboard">Back to sign in</Link></div>
        </>
      )}
    </TokenShell>
  );
}
