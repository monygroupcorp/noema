import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { useSession } from '../state/session';
import { AuthApiError } from '../lib/api';
import { markOnboarded } from '../lib/entry';
import { Wordmark } from '../ui/Wordmark';
import type { Execution } from '../lib/idents';
import './onboard.css';

// Auth / onboarding — the front door (auth-spec.md, render noema-auth.png). Two equal,
// honest doors: BRING AN IDENTITY (named) vs STAY ANONYMOUS (bearer purse — funding-side anonymity).
// The door sets the IDENTITY axis (who we are to you); compute custody (what we see of the
// work) is a per-run choice — said in the footer, never set here.
//
// Door A now carries the REAL fiat session (username/password rail): "Continue with a
// username" expands inline into a sign-in / create-account form (useSession). No email —
// registering logs you straight in. Wallet sign-up is live (it mints an account from a signature alone, no username); Passkey is not. Door B
// (anonymous) is the bearer identity skin — funding-side anonymity, our compute.
//
// ADDITIVE MODE (`/onboard?add=1`, Keyring Decision 3): reached via "Add account" from the
// Keyring / account menu. The multi-session store APPENDS a login rather than replacing, so
// this flag only governs copy + where we land afterwards (back to /keyring, not /app).

const MIN_PASSWORD = 8;
const MIN_USERNAME = 3;

export function Onboard() {
  const { setExecution } = useIdentity();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const addMode = params.get('add') === '1';

  // Anon entry (Door B): the anon commitment path is a session with no account, so there's
  // nothing to set beyond the execution mode — funding derives from the (absent) session.
  const enter = (exec: Execution) => {
    setExecution(exec);       // session mode; custody is still per-run inside the app
    markOnboarded();
    navigate(addMode ? '/keyring' : '/app');
  };

  return (
    <div className="auth-root">
      <header className="auth-head">
        <Wordmark height={26} />
        {addMode ? (
          <>
            <h1 className="auth-display">Add another account.</h1>
            <p className="auth-sub">Your current account stays signed in — this one joins your keyring, and you switch between them freely.</p>
          </>
        ) : (
          <>
            <h1 className="auth-display">Make anything.<br />Anonymously.</h1>
            <p className="auth-sub">Choose how you enter — you decide what we can know.</p>
          </>
        )}
      </header>

      <div className="auth-doors">
        {/* Door A — bring an identity (real account) */}
        <IdentityDoor addMode={addMode} />

        {/* Door B — stay anonymous (slate / dashed hemisphere) */}
        <section className="door anon">
          <div className="door-h">
            <span className="hemi dashed" aria-hidden="true" />
            <h2>Stay anonymous</h2>
          </div>
          <p className="door-d">No account — browse and make anonymously on our compute. Fund a bearer purse from a shielded wallet to spend without a name attached.</p>
          <button className="door-cta slate" onClick={() => enter('rented')}>Enter anonymously →</button>
          <button className="door-opt" disabled title="Coming soon"><Ic name="venetian-mask" /> Set up a purse <span className="opt-meta">coming soon</span></button>
          <p className="door-warn">* a purse is anonymous only if funded from a shielded wallet. A doxxed source links you to us at funding time — permanently.</p>
          <div className="door-knows"><span className="hemi dashed sm" aria-hidden="true" /> noema knows: <b>nothing*</b></div>
        </section>
      </div>

      <footer className="auth-foot">your door sets who you are to us — every run executes on our compute</footer>
    </div>
  );
}

