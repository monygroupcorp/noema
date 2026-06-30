import { useNavigate } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { useIdentity } from '../state/identity';
import { markOnboarded } from '../lib/entry';
import { Wordmark } from '../ui/Wordmark';
import type { Execution } from '../lib/idents';
import './onboard.css';

// Auth / onboarding — the front door (auth-spec.md, render noema-auth.png). Two equal,
// honest doors: BRING AN IDENTITY (named) vs STAY ANONYMOUS (local off-grid / guided Bursa).
// The door sets the IDENTITY axis (who we are to you); compute custody (what we see of the
// work) is a per-run choice — said in the footer, never set here.
//
// Wiring preserved from the prior handoff: each entry sets the durable profile (funding) +
// the session execution mode, marks onboarded, and drops into the app shell.
export function Onboard() {
  const { setIdentity, setExecution } = useIdentity();
  const navigate = useNavigate();

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
        {/* Door A — bring an identity (lit hemisphere) */}
        <section className="door">
          <div className="door-h">
            <span className="hemi lit" aria-hidden="true" />
            <h2>Bring an identity</h2>
          </div>
          <p className="door-d">Sign in or create an account. Synced across web, Telegram, and the API — pick up anywhere.</p>
          <button className="door-cta primary" onClick={() => enter('studio', 'rented')}>Continue with email</button>
          <button className="door-opt" onClick={() => enter('studio', 'rented')}><Ic name="wallet" /> Wallet</button>
          <button className="door-opt" onClick={() => enter('studio', 'rented')}><Ic name="key-round" /> Passkey</button>
          <div className="door-knows"><span className="hemi lit sm" aria-hidden="true" /> noema knows: <b>it’s you</b></div>
        </section>

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
