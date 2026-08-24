import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SiteFooter } from './SiteFooter';
import { entryPath } from '../lib/entry';
import { api, type Pack } from '../lib/api';
import './landing.css'; // reuse .topnav / .btn chrome
import './doc.css';

// The public pricing page. The marketing prose is ported from content/pricing.md; the PACKS are
// rendered DYNAMICALLY from GET /v1/payments/packs (the single server catalog sourced from
// stripePacks.ts) — no hardcoded pack numbers — and each card has a real Buy CTA that routes into
// the existing Funding buy flow with the pack preselected (/funding?pack=<id>). Change a pack number
// in stripePacks.ts and this page updates automatically. The charged amount stays server-authoritative
// (keyed by packId at checkout); this page only DISPLAYS and starts the flow.
const fmt = (n: number) => n.toLocaleString('en-US');

export function Pricing() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let live = true;
    api.listPacks()
      .then((p) => { if (live) setPacks(p); })
      .catch(() => { if (live) setErr(true); });
    return () => { live = false; };
  }, []);

  return (
    <div className="doc-page">
      <nav className="topnav">
        <Link to="/landing" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="dot" />noema
        </Link>
        <div className="right">
          <Link className="btn-ghost" to="/features">Features</Link>
          <Link className="btn-ghost" to="/pricing">Pricing</Link>
          <Link className="btn" to={entryPath()}>Open app</Link>
        </div>
      </nav>

      <article className="prose">
        <h1>Simple pricing. Spend credits anywhere.</h1>
        <p>
          Credits are your compute currency. Spend them on any modality. No subscription — buy a
          pack, spend it whenever.
        </p>

        <h2>Buy a credit pack. No subscription.</h2>
        <p>
          Credits work across every modality — text generation, image generation, video, and audio.
          You buy once, spend anywhere. Credits don't expire. Bigger packs give you a better rate —
          roughly 208 to 270 credits per dollar depending on the pack you choose, cheapest pack to
          biggest.
        </p>
        <p>
          Anonymity here is a property of how you fund. Pay by card and it's identified; fund
          from a fresh or shielded on-chain wallet and there's no identity behind the address.
          For spends nothing can tie back to you, mint a ZK purse from your balance (see below).
        </p>

        <h2>Packs</h2>
        {err && (
          <p>Pack pricing is momentarily unavailable — please refresh to load the latest packs.</p>
        )}
        <div
          className="pricing-packs"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '16px',
            margin: '8px 0 16px',
            listStyle: 'none',
          }}
        >
          {packs.map((p) => (
            <div
              key={p.id}
              style={{
                border: '1px solid var(--line, rgba(128,128,128,.25))',
                borderRadius: '12px',
                padding: '18px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <h3 style={{ margin: 0 }}>
                {p.label}
                {p.bestRate && (
                  <span style={{ fontWeight: 400, opacity: 0.7 }}> · best rate per credit</span>
                )}
              </h3>
              <div style={{ fontSize: '18px', fontWeight: 600 }}>
                ${p.usd} — {fmt(p.credits)} credits
              </div>
              <ul style={{ margin: 0, paddingLeft: '20px' }}>
                <li>Never expire</li>
                <li>No subscription, no recurring charge</li>
                <li>Mint a ZK purse to spend unlinkably</li>
                <li>Spend across every modality</li>
              </ul>
              <Link
                className="btn"
                to={`/funding?pack=${encodeURIComponent(p.id)}`}
                style={{ marginTop: 'auto' }}
              >
                Buy {p.label}
              </Link>
            </div>
          ))}
        </div>

        <h2>Private spending</h2>
        <p>
          Anonymity depends on how you fund. Fund from a fresh or shielded on-chain wallet and the
          address has no identity behind it. Then mint a ZK
          purse from your balance: its spends are cryptographically unlinkable to what you funded.
          Minting a purse needs a signed-in account, so it's an unlinkable spend layer on top of an
          identified balance — strongest when you fund from a shielded wallet. Direct-to-commitment
          deposits, where we never see the funding wallet, are on the roadmap.
        </p>
        <p>
          <Link to="/funding">How purse works →</Link>
        </p>

        <h2>FAQ</h2>
        <h3>Do credits expire?</h3>
        <p>No. Credits purchased directly never expire.</p>

        <h3>Can I get a refund?</h3>
        <p>
          Yes, within limits. Unused credits are refundable within 14 days of purchase. Once credits
          have been spent, in whole or in part, the spent portion is non-refundable — they're a
          prepaid compute balance, not a subscription. If you have an issue, contact us and we'll
          work it out.
        </p>

        <h3>What's the difference between a purse credit and a regular credit?</h3>
        <p>
          Functionally identical — both buy the same compute, same GPU, same models. The difference
          is the billing layer: a regular credit is tied to your account, while a purse credit spends
          from a ZK bearer token whose spends are cryptographically unlinkable to how it was funded.
          How anonymous the funding itself was still depends on your funding source — a shielded
          wallet reveals no identity; a card is identified.
        </p>

        <h3>Do you offer a free trial?</h3>
        <p>
          There's no free tier. The Starter pack ($10) is the low-cost way to try it, and the
          credits never expire, so there's no clock running against you.
        </p>

        <h3>Can I use the API anonymously?</h3>
        <p>
          Yes. Pass a <code>x-bursa-token</code> header instead of a session key. The API docs
          explain how to generate one.
        </p>
      </article>
      <SiteFooter />
    </div>
  );
}
