import { type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { LandingWordmark } from './LandingWordmark';
import { PlateDeck } from './PlateDeck';
import { ScrollStage } from './ScrollStage';
import { BeatRun, type Beat } from './BeatRun';
import { LandingCatalog } from './LandingCatalog';
import { LandingOpen } from './LandingOpen';
import { LandingModes } from './LandingModes';
import { LandingPricing } from './LandingPricing';
import { LandingAnon } from './LandingAnon';
import { platesIn, type PlateFormat } from './landingPlates';
import './landing-page.css';

/** Display faces the marketing surface can wear.
 *
 *  Geist is the baseline to judge against — and the default typeface of this entire product
 *  category, which is the problem. The three serifs are SIL Open Font License and span the
 *  contrast range deliberately, because the real question is whether a display serif survives a
 *  near-black ground or goes spindly on it. Venice.ai answers the same question on cream paper
 *  with Canela at weight 400; the ground is what makes it an open question here.
 *
 *  None of these is the final answer. Proving the seam is the point: a licensed face later is
 *  one `@font-face` and one token. */
const DISPLAY_FACES = ['fraunces', 'instrument', 'newsreader', 'geist', 'martian'] as const;
type DisplayFace = (typeof DISPLAY_FACES)[number];

const STAGGERS = [0, 18, 36];
const LEADINGS = [1.02, 1.12, 1.22];

/** The pathway beats. They share one lock and take turns, rather than costing a screen each. */
const BEATS: Beat[] = [
  {
    id: 'explore',
    n: '01',
    align: 'left',
    title: 'Never face a blank prompt',
    text: 'Bring a mood board and focus on style configuration while you generate the content you enjoy — endless variations, no writer\u2019s block.',
  },
  {
    id: 'train',
    n: '02',
    align: 'right',
    title: 'Train your own models',
    text: 'Only you know what looks good. Get your style right and share it with the world. Earn royalties on the platform when others work with it.',
  },
  {
    id: 'run',
    n: '03',
    align: 'left',
    title: 'Make the perfect workflow',
    text: 'Combine multiple workflows into one to get perfect results every time. Earn royalties on the platform when others use it.',
  },
];

/** The sequence, in the order it was actually driven, and each rung is a screen that exists:
 *  /datasets, /datasets/:id/caption, /datasets/:id/derive → /train/run/:id → /models, then the
 *  catalogue and the publish flows the split below pays out on.
 *
 *  Step 04 said "every workflow the catalogue carries", which the catalogue itself contradicts:
 *  a weight records the base family it is for (`familia`, surfaced as `basis`), and listing
 *  filters models by it, so a trained identity reaches the workflows built on its own base. */
const STEPS = [
  { n: '01', t: 'Bring material', d: 'Upload what you have, or make the source set here first.' },
  { n: '02', t: 'Caption it', d: 'The set is described so a model can be taught from it.' },
  { n: '03', t: 'Train', d: 'A LoRA on a base of your choosing. It lands on your shelf.' },
  { n: '04', t: 'Make with it', d: 'Your trigger works in every workflow built on the base you trained.' },
  { n: '05', t: 'Publish it', d: 'Put the model, the workflow or the collection out — and start earning on it.' },
];

/** The royalty split, read from the hooks that pay it: `spellRoyalty.ts` takes 10% of a run's
 *  impetus for the workflow's author, `modelRoyalty.ts` takes 5% for the authors of the models
 *  that ran. Both are registered on `execution_spend` and firing in production. */
const SPLIT = [
  { pct: '10%', who: 'to whoever wrote the workflow', sub: 'every run, for as long as people run it' },
  { pct: '5%', who: 'to the authors of the models it used', sub: 'split by how much each one did' },
  { pct: '15%', who: 'to you, if both are yours', sub: 'a workflow built on your own trained identity' },
];

/** The export destinations, from `EditioExport.tsx`. The bundle download works today; hosted
 *  tokenURIs are real but gated behind content-safety review; minting deploys separately. The
 *  page says which is which rather than flattening them into "mint your collection". */
const EXPORT = [
  { t: 'Take the bundle', d: 'Every approved piece and its metadata, as one download. Yours, nothing public.' },
  { t: 'Or let us host the URIs', d: 'noema serves the tokenURIs while you deploy. A bridge, not permanent storage — migrate before you rely on it.' },
];


const FOOTER = [
  { h: 'Make', links: [['Catalogue', '/catalog'], ['Run a workflow', '/run'], ['Collections', '/collections'], ['Canvas', '/canvas']] },
  { h: 'Train', links: [['Datasets', '/datasets'], ['Model shelf', '/models'], ['Teams', '/teams'], ['Projects', '/projects']] },
  { h: 'Account', links: [['Funding', '/funding'], ['Keyring', '/keyring'], ['Preferences', '/preferences'], ['Status', '/status']] },
  { h: 'Read', links: [['About', '/about'], ['Ceremony', '/ceremony'], ['Privacy', '/legal/privacy'], ['Terms', '/legal/terms']] },
];

/**
 * The coded design laboratory for the landing page.
 *
 * Not a public surface: the route is registered only in dev builds, so unfilled slots and draft
 * copy cannot reach a visitor. It exists so the page can be judged the only way a scroll page
 * can be — by scrolling it, in the real application, at the widths the capability proof is
 * argued at. The catalogue block reads live data through the dev proxy, so its numbers here are
 * the real ones.
 *
 * Every control in the bar is an open decision that is cheaper to settle by looking than by
 * specifying.
 */
/** How the page is dressed. Production ships the settled answers; the design lab passes its own
 *  so a decision stays reversible by looking rather than by editing. */
export interface LandingProps {
  face?: 'fraunces' | 'instrument' | 'newsreader' | 'geist' | 'martian';
  theme?: 'current' | 'editorial';
  cta?: 'blue' | 'ink' | 'outline';
  mark?: 'mono' | 'serif';
  crop?: PlateFormat;
  stagger?: number;
  scroll?: 'lock' | 'pass';
  leading?: number;
  /** Render the reserved geometry of slots that have no art yet. Dev-only: on the public page an
   *  empty run renders nothing at all, so a placeholder can never be seen by a visitor. */
  showPlaceholders?: boolean;
}

export function Landing({
  face = 'fraunces',
  theme = 'editorial',
  cta = 'ink',
  mark = 'serif',
  crop = '21:9',
  stagger = 18,
  scroll = 'lock',
  leading = 1.12,
  showPlaceholders = false,
}: LandingProps = {}) {
  const display = face;
  const mode = scroll;

  // How far the reader scrolls, in viewport heights, while a run is locked.
  const deckHold = (n: number) => (n - 1) * 0.45;
  const deck = (slots: ReturnType<typeof platesIn>, label: string, className?: string) => {
    // Ask the slots, not the element. A JSX element is always truthy, so testing it let an empty
    // run still get wrapped in a lock — two of them, each holding the reader through a whole
    // screen of scrolling past nothing.
    const filled = showPlaceholders ? slots : slots.filter((s) => s.source !== null);
    if (!filled.length) return null;
    const el = (
      <PlateDeck
        slots={slots}
        format={className ? undefined : crop}
        stagger={stagger}
        progress={mode}
        label={label}
        className={className}
        showPlaceholders={showPlaceholders}
      />
    );
    return mode === 'lock' ? <ScrollStage hold={deckHold(filled.length)}>{el}</ScrollStage> : el;
  };

  return (
    <div
        className={`lp lp-face-${display} lp-theme-${theme} lp-cta-${cta}`}
        style={{ '--hero-leading': String(leading) } as CSSProperties}
      >
        <nav className="lp-cand-nav">
          <span className="brand"><LandingWordmark face={mark} height={26} /></span>
          <span className="lp-cand-navlinks">
            <Link to="/catalog">Catalogue</Link>
            <Link to="/models">Models</Link>
            <Link to="/datasets">Training</Link>
            <Link to="/pricing">Pricing</Link>
          </span>
          <span className="right">
            <Link className="btn" to="/onboard">Open app</Link>
          </span>
        </nav>

        <header className="lp-cand-hero">
          <h1>Generative AI for sovereign creators</h1>
          <span className="lp-cand-kicker mono">contribute and earn compute</span>
          <hr className="noema-rule" />
          <p>
            Bring your taste, steer the culture of generative art on the new internet.
          </p>
          <span className="lp-cand-cta">
            <Link className="btn lg" to="/onboard">Get started <Ic name="arrow-right" /></Link>
            <Link className="btn-ghost" to="/catalog">Browse the catalogue</Link>
          </span>
          <span className="lp-cand-more" aria-hidden="true" />
        </header>

        {deck(platesIn('deck'), 'A run of work made in noema, passing')}

        <LandingCatalog />

        <LandingOpen />

        {mode === 'lock' ? (
          <ScrollStage hold={BEATS.length * 0.6}><BeatRun beats={BEATS} /></ScrollStage>
        ) : (
          <div className="lp-cand-flow"><BeatRun beats={BEATS} /></div>
        )}

        <LandingModes stagger={stagger} progress={mode} showPlaceholders={showPlaceholders} />

        <section className="lp-pay">
          <div className="lp-pay-in">
            <h2>Publish it, and it pays you back.</h2>
            <p className="lp-pay-sub">
              Every run pays a cut back to whoever made what it used. In credits — the same ones
              the platform runs on — so a model that stays useful keeps paying for whatever you
              make next.
            </p>
            <dl className="lp-pay-split">
              {SPLIT.map((row) => (
                <div key={row.pct}>
                  <dt>{row.pct}</dt>
                  <dd><span className="who">{row.who}</span><span className="sub">{row.sub}</span></dd>
                </div>
              ))}
            </dl>
          </div>
        </section>


        <section className="lp-how">
          <div className="lp-how-in">
            <h2>From a folder of references to something you can sell.</h2>
            <p className="lp-how-sub">The whole path, in the order you actually walk it.</p>
            <ol className="lp-how-steps">
              {STEPS.map((s) => (
                <li key={s.n}>
                  <span className="mono">{s.n}</span>
                  <h3>{s.t}</h3>
                  <p>{s.d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* The coda. A second, shorter pass so the imagery returns once without becoming a
            gallery — the slots and their briefs were written for it, and nothing rendered
            them, so a filled coda slot had nowhere to appear. */}
        {deck(platesIn('deck-coda'), 'A second, shorter run of work made in noema', 'lp-deck-coda')}

        <section className="lp-mint">
          <div className="lp-mint-in">
            <div className="lp-mint-copy">
              <h2>Finished work, ready for market.</h2>
              <p>
                A collection leaves as ERC-721 metadata — every approved piece, its traits, and a
                tokenURI your own contract can point at. You deploy the contract; noema does
                everything before it.
              </p>
              <ul className="lp-mint-list">
                {EXPORT.map((e) => (
                  <li key={e.t}><span className="t">{e.t}</span><span className="d">{e.d}</span></li>
                ))}
              </ul>
            </div>
            <div className="lp-mint-code" aria-label="How a hosted collection resolves">
              <div className="lp-mint-code-h mono">your contract</div>
              {/* the code panel scrolls sideways on a narrow screen, so it has to be reachable
                  by keyboard — an unfocusable scroll region is an axe failure and a real one. */}
              <pre className="mono" tabIndex={0}><code>{`baseURI   <your collection>/
tokenURI  <your collection>/<tokenId>.json`}</code></pre>
              <div className="lp-mint-code-f mono">
                hosting is a bridge, not permanent storage — migrate to Arweave or IPFS before you
                rely on these URIs
              </div>
            </div>
          </div>
        </section>


        <LandingPricing />

        <LandingAnon />


        {/* a closing CTA is not an argument that needs holding — it is a door. */}
        <section className="lp-cand-end">
          <div className="lp-beat">
            <h2>Come and build the catalogue.</h2>
            <p className="lp-cand-end-sub">
              Everything on this page was put here by someone. Add the next thing.
            </p>
            <span className="lp-beat-cta">
              <Link className="btn lg" to="/onboard">Get started <Ic name="arrow-right" /></Link>
            </span>
          </div>
        </section>

        <footer className="lp-cand-foot">
          <div className="lp-cand-foot-in">
            <div className="lp-cand-foot-brand"><LandingWordmark face={mark} height={22} /></div>
            {FOOTER.map((col) => (
              <div key={col.h} className="lp-cand-foot-col">
                <h3 className="mono">{col.h}</h3>
                <ul>
                  {col.links.map(([label, to]) => (
                    <li key={to}><Link to={to}>{label}</Link></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </footer>
    </div>
  );
}
