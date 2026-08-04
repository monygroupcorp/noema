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
          There is no account required to start, and no email. You can buy and spend credits
          anonymously (see below).
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
                <li>Anonymous purse purchase accepted</li>
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

        <h2>Anonymous billing</h2>
        <p>
          Don't want an account? Buy credits anonymously with crypto. Your spend is a zero-knowledge
          proof — we verify the math, dispatch your compute, and cannot link the transaction to you.
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
          Functionally identical — both buy the same compute. The difference is the billing layer: a
          regular credit is tied to your account; a purse credit is a ZK proof with no account
          association. Same GPU, same models — the difference is only whether the transaction links
          back to you.
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
