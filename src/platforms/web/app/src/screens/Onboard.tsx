import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { useSession } from '../state/session';
import { AuthApiError, getAccounts } from '../lib/api';
import { markOnboarded } from '../lib/entry';
import { Wordmark } from '../ui/Wordmark';
import type { Execution } from '../lib/idents';
import './onboard.css';

// Auth / onboarding — the front door. Two equal, honest doors: BRING AN IDENTITY (named) vs
// STAY ANONYMOUS (bearer purse — funding-side anonymity). The door sets the IDENTITY axis (who
// we are to you); compute custody (what we see of the work) is a per-run choice — said in the
// footer, never set here.
//
// Door A carries the real fiat session (username/password rail). No email — registering logs
// you straight in, so the form IS the door: a visitor types a username and a password and is
// in. Wallet sign-up is live (it mints an account from a signature alone, no username); Passkey
// is not. Door B (anonymous) is the bearer identity skin — funding-side anonymity, our compute.
//
// ADDITIVE MODE (`/onboard?add=1`): reached via "Add account" from the Keyring / account menu.
// The multi-session store APPENDS a login rather than replacing, so this flag only governs copy
// and where we land afterwards (back to /keyring, not /app).
//
// RETURN (`?next=<path>`): a visitor sent here mid-task — pressing Buy on a pack without an
// account, say — is handed back to that exact task once the session is live, so the choice they
// already made is not one they make twice.

const MIN_PASSWORD = 8;
const MIN_USERNAME = 3;

// Only same-origin app paths are honoured as a return target: `next` arrives from the query
// string, so an absolute or protocol-relative URL would be an open redirect off the site.
export function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return null;
  return next;
}

