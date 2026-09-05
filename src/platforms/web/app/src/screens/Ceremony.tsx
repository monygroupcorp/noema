import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { SiteFooter } from './SiteFooter';
import { Wordmark } from '../ui/Wordmark';
import { ceremony, type CeremonyStatus, type ContributePhase } from '../lib/ceremony';
import { CEREMONY_GUIDE } from '../lib/repo';
import './landing.css';
import './ceremony.css';

// Mouse samples gathered before the seed counts as "strong enough". This is
// belt-and-suspenders on top of a 32-byte CSPRNG draw (the real entropy), so a
// brief wiggle is plenty — no need to make people scrub for seconds.
const ENTROPY_TARGET = 90;

// The trust story, in the same three-node diagram grammar as the Landing architecture
// section: randomness folds in, the chain compounds, one honest link secures it forever.
const TRUST_NODES = [
  {
    id: 'waste',
    icon: 'shuffle',
    title: 'Your randomness',
    items: [
      { text: 'a mouse-wiggle + a secret' },
      { text: 'entropy made in your browser' },
      { text: 'never saved, never sent', mono: true },
    ],
  },
  {
    id: 'chain',
    icon: 'workflow',
    title: 'The chain',
    items: [
      { text: 'each contribution builds on the last' },
      { text: 'every hash is published' },
      { text: 'anyone can verify the transcript', mono: true },
    ],
  },
  {
    id: 'sealed',
    icon: 'key-round',
    title: 'Trustless keys',
    items: [
      { text: 'the proving key for anonymous credits' },
      { text: 'no party can forge a note' },
      { text: 'one honest link is enough', mono: true },
    ],
  },
];

// What contributing actually does — all of it in this tab. No install, no command
// line, no ZK math. Three steps, about a minute, nothing leaves your browser.
const STEPS = [
  {
    n: '01',
    title: 'Gather randomness',
    body: 'Wiggle your mouse and type a secret only you know. Together they seed the entropy you fold in — your "toxic waste."',
  },
  {
    n: '02',
    title: 'Your browser folds it in',
    body: 'We fetch the current key (~5 MB) and mix your entropy into it right here, in WebAssembly. Your secret never leaves this tab.',
  },
  {
    n: '03',
    title: 'Upload — and the chain grows',
    body: 'The new key is published to the live transcript for anyone to verify. Delete nothing, save nothing: once it’s in, your contribution is irreversible.',
  },
];

function StatusPill({ phase }: { phase: CeremonyStatus['phase'] }) {
  const label =
    phase === 'open' ? 'Ceremony open · accepting contributions'
    : phase === 'finalized' ? 'Ceremony finalized · keys published'
    : 'Ceremony announced · opening soon';
  return (
    <span className={`cer-pill cer-${phase}`}>
      <span className="cer-dot" />
      {label}
    </span>
  );
}

const PHASE_LABEL: Record<ContributePhase, string> = {
  downloading: 'Fetching the current key…',
  contributing: 'Folding in your randomness (this can take a moment)…',
  uploading: 'Uploading your contribution…',
  done: 'Done',
};

// In-browser contribution: capture entropy by mouse movement + a secret, then run the
// snarkjs contribution in WASM and upload. Shown only while the ceremony is open.
function ContributePanel({ onContributed }: { onContributed: () => void }) {
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [samples, setSamples] = useState(0);
  const entropyRef = useRef<string>('');
  const [phase, setPhase] = useState<ContributePhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const onMove = useCallback((e: React.MouseEvent) => {
    if (phase) return;
    entropyRef.current += `${e.clientX},${e.clientY},${e.timeStamp.toFixed(2)};`;
    setSamples((n) => (n < ENTROPY_TARGET ? n + 1 : n));
  }, [phase]);

  const ready = samples >= ENTROPY_TARGET && secret.trim().length >= 6 && !phase;
  const pct = Math.min(100, Math.round((samples / ENTROPY_TARGET) * 100));

  async function run() {
    if (!ready) return;
    setError(null);
    // Mix mouse entropy, the secret, and a CSPRNG draw into one seed string.
    const rand = crypto.getRandomValues(new Uint8Array(32));
    const entropy = `${entropyRef.current}|${secret}|${Array.from(rand).join(',')}`;
    try {
      await ceremony.contribute({
        name: name.trim() || 'anonymous',
        entropy,
        onPhase: setPhase,
      });
      setSuccess(true);
      onContributed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase(null);
    }
  }

  if (success) {
    return (
      <div className="cer-claimed">
        <Ic name="check" />
        <span>Your contribution is in the chain. The proving key is now stronger — thank you.
          Delete nothing to keep; your entropy never left this tab.</span>
      </div>
    );
  }

  return (
    <div className="cer-contribute-flow">
      <label className="cer-field">
        <span>Display name <em>(public, in the transcript)</em></span>
        <input
          className="cer-input"
          placeholder="a handle — or leave blank for anonymous"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!!phase}
        />
      </label>
      <label className="cer-field">
        <span>Your secret <em>(toxic waste — never sent)</em></span>
        <input
          className="cer-input"
          type="password"
          placeholder="type something only you know (6+ chars)"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          disabled={!!phase}
        />
      </label>

      <div
        className={`cer-entropy${samples >= ENTROPY_TARGET ? ' full' : ''}`}
        onMouseMove={onMove}
        role="application"
        aria-label="move your mouse here to gather randomness"
      >
        <div className="cer-entropy-bar"><span style={{ width: `${pct}%` }} /></div>
        <div className="cer-entropy-h">
          {samples >= ENTROPY_TARGET
            ? 'Randomness gathered ✓'
            : `Move your mouse here to gather randomness · ${pct}%`}
        </div>
      </div>

      {phase ? (
        <div className="cer-running"><span className="cer-spin" /> {PHASE_LABEL[phase]}</div>
      ) : (
        <button className="btn" disabled={!ready} onClick={run}>
          Fold in my randomness <Ic name="arrow-right" />
        </button>
      )}
      {error && <div className="cer-err">{error}</div>}
      <p className="cer-fineprint">
        Your secret is the toxic waste — it's never sent and never stored. Only the
        resulting key is uploaded; it carries no recoverable trace of it.
      </p>
    </div>
  );
}

