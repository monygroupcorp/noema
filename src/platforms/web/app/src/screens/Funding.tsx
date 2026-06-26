import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';

// Credit packs — pay-as-you-go top-ups. On the honest ledger these live on the
// anonymous rail (a bearer purse is PAYG-only; it can't hold a subscription).
const PACKS = [
  { id: 'starter', credits: '1,000', price: '$5' },
  { id: 'plus', credits: '5,000', price: '$20' },
  { id: 'pro', credits: '25,000', price: '$80' },
];

type Sees = 'nothing' | 'pseudonym' | 'you';

// Identity-axis hemisphere — same glyph grammar as the canvas visibility meter,
// but here it reads WHO we learn you are, not what we see of the work:
//   nothing* = dashed ring (slate) · a pseudonym = plain ring (slate) · you = lit (gold).
function Hemisphere({ sees }: { sees: Sees }) {
  const lit = sees === 'you';
  const stroke = lit ? '#d9be8f' : '#7d8aa6';
  return (
    <svg className="fund-hemi" viewBox="0 0 24 24" aria-hidden="true">
      {lit && <path d="M12,2 A10 10 0 0 0 12,22 Z" fill="#d9be8f" />}
      <circle cx="12" cy="12" r="10" fill="none" stroke={stroke} strokeWidth="1.4"
        strokeDasharray={sees === 'nothing' ? '2.4 2.4' : undefined} />
    </svg>
  );
}

function Meter({ sees, label }: { sees: Sees; label: string }) {
  return (
    <div className={`fund-meter sees-${sees}`}>
      <Hemisphere sees={sees} />
      <span className="fm-val">sees: {label}</span>
    </div>
  );
}

// Inline alert glyph (kept local so we don't touch the shared icon registry).
function WarnIc() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function Funding() {
  const [pack, setPack] = useState('plus');

  return (
    <AppShell crumb="add credits">
      <div className="page"><div className="pw narrow fund">

        <div className="fund-head">
          <div className="fund-kicker">Add credits</div>
          <h1>Every way to pay — and what each one reveals.</h1>
          <div className="sub">
            We tell you exactly what we learn about you on each path. Privacy on the
            funding side is real, but it's <b>yours to keep</b> — so here's how.
          </div>
        </div>

        <div className="fund-rows">

          {/* Row 1 · Anonymous rail — the differentiator and its caveat, expanded. */}
          <section className="fund-row">
            <div className="fund-rowhead">
              <div className="fund-ic slate"><Ic name="venetian-mask" /></div>
              <div className="fund-rowmain">
                <div className="fund-titleline">
                  <h3>Anonymous rail</h3>
                  <span className="fund-flag">◌ ours alone</span>
                </div>
                <p className="fund-desc">
                  Mint a bearer purse and spend it down. The purse itself carries no
                  name, no account, no recovery — and it can't be linked to your runs.
                </p>
              </div>
              <div className="fund-aside">
                <Meter sees="nothing" label="nothing*" />
              </div>
            </div>

            <div className="fund-guide">
              <div className="fund-guide-h">
                <Hemisphere sees="nothing" />
                * keeping it anonymous is on you — fund it right
              </div>
              <ol className="fund-guide-pts">
                <li>
                  <span className="fg-n">01</span>
                  <span>
                    Fund the purse from a <b>shielded or fresh wallet</b> — not a KYC
                    exchange withdrawal and not your main wallet.
                  </span>
                </li>
                <li>
                  <span className="fg-n">02</span>
                  <span>
                    The purse is a <b>bearer token</b>: once minted it's unlinkable to
                    your generations, and we can't recover or freeze it.
                  </span>
                </li>
              </ol>
            </div>

            <div className="warn fund-warn">
              <WarnIc />
              <span>
                Pay from a <b>doxxed wallet</b> and that payment ties your identity to us{' '}
                <b>at the moment you mint</b> — permanently, even if you never spend a
                single credit. Anonymity starts upstream of us.
              </span>
            </div>

            <div className="fund-actions">
              <div className="filters">
                {PACKS.map((p) => (
                  <button
                    key={p.id}
                    className={`fchip${pack === p.id ? ' on' : ''}`}
                    onClick={() => setPack(p.id)}
                  >
                    <span className="fc-cr">{p.credits}</span>
                    <span className="fc-pr">{p.price}</span>
                  </button>
                ))}
              </div>
              <Link className="btn-ghost" to="/vault">
                <Ic name="venetian-mask" /> Mint a purse <Ic name="arrow-right" />
              </Link>
            </div>
          </section>

          {/* Row 2 · Onchain wallet — a pseudonym, not a person. */}
          <section className="fund-row">
            <div className="fund-rowhead">
              <div className="fund-ic accent"><Ic name="wallet" /></div>
              <div className="fund-rowmain">
                <div className="fund-titleline">
                  <h3>Onchain wallet</h3>
                </div>
                <p className="fund-desc">
                  Connect a wallet. We see an address, not a person. Subscription or
                  pay-as-you-go.
                </p>
              </div>
              <div className="fund-aside">
                <Meter sees="pseudonym" label="a pseudonym" />
                <button className="btn-ghost">
                  Connect <Ic name="arrow-right" />
                </button>
              </div>
            </div>
          </section>

          {/* Row 3 · Card — the fastest path; it sees you. */}
          <section className="fund-row">
            <div className="fund-rowhead">
              <div className="fund-ic gold"><Ic name="credit-card" /></div>
              <div className="fund-rowmain">
                <div className="fund-titleline">
                  <h3>Card</h3>
                </div>
                <p className="fund-desc">
                  Pay by card via Stripe. The fastest path. We see your name and card.
                  Subscription or pay-as-you-go.
                </p>
              </div>
              <div className="fund-aside">
                <Meter sees="you" label="you" />
                <button className="btn">
                  Pay with card <Ic name="arrow-right" />
                </button>
              </div>
            </div>
          </section>

        </div>

        <div className="warn" style={{ marginTop: 'var(--s7)' }}>
          Credits are a prepaid balance for compute on noema — not money.
          Non-transferable, non-withdrawable, redeemable only for runs here.
        </div>

      </div></div>
    </AppShell>
  );
}
