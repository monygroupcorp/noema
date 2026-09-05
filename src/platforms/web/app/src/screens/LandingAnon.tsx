import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { api } from '../lib/api';

/**
 * What anonymity the platform actually gives you, gated on whether it gives it yet.
 *
 * This block used to say, in the present tense, "deposit, join the anonymity set, and spend with
 * a zero-knowledge proof — we never learn your wallet". Both halves were ahead of the system.
 * The bearer purse is switched off until the trusted-setup ceremony concludes (ANON_PURSE_ENABLED
 * is off by default and POST /arcanum/purse refuses a mint), and the depositing address does
 * reach us through the deposit provider and is kept for sanctions screening — which /about,
 * /features, /pricing and the privacy policy all say plainly. The loudest page on the site was
 * the one page contradicting them.
 *
 * So it reads the switch, the way Pricing.tsx does: `enabled` from GET /arcanum/config. Unknown
 * and unreachable both read as off, because the honest failure for a privacy claim is to
 * under-claim, never to promise a protection we cannot confirm is switched on.
 */
export function LandingAnon() {
  // null = not yet known, and treated exactly like off until it is.
  const [purseEnabled, setPurseEnabled] = useState<boolean | null>(null);
  const purseOff = purseEnabled !== true;

  useEffect(() => {
    let live = true;
    api.arcanum.config()
      .then((c) => { if (live) setPurseEnabled(c.enabled === true); })
      .catch(() => { if (live) setPurseEnabled(false); });
    return () => { live = false; };
  }, []);

  return (
    <section className="lp-anon">
      <div className="lp-anon-in">
        <span className="lp-anon-tag mono">
          <Ic name="eye-off" /> {purseOff ? 'as little of you as we can hold' : 'anonymous by construction'}
        </span>
        {purseOff ? (
          <>
            <h2>We never ask who you are.</h2>
            <p>
              There is no email address anywhere in signing up — an account is a username and a
              password. Fund from a fresh or shielded on-chain wallet and no identity sits behind
              the address, though the address itself reaches us and is kept for sanctions
              screening. The bearer purse that unlinks a spend from the account it came from is
              written and switched off; it opens when the trusted-setup ceremony concludes.
              Generation runs on external providers today; hardware-sealed compute is on the
              roadmap, not in the product.
            </p>
          </>
        ) : (
          <>
            <h2>Nobody has to know it was you.</h2>
            <p>
              Mint a bearer purse from your balance and spend it with a zero-knowledge proof — we
              verify the math and dispatch the compute, and cannot tie that spend to your account
              or to anything you spent before. How you funded it is a separate question: a fresh
              or shielded wallet puts no identity behind the address, though the address itself
              reaches us and is kept for sanctions screening. Generation runs on external
              providers today; hardware-sealed compute is on the roadmap, not in the product.
            </p>
          </>
        )}
        <span className="lp-anon-links">
          <Link className="btn-ghost" to="/about"><Ic name="file-text" /> Read the architecture</Link>
          {purseOff && (
            <Link className="btn-ghost" to="/ceremony"><Ic name="key-round" /> The ceremony</Link>
          )}
          <Link className="btn-ghost" to="/legal/privacy"><Ic name="eye-off" /> Privacy policy</Link>
        </span>
      </div>
    </section>
  );
}