// Door A: collapsed (buttons) → username form (sign in / create). On success the session
// context adopts a live session; here we mark the named profile + onboarded and enter the app.
function IdentityDoor({ addMode }: { addMode: boolean }) {
  const { login, register, signUpWithWallet, recoverWithWallet, recoverWithTelegram } = useSession();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'collapsed' | 'signin' | 'register'>('collapsed');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tgRecover, setTgRecover] = useState(false);   // reveal the Telegram code input
  const [tgCode, setTgCode] = useState('');

  // Wallet-first SIGNUP (collapsed door): connect + sign, mint-if-absent, land in the app.
  async function onSignUpWallet() {
    reset(); setBusy(true);
    try { await signUpWithWallet(); done(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function onRecoverWallet() {
    reset(); setBusy(true);
    try { await recoverWithWallet(); done(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function onRecoverTelegram() {
    if (!tgCode.trim()) return;
    reset(); setBusy(true);
    try { await recoverWithTelegram(tgCode.trim()); done(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const reset = () => { setErr(null); };
  // session is live; land in the app, or back on the keyring when adding an account.
  const done = () => { markOnboarded(); navigate(addMode ? '/keyring' : '/app'); };

  async function onSignin(e: FormEvent) {
    e.preventDefault();
    reset(); setBusy(true);
    try {
      await login(username.trim(), password);
      done();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    reset();
    if (username.trim().length < MIN_USERNAME) { setErr(`Username must be at least ${MIN_USERNAME} characters.`); return; }
    if (password.length < MIN_PASSWORD) { setErr(`Password must be at least ${MIN_PASSWORD} characters.`); return; }
    if (password !== confirm) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try { await register(username.trim(), password); done(); }   // register logs you straight in
    catch (e) {
      if (e instanceof AuthApiError && e.code === 'conflict.registration') setErr('That username is taken — try another, or sign in.');
      else setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  return (
    <section className="door">
      <div className="door-h">
        <span className="hemi lit" aria-hidden="true" />
        <h2>Bring an identity</h2>
      </div>

      {mode === 'collapsed' && (
        <>
          <p className="door-d">Sign in or create an account — just a username, no email. Synced across web, Telegram, and the API — pick up anywhere.</p>
          {err && <div className="warn">{err}</div>}
          <button className="door-cta primary" onClick={() => { reset(); setMode('signin'); }}>Continue with a username</button>
          <button className="door-opt" disabled={busy} onClick={onSignUpWallet}><Ic name="wallet" /> {busy ? 'Connecting…' : 'Wallet'}</button>
          <button className="door-opt" disabled title="Coming soon"><Ic name="key-round" /> Passkey <span className="opt-meta">coming soon</span></button>
          <div className="door-knows"><span className="hemi lit sm" aria-hidden="true" /> noema knows: <b>it's you</b></div>
        </>
      )}

      {mode === 'signin' && (
        <form className="door-auth" onSubmit={onSignin}>
          <p className="door-d">Sign in to your account.</p>
          {err && <div className="warn">{err}</div>}
          <input className="byo-input" type="text" required placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" aria-label="username" />
          <input className="byo-input" type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-label="password" />
          <button className="door-cta primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button type="button" className="door-opt" disabled={busy} onClick={onRecoverWallet}><Ic name="wallet" /> Recover with a linked wallet</button>
          {tgRecover ? (
            <div className="door-auth" style={{ gap: 8 }}>
              <input className="byo-input" type="text" placeholder="Paste the code from the bot" value={tgCode} onChange={(e) => setTgCode(e.target.value)} aria-label="Telegram recovery code" />
              <button type="button" className="door-cta primary" disabled={busy || !tgCode.trim()} onClick={onRecoverTelegram}>{busy ? 'Recovering…' : 'Recover'}</button>
            </div>
          ) : (
            <button type="button" className="door-opt" disabled={busy} onClick={() => { reset(); setTgRecover(true); }}><Ic name="send" /> Recover with Telegram</button>
          )}
          <div className="link-row">
            <button type="button" className="linkish" onClick={() => { reset(); setMode('register'); }}>Create an account</button>
          </div>
          <p className="auth-note">Forgot your password? Recover with a wallet or Telegram you linked in your profile — there's no email reset. For Telegram, open our bot and send <b>/recover</b>.</p>
          <p className="auth-note">Work or credits from anonymous browsing stay with that anonymous session — they don't move into your account.</p>
        </form>
      )}

      {mode === 'register' && (
        <form className="door-auth" onSubmit={onRegister}>
          <p className="door-d">Create your account — one identity across web, Telegram, and the API. No email required.</p>
          {err && <div className="warn">{err}</div>}
          <input className="byo-input" type="text" required placeholder={`username (min ${MIN_USERNAME} chars)`} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" aria-label="username" />
          <input className="byo-input" type="password" required placeholder={`Password (min ${MIN_PASSWORD} chars)`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" aria-label="password" />
          <input className="byo-input" type="password" required placeholder="Confirm password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-label="confirm password" />
          <button className="door-cta primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          <p className="auth-note">Keep your password safe — add a Telegram or wallet backup in your profile so you can recover the account.</p>
          <div className="link-row">
            <button type="button" className="linkish" onClick={() => { reset(); setMode('signin'); }}>I already have an account</button>
          </div>
        </form>
      )}
    </section>
  );
}
