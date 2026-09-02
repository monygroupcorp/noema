import { Link } from 'react-router-dom';
import { useLandingCatalog } from './landingCatalog';
import './landing-pricing.css';

const fmt = (n: number) => n.toLocaleString('en-US');

/**
 * What it costs, and the page's fourth live-derived block.
 *
 * This slot was a marked gap for a long time, on the reasoning that no purchase had settled on
 * production so no number here was claimable. That confused two different claims. "People pay
 * us" is a claim about customers and is still not ours to make. "A pack costs ten dollars" is a
 * claim about our own price list, and the price list is served publicly, by the same catalogue
 * the checkout charges against — `stripePacks.PACKS`, keyed by `packId`, ratified numbers.
 *
 * So the block is read rather than written, like the catalogue counts, the roster and the API
 * facts before it. Change a pack in `stripePacks.ts` and this updates on the next page load.
 * Nothing here is a plan, a tier or a projection: it is the till, quoted.
 *
 * When the till cannot be reached the block renders nothing at all. An unreachable price list
 * is not a free product, and a marketing surface has no business guessing at what it charges.
 */
export function LandingPricing() {
  const { packs } = useLandingCatalog();
  if (packs.length === 0) return null;

  const best = packs.reduce((a, b) => (b.creditsPerUsd > a.creditsPerUsd ? b : a));

  return (
    <section className="lp-price">
      <div className="lp-price-in">
        <h2>Buy a pack. Spend it whenever.</h2>
        <p className="lp-price-sub">
          No subscription and no monthly seat — credits are a prepaid compute balance, they work
          across every modality, and they do not expire. Read from the pack catalogue when this
          page loads, never written into it.
        </p>

        <ol className="lp-price-ladder">
          {packs.map((p) => (
            <li key={p.id} className={p.id === best.id ? 'is-best' : undefined}>
              <span className="usd">${p.usd}</span>
              <span className="credits">{fmt(p.credits)} credits</span>
              <span className="rate mono">{Math.round(p.creditsPerUsd)} per dollar</span>
            </li>
          ))}
        </ol>

        {/* The ladder already shows the rate improving; saying which rung is the best rate is
            the one thing a reader would otherwise have to work out with a calculator. */}
        <p className="lp-price-note">
          A bigger pack buys a better rate — {Math.round(best.creditsPerUsd)} credits per dollar
          at ${best.usd}, against {Math.round(packs[0].creditsPerUsd)} at ${packs[0].usd}.
        </p>

        <span className="lp-price-links">
          <Link className="btn-ghost" to="/pricing">
            What a credit buys
          </Link>
          <Link className="btn-ghost" to="/funding">
            Fund from a wallet instead
          </Link>
        </span>
      </div>
    </section>
  );
}
