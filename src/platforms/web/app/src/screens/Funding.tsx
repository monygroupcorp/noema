import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';

const PACKS = [
  { id: 'starter', credits: '1,000', price: '$5' },
  { id: 'plus', credits: '5,000', price: '$20' },
  { id: 'pro', credits: '25,000', price: '$80' },
];

function Rung({ icon, title, sees, tone, desc, children }: {
  icon: string; title: string; sees: string; tone: string; desc: string; children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', gap: 'var(--s4)', border: '1px solid var(--hair)', borderRadius: 'var(--r-lg)', background: 'var(--panel)', padding: 'var(--s5)' }}>
      <div style={{ width: 42, height: 42, flex: '0 0 auto', borderRadius: 'var(--radius)', display: 'grid', placeItems: 'center', background: 'var(--accent-bg)', color: 'var(--accent-soft)' }}>
        <Ic name={icon} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{title}</h3>
          <span className="pill" style={{ color: tone, borderColor: 'var(--hair)' }}>noema sees: {sees}</span>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: 'var(--s2) 0 var(--s4)', lineHeight: 1.55 }}>{desc}</p>
        {children}
      </div>
    </div>
  );
}

export function Funding() {
  const [pack, setPack] = useState('plus');
  return (
    <AppShell crumb="add credits">
      <div className="page"><div className="pw narrow">
        <div className="pagehead"><div>
          <h1>Add credits</h1>
          <div className="sub">Three ways to fund. The more private the method, the less we know about you.</div>
        </div></div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
          <Rung icon="venetian-mask" title="Anonymous" sees="nothing" tone="var(--good)"
            desc="Deposit crypto into an unlinkable pool — credits land in a bearer purse no one can trace to you. The most private rung.">
            <Link className="btn-ghost" to="/vault"><Ic name="eye-off" /> Deposit anonymously</Link>
          </Rung>

          <Rung icon="wallet" title="Crypto account" sees="your wallet" tone="var(--muted)"
            desc="Connect a wallet and top up your signed-in account. We see your address, not your identity.">
            <button className="btn-ghost"><Ic name="wallet" /> Connect wallet</button>
          </Rung>

          <Rung icon="credit-card" title="Card" sees="your name + card" tone="#d9be8f"
            desc="Pay by card via Stripe — instant, works on mobile (Apple / Google Pay). A card identifies you, so it's only available on a signed-in account.">
            <div className="filters" style={{ marginBottom: 'var(--s3)' }}>
              {PACKS.map((p) => (
                <button key={p.id} className={`fchip${pack === p.id ? ' on' : ''}`} onClick={() => setPack(p.id)}>
                  {p.credits} · {p.price}
                </button>
              ))}
            </div>
            <button className="btn" disabled><Ic name="credit-card" /> Pay with card</button>
            <span style={{ marginLeft: 'var(--s3)', color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>Stripe checkout — wiring pending (see fiat-onramp spec)</span>
          </Rung>
        </div>

        <div className="warn" style={{ marginTop: 'var(--s6)' }}>
          Credits are a prepaid balance for compute on noema — not money. Non-transferable, non-withdrawable, redeemable only for runs here.
        </div>
      </div></div>
    </AppShell>
  );
}