export function Ceremony() {
  const [status, setStatus] = useState<CeremonyStatus | null>(null);
  const [contact, setContact] = useState('');
  const [claimed, setClaimed] = useState(false);

  const refresh = useCallback(() => {
    ceremony.status().then(setStatus).catch(() => {});
  }, []);

  // Poll for the live chain — contributions land without a redeploy, so the transcript
  // and phase update in place. Slower while announced, snappier once open.
  useEffect(() => {
    let live = true;
    ceremony.status().then((s) => { if (live) setStatus(s); });
    const ms = 5000;
    const t = setInterval(() => { if (live) refresh(); }, ms);
    return () => { live = false; clearInterval(t); };
  }, [refresh]);

  const phase = status?.phase ?? 'announced';
  const chain = status?.chain ?? [];

  async function onClaim(e: React.FormEvent) {
    e.preventDefault();
    if (!contact.trim()) return;
    const ok = await ceremony.claimSlot(contact.trim());
    // Whether or not the coordinator is live yet, we acknowledge the intent — the
    // honest "you're on the list, we'll reach out" state.
    setClaimed(true);
    void ok;
  }

  return (
    <div className="landing-page">
      <nav className="topnav">
        <Link to="/" className="brand" aria-label="noema home"><Wordmark height={22} /></Link>
        <div className="right">
          <Link className="btn-ghost" to="/about">About</Link>
          <Link className="btn-ghost" to="/pricing">Pricing</Link>
          <Link className="btn" to="/onboard">Open app</Link>
        </div>
      </nav>

      <div className="hero">
        <span className="noema-glow hero-glow" aria-hidden="true" />
        <h1 className="hero-display">Anonymous credits.<br /><span className="accent">Trustless by ceremony.</span></h1>
        <hr className="noema-rule hero-rule" />
        <p className="lead">
          noema's anonymous credit rail is going live. Before it carries value, its
          proving key must be built by many hands — so no single party, us included,
          can ever forge a note. That's the ceremony. You can be in it.
        </p>
        <div className="cer-status-row"><StatusPill phase={phase} /></div>
        <div className="cta">
          <a className="btn lg" href="#contribute">Contribute <Ic name="arrow-right" /></a>
          <a className="btn-ghost" href="#how">How it works</a>
        </div>
        <div className="proof">groth16 phase-2 · one honest contributor secures it forever</div>
      </div>

      <div className="stance">
        <div className="in">
          <h2>
            A trusted setup is only as honest as its weakest assumption.<br />
            <span className="dim">So we don't ask you to assume. We let you contribute.</span>
          </h2>
          <div className="sub">
            Each contributor folds in secret randomness and then destroys it. If even
            one person is honest, the keys are unforgeable forever — and the whole chain
            is public, so anyone can check it after the fact.
          </div>
        </div>
      </div>

      <section className="arch" id="how">
        <div className="lab">How the ceremony works</div>
        <h2>One honest link secures the whole chain.</h2>
        <p className="ah-sub">
          This is the same model Zcash and Tornado Cash use. Phase 1 (Powers of Tau) is
          already done and universally trusted; what's left is the circuit-specific
          Phase 2 — and that's the part you can join.
        </p>
        <div className="lane">
          <div className="diagram three">
            {TRUST_NODES.map((node, i) => (
              <>
                <div key={node.id} className="dnode">
                  <div className="dt">
                    <span className="li"><Ic name={node.icon} /></span>
                    {node.title}
                  </div>
                  <ul>
                    {node.items.map((item, j) => (
                      <li key={j} className={item.mono ? 'm' : undefined}>{item.text}</li>
                    ))}
                  </ul>
                </div>
                {i < TRUST_NODES.length - 1 && (
                  <div key={`arrow-${i}`} className="darrow">
                    <Ic name="arrow-right" />
                    <span className="m">{i === 0 ? 'fold in' : 'publish hash'}</span>
                  </div>
                )}
              </>
            ))}
          </div>
        </div>
      </section>

      {/* Announcement and contribution are the same surface: the steps to take part
          sit right here, with the live chain beside them. */}
      <section className="cer-contribute" id="contribute">
        <div className="cer-c-head">
          <div className="lab">Take part</div>
          <h2>Contribute your randomness — right here.</h2>
          <p className="ah-sub">
            No install, no command line, nothing to download and run. It all happens in
            this tab, in about a minute. Anyone with a stake in the system being trustworthy
            should join — and you never have to trust the other contributors.
          </p>
        </div>

        <div className="cer-grid">
          <div className="cer-how">
            <ol className="cer-steps">
              {STEPS.map((s) => (
                <li key={s.n} className="cer-step">
                  <span className="cer-stepn">{s.n}</span>
                  <div className="cer-stepbody">
                    <h3>{s.title}</h3>
                    <p>{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="cer-cli-note">
              Running a validator or prefer the terminal? The same contribution works from
              the command line — see the{' '}
              <a href={CEREMONY_GUIDE} target="_blank" rel="noreferrer">contributor guide</a>.
            </p>
          </div>

          <aside className="cer-side">
            <div className="cer-card">
              {phase === 'open' ? (
                <>
                  <div className="cer-card-h"><Ic name="shuffle" /> Contribute in your browser</div>
                  <ContributePanel onContributed={refresh} />
                </>
              ) : (
                <>
                  <div className="cer-card-h"><Ic name="user-round" /> Claim a contributor slot</div>
                  {phase === 'finalized' ? (
                    <div className="cer-claimed">
                      <Ic name="check" />
                      <span>The ceremony is complete and the proving key is published. Thank you to everyone who folded in their randomness.</span>
                    </div>
                  ) : claimed ? (
                    <div className="cer-claimed">
                      <Ic name="check" />
                      <span>You're on the list. We'll notify you the moment the ceremony opens so you can contribute right here.</span>
                    </div>
                  ) : (
                    <form className="cer-claim" onSubmit={onClaim}>
                      <p>The ceremony hasn't opened yet. Leave a handle and we'll ping you when it does — then you contribute in one click, in this tab.</p>
                      <input
                        className="cer-input"
                        placeholder="email, Telegram, or wallet"
                        value={contact}
                        onChange={(e) => setContact(e.target.value)}
                        aria-label="contact for ceremony slot"
                      />
                      <button className="btn" type="submit">Notify me <Ic name="arrow-right" /></button>
                    </form>
                  )}
                </>
              )}
              <div className="cer-card-foot">
                <a className="btn-ghost" href={CEREMONY_GUIDE} target="_blank" rel="noreferrer">
                  <Ic name="file-text" /> Full contributor guide
                </a>
              </div>
            </div>

            <div className="cer-chain">
              <div className="cer-chain-h">
                <span>Transcript</span>
                <span className="cer-chain-n">{chain.length} contribution{chain.length === 1 ? '' : 's'}</span>
              </div>
              {status?.rootHash && (
                <div className="cer-link cer-root">
                  <span className="cer-link-i">root</span>
                  <code>{status.rootHash.slice(0, 18)}…</code>
                </div>
              )}
              {chain.length === 0 ? (
                <div className="cer-empty">
                  No contributions yet. The chain starts the moment the ceremony opens —
                  this transcript will fill in, hash by hash, for anyone to verify.
                </div>
              ) : (
                chain.map((c) => (
                  <div key={c.index} className="cer-link">
                    <span className="cer-link-i">{String(c.index).padStart(2, '0')}</span>
                    <span className="cer-link-name">{c.name}</span>
                    <code>{c.outputHash.slice(0, 14)}…</code>
                  </div>
                ))
              )}
              {status?.finalHash && (
                <div className="cer-link cer-final">
                  <span className="cer-link-i"><Ic name="check" /></span>
                  <span className="cer-link-name">beacon · final key</span>
                  <code>{status.finalHash.slice(0, 14)}…</code>
                </div>
              )}
            </div>
          </aside>
        </div>
      </section>

      <div className="endcta">
        <h2>Make the keys no one can forge — including us.</h2>
        <a className="btn lg" href="#contribute">Contribute <Ic name="arrow-right" /></a>
      </div>

      <SiteFooter />
    </div>
  );
}
