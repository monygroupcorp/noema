import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SiteFooter } from './SiteFooter';
import { entryPath } from '../lib/entry';
import { api, type ArcanumConfig, type Pack } from '../lib/api';
import { purseIsOff } from '../lib/purseSwitch';
import './landing.css'; // reuse .topnav / .btn chrome
import './doc.css';

// The public pricing page. The PACKS are rendered DYNAMICALLY from GET /v1/payments/packs (the
// single server catalog sourced from stripePacks.ts) — no hardcoded pack numbers — and each card
// has a real Buy CTA that routes into the existing Funding buy flow with the pack preselected
// (/funding?pack=<id>). Change a pack number in stripePacks.ts and this page updates automatically.
// The charged amount stays server-authoritative (keyed by packId at checkout); this page only
// DISPLAYS and starts the flow.
//
// The ZK purse copy is gated the same way Funding.tsx gates it: on `enabled` from GET
// /arcanum/config (ANON_PURSE_ENABLED, noema-131), read through `purseIsOff` so every page that
// makes the offer decides it the same way. The rail is off until the trusted-setup ceremony runs
// and POST /arcanum/purse refuses to mint, so a page that offers minting outright sells a
// visitor something the server refuses. While it is off the purse is absent from the lede, the
// pack cards and the API answer, and the one sentence that says what it waits on sits under
// "Private spending" (DESIGN.md D-63, P-1b), never a line that promises it for later.
const fmt = (n: number) => n.toLocaleString('en-US');

// What a credit buys, in the unit the ledger measures. A display credit is ten impetus, and one
// impetus is one billed second of pod time at the platform's reference pod rate
// (src/ledger/rates.ts: IMPETUS_USD_RATE, REFERENCE_COST_PER_HR), so a credit is ten seconds
// of GPU time. The image count comes from the one text-to-image flow with a cost curve fitted
// from its own settled runs (src/crystal/seeds/essentiae.ts, the `sd1-5` pretium): at the
// default 512², 20 steps a run bills about 86 s when the pod has to load the weights first and
// about 20 s on a pod that already holds them. The cold figure is the one quoted, so the count
// on a card is a floor a buyer can hold us to, not a best case.
const GPU_SECONDS_PER_CREDIT = 10;
const SD15_COLD_CREDITS_PER_IMAGE = 8.6;
const gpuHours = (credits: number) => Math.round((credits * GPU_SECONDS_PER_CREDIT) / 3600);
const sd15Images = (credits: number) => Math.floor(credits / SD15_COLD_CREDITS_PER_IMAGE / 10) * 10;

export function Pricing() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [err, setErr] = useState(false);
  // null = not yet known, and `purseIsOff` reads that as off, as it reads an unreachable config.
  const [purse, setPurse] = useState<ArcanumConfig | null>(null);
  const purseOff = purseIsOff(purse);

  useEffect(() => {
    let live = true;
    api.listPacks()
      .then((p) => { if (live) setPacks(p); })
      .catch(() => { if (live) setErr(true); });
    api.arcanum.config()
      .then((c) => { if (live) setPurse(c); })
      .catch(() => {});
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
          Anonymity here is a property of how you fund. Pay by card and it's identified. Fund from
          a fresh or shielded on-chain wallet and no identity sits behind the address, though the
          address itself reaches us through our deposit provider and is kept for sanctions
          screening — the{' '}
          <Link to="/legal/privacy">privacy policy</Link> says exactly what is retained.
          {!purseOff && ' For spends nothing can tie back to you, mint a ZK purse from your balance (see below).'}
        </p>

        <h2>Packs</h2>
        <p>
          A credit is ten seconds of GPU time at the reference pod rate, and a run is charged the
          pod time it actually took. The image counts below are floors: they assume every run
          loads its weights first, and a pod that is already warm bills a fraction of that.
        </p>
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
              <p style={{ margin: 0, color: 'var(--muted)' }}>
                About {gpuHours(p.credits)} hours of GPU time: at least {fmt(sd15Images(p.credits))}{' '}
                Stable Diffusion 1.5 images at the default settings, more on a warm pod.
              </p>
              <ul style={{ margin: 0, paddingLeft: '20px' }}>
                <li>Never expire</li>
                <li>No subscription, no recurring charge</li>
                {!purseOff && <li>Mint a ZK purse to spend unlinkably</li>}
                <li>Spend across every modality</li>
              </ul>
              <Link
                className={p.bestRate ? 'btn' : 'btn-ghost'}
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
          Anonymity depends on how you fund. A fresh or shielded on-chain wallet puts no identity
          behind the address — that is the strong-anonymity path available today. It is not
          invisibility: the depositing address reaches us through our deposit provider and we keep
          it for sanctions screening, as the <Link to="/legal/privacy">privacy policy</Link> sets
          out. A card is identified outright.
        </p>
        <p>
          {purseOff ? (
            <>
              Spending from a ZK bearer purse that is linked to no account waits on one thing: the
              trusted-setup <Link to="/ceremony">ceremony</Link>, which produces a proving key
              nobody controls. Until it has run, minting is refused and every credit is an
              account-tied credit.
            </>
          ) : (
            <>
              On top of that, mint a ZK purse from your balance: its spends are cryptographically
              unlinkable to what you funded. Minting a purse needs a signed-in account, so it's an
              unlinkable spend layer over an identified balance — strongest when you fund from a
              shielded wallet.
            </>
          )}
        </p>
        {!purseOff && (
          <p>
            <Link to="/funding">How purse works →</Link>
          </p>
        )}

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
          They are functionally identical — both buy the same compute, same GPU, same models. The
          difference is the billing layer: a regular credit is tied to your account, while a purse
          credit spends from a bearer token minted out of a balance, so whoever holds the token is
          the caller.{' '}
          {purseOff
            ? 'Today that token is still tied to the account that minted it.'
            : 'A ZK purse goes further: its spends are cryptographically unlinkable to how it was funded.'}{' '}
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
          You can fund it anonymously today, by depositing from a shielded or fresh on-chain wallet
          — no identity sits behind the address, though we do keep the address itself for sanctions
          screening. Calls authenticate with a session key, or with a purse token in an{' '}
          <code>x-bursa-token</code> header; that purse is still tied to the account that minted it.
          {!purseOff && ' A ZK bearer purse linked to no account spends unlinkably.'}{' '}
          The contract is self-describing and public:{' '}
          <a href="/v1/openapi.json" target="_blank" rel="noreferrer">
            <code>GET /v1/openapi.json</code>
          </a>
          .
        </p>
      </article>
      <SiteFooter />
    </div>
  );
}