export function Onboard() {
  const { setExecution } = useIdentity();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const addMode = params.get('add') === '1';
  const next = safeNext(params.get('next'));

  // Anon entry (Door B): the anon commitment path is a session with no account, so there's
  // nothing to set beyond the execution mode — funding derives from the (absent) session.
  const enter = (exec: Execution) => {
    setExecution(exec);       // session mode; custody is still per-run inside the app
    markOnboarded();
    navigate(next ?? (addMode ? '/keyring' : '/app'));
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
        <IdentityDoor addMode={addMode} next={next} />

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

// A password field with a reveal toggle. The toggle is not decoration: there is no email reset
// here, so a password typed with a typo is a lost account. Being able to READ what you typed is
// what a second "confirm" box was standing in for, in one field instead of two.
function PasswordField({ value, onChange, placeholder, autoComplete, disabled }: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: 'current-password' | 'new-password';
  disabled?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="pw-field">
      <input
        className="byo-input"
        type={shown ? 'text' : 'password'}
        required
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-label="password"
        disabled={disabled}
      />
      <button
        type="button"
        className="pw-reveal"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        tabIndex={-1}
      >
        <Ic name={shown ? 'eye-off' : 'eye'} />
      </button>
    </div>
  );
}

// Door A. The form is the door — there is no button that only reveals it. A visitor arriving at
// the front door has no account yet, so they land on CREATE; someone adding a second login to a
// keyring they already hold lands on SIGN IN. Either way the other is one click away.
function IdentityDoor({ addMode, next }: { addMode: boolean; next: string | null }) {
  const { login, register, signUpWithWallet, recoverWithWallet, recoverWithTelegram } = useSession();
  const navigate = useNavigate();
  // Which form opens. Read the held logins straight from the client store rather than from
  // session context: on a cold load of this page the provider has not hydrated yet, and a
  // returning visitor would be offered "create an account" for one they already have.
  const [mode, setMode] = useState<'signin' | 'register'>(
    addMode || getAccounts().accounts.length > 0 ? 'signin' : 'register',
  );
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);      // reveal the two recovery rails
  const [tgCode, setTgCode] = useState('');

  const reset = () => { setErr(null); };
  // The session is live; hand the visitor back to whatever sent them here, else into the app
  // (or back to the keyring when they were adding an account).
  const done = () => { markOnboarded(); navigate(next ?? (addMode ? '/keyring' : '/app')); };

  // Wallet-first SIGNUP: connect + sign, mint-if-absent, land wherever we were headed. A wallet
  // that is already bound logs into that same soul, so this button is both doors at once.
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
    setBusy(true);
    try { await register(username.trim(), password); done(); }   // register logs you straight in
    catch (e) {
      if (e instanceof AuthApiError && e.code === 'conflict.registration') setErr('That username is taken — try another, or sign in.');
      else setErr(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  // Switching between the two forms keeps what has been typed: the username and password a
  // visitor entered are the same ones they need on the other form.
  const swap = (to: 'signin' | 'register') => { reset(); setForgot(false); setMode(to); };

  return (
    <section className="door">
      <div className="door-h">
        <span className="hemi lit" aria-hidden="true" />
        <h2>Bring an identity</h2>
      </div>

      {mode === 'register' ? (
        <form className="door-auth" onSubmit={onRegister}>
          <p className="door-d">Create an account — just a username and a password, no email. One identity across web, Telegram, and the API.</p>
          {err && <div className="warn">{err}</div>}
          <input className="byo-input" type="text" required placeholder={`username (min ${MIN_USERNAME} chars)`} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" aria-label="username" disabled={busy} />
          <PasswordField value={password} onChange={setPassword} placeholder={`Password (min ${MIN_PASSWORD} chars)`} autoComplete="new-password" disabled={busy} />
          <button className="door-cta primary" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
          <button type="button" className="door-opt" disabled={busy} onClick={onSignUpWallet}><Ic name="wallet" /> {busy ? 'Connecting…' : 'Continue with a wallet'}</button>
          <button type="button" className="door-opt" disabled title="Coming soon"><Ic name="key-round" /> Passkey <span className="opt-meta">coming soon</span></button>
          <div className="link-row">
            <button type="button" className="linkish" onClick={() => swap('signin')}>I already have an account</button>
          </div>
          <p className="auth-note">There's no email reset — add a Telegram or wallet backup in your profile so you can recover this account.</p>
          <div className="door-knows"><span className="hemi lit sm" aria-hidden="true" /> noema knows: <b>it's you</b></div>
        </form>
      ) : (
        <form className="door-auth" onSubmit={onSignin}>
          <p className="door-d">Sign in to your account.</p>
          {err && <div className="warn">{err}</div>}
          <input className="byo-input" type="text" required placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" aria-label="username" disabled={busy} />
          <PasswordField value={password} onChange={setPassword} placeholder="Password" autoComplete="current-password" disabled={busy} />
          <button className="door-cta primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <button type="button" className="door-opt" disabled={busy} onClick={onSignUpWallet}><Ic name="wallet" /> Continue with a wallet</button>
          <div className="link-row">
            <button type="button" className="linkish" onClick={() => swap('register')}>Create an account</button>
            <button type="button" className="linkish" onClick={() => { reset(); setForgot((f) => !f); }} aria-expanded={forgot}>Forgot your password?</button>
          </div>

          {/* Recovery is folded away until asked for: it is the rarer path, and there are two of
              them, so unfolded it doubles the size of a form whose whole job is two fields. */}
          {forgot && (
            <div className="door-recover">
              <p className="auth-note" style={{ marginTop: 0 }}>There's no email reset. Recover with a wallet or a Telegram account you linked in your profile — for Telegram, open our bot and send <b>/recover</b>.</p>
              <button type="button" className="door-opt" disabled={busy} onClick={onRecoverWallet}><Ic name="wallet" /> Recover with a linked wallet</button>
              <div className="pw-field">
                <input className="byo-input" type="text" placeholder="Paste the code from the bot" value={tgCode} onChange={(e) => setTgCode(e.target.value)} aria-label="Telegram recovery code" disabled={busy} />
              </div>
              <button type="button" className="door-opt" disabled={busy || !tgCode.trim()} onClick={onRecoverTelegram}><Ic name="send" /> {busy ? 'Recovering…' : 'Recover with Telegram'}</button>
            </div>
          )}

          <p className="auth-note">Work or credits from anonymous browsing stay with that anonymous session — they don't move into your account.</p>
          <div className="door-knows"><span className="hemi lit sm" aria-hidden="true" /> noema knows: <b>it's you</b></div>
        </form>
      )}
    </section>
  );
}
