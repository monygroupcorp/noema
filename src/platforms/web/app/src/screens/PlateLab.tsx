import { useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { Wordmark } from '../ui/Wordmark';
import { PlateDeck } from './PlateDeck';
import { ScrollStage } from './ScrollStage';
import { LandingCatalog } from './LandingCatalog';
import { LandingOpen } from './LandingOpen';
import { DECK_FORMATS, PLATES, isPlaceholder, platesIn, type PlateFormat } from './landingPlates';
import './plate-lab.css';

const STAGGERS = [0, 18, 36];
const LEADINGS = [1.02, 1.12, 1.22];

/** The pathway beats, each locked to the viewport for as long as the reader stays. */
const BEATS = [
  {
    id: 'explore',
    n: '01',
    align: 'left',
    title: 'Never face a blank prompt',
    text: 'Pick the identities you like and a line of your own. Muse keeps making inside that world — the content varies, the taste does not. You curate instead of composing, which is the part that actually stops people.',
  },
  {
    id: 'train',
    n: '02',
    align: 'right',
    title: 'Train a visual identity',
    text: 'Teach a model the hand your work is in, and keep the model.',
  },
  {
    id: 'run',
    n: '03',
    align: 'left',
    title: 'Build a workflow worth keeping',
    text: 'Chain the steps once and run them forever. Publish it and other people can run it too.',
  },
];

/** The sequence, in the order it was actually driven. Draft — the truth pass rewrites these. */
const STEPS = [
  { n: '01', t: 'Bring material', d: 'Upload what you have, or make the source set here first.' },
  { n: '02', t: 'Caption it', d: 'The set is described so a model can be taught from it.' },
  { n: '03', t: 'Train', d: 'A LoRA on a base of your choosing. It lands on your shelf.' },
  { n: '04', t: 'Make with it', d: 'Your trigger works in every workflow the catalogue carries.' },
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

/** Where the page still has nothing honest to put. Rendered as marked gaps rather than filled
 *  with invented evidence — a fabricated testimonial is the one thing that cannot be walked
 *  back once it ships. */
const GAPS = [
  {
    id: 'proof',
    label: 'proof slot — customers, ratings, named artists',
    note: 'Competitors run logo bars, star ratings and artist stories here. We have none that are real. Stays empty until there are users to quote.',
  },
  {
    id: 'pricing',
    label: 'pricing slot — plans and numbers',
    note: 'Blocked: no purchase has ever settled on production, so no number here is claimable yet.',
  },
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
export function PlateLab() {
  const [font, setFont] = useState<'geist' | 'marquee'>('geist');
  const [leading, setLeading] = useState(1.12);
  const [crop, setCrop] = useState<PlateFormat>('21:9');
  const [stagger, setStagger] = useState(18);
  const [mode, setMode] = useState<'lock' | 'pass'>('lock');

  const filled = PLATES.filter((s) => !isPlaceholder(s)).length;
  const deckHold = (n: number) => (n - 1) * 0.55;

  const deck = (slots: typeof PLATES, label: string, className?: string) => {
    const el = (
      <PlateDeck
        slots={slots}
        format={className ? undefined : crop}
        stagger={stagger}
        progress={mode}
        label={label}
        className={className}
      />
    );
    return mode === 'lock' ? <ScrollStage hold={deckHold(slots.length)}>{el}</ScrollStage> : el;
  };

  // No two consecutive blocks sit the same way. Three centred beats in a row read as a template
  // however good the sentences are; the page's rhythm is carried by where things sit.
  const beat = (node: ReactNode, key: string, align: 'left' | 'right' | 'centre' = 'centre') => {
    const inner = <div className={`beat beat-${align}`}>{node}</div>;
    return mode === 'lock' ? (
      <ScrollStage key={key} hold={0.8}>{inner}</ScrollStage>
    ) : (
      <div key={key} className="cand-flow">{inner}</div>
    );
  };

  return (
    <div className="lab">
      <div className="lab-bar">
        <span className="lab-tag mono">design lab · not public</span>
        <span className="lab-meta mono">{filled}/{PLATES.length} plates · copy is draft</span>
        <span className="lab-ctl">
          <span className="mono">type</span>
          <button className={font === 'geist' ? 'on' : ''} onClick={() => setFont('geist')}>geist</button>
          <button className={font === 'marquee' ? 'on' : ''} onClick={() => setFont('marquee')}>marquee</button>
        </span>
        <span className="lab-ctl">
          <span className="mono">leading</span>
          {LEADINGS.map((l) => (
            <button key={l} className={l === leading ? 'on' : ''} onClick={() => setLeading(l)}>{l}</button>
          ))}
        </span>
        <span className="lab-ctl">
          <span className="mono">crop</span>
          {DECK_FORMATS.map((f) => (
            <button key={f} className={f === crop ? 'on' : ''} onClick={() => setCrop(f)}>{f}</button>
          ))}
        </span>
        <span className="lab-ctl">
          <span className="mono">stagger</span>
          {STAGGERS.map((v) => (
            <button key={v} className={v === stagger ? 'on' : ''} onClick={() => setStagger(v)}>{v}</button>
          ))}
        </span>
        <span className="lab-ctl">
          <span className="mono">scroll</span>
          <button className={mode === 'lock' ? 'on' : ''} onClick={() => setMode('lock')}>lock</button>
          <button className={mode === 'pass' ? 'on' : ''} onClick={() => setMode('pass')}>pass</button>
        </span>
      </div>

      <div className={`cand cand-type-${font}`} style={{ '--hero-leading': String(leading) } as CSSProperties}>
        <nav className="cand-nav">
          <span className="brand"><Wordmark height={22} /></span>
          <span className="cand-navlinks">
            <Link to="/catalog">Catalogue</Link>
            <Link to="/models">Models</Link>
            <Link to="/datasets">Training</Link>
            <Link to="/pricing">Pricing</Link>
          </span>
          <span className="right">
            <Link className="btn" to="/onboard">Open app</Link>
          </span>
        </nav>

        <header className="cand-hero">
          <h1>Your own material,<br /><span className="dim">a system you can use again.</span></h1>
          <hr className="noema-rule" />
          <p>
            Bring what you already have. Explore it, train on it, and make new work that carries
            the same hand.
          </p>
          <span className="cand-cta">
            <Link className="btn lg" to="/onboard">Get started <Ic name="arrow-right" /></Link>
            <Link className="btn-ghost" to="/catalog">Browse the catalogue</Link>
          </span>
        </header>

        {deck(platesIn('deck'), 'A run of work made in noema, passing')}

        <LandingCatalog />

        {BEATS.map((b) =>
          beat(
            <>
              <span className="beat-n mono">{b.n}</span>
              <h2>{b.title}</h2>
              <p>{b.text}</p>
            </>,
            b.id,
            b.align as 'left' | 'right',
          ),
        )}

        <section className="how">
          <div className="how-in">
            <h2>How a visual identity gets made.</h2>
            <p className="how-sub">The sequence, in the order it is actually driven.</p>
            <ol className="how-steps">
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

        {deck(platesIn('deck-coda'), 'A second run of work made in noema, passing', 'deck-coda')}

        <LandingOpen />

        <section className="mint">
          <div className="mint-in">
            <div className="mint-copy">
              <h2>Finished work, ready for market.</h2>
              <p>
                A collection leaves here as ERC-721 metadata — every approved piece, its traits,
                and a tokenURI your own contract can point at. You deploy the contract; noema
                does the part before it.
              </p>
              <ul className="mint-list">
                {EXPORT.map((e) => (
                  <li key={e.t}><span className="t">{e.t}</span><span className="d">{e.d}</span></li>
                ))}
              </ul>
            </div>
            <div className="mint-code" aria-label="How a hosted collection resolves">
              <div className="mint-code-h mono">your contract</div>
              {/* the code panel scrolls sideways on a narrow screen, so it has to be reachable
                  by keyboard — an unfocusable scroll region is an axe failure and a real one. */}
              <pre className="mono" tabIndex={0}><code>{`baseURI   <your collection>/
tokenURI  <your collection>/<tokenId>.json`}</code></pre>
              <div className="mint-code-f mono">
                hosting is a bridge, not permanent storage — migrate to Arweave or IPFS before you
                rely on these URIs
              </div>
            </div>
          </div>
        </section>

        <section className="pay">
          <div className="pay-in">
            <h2>Publish it, and it pays you back.</h2>
            <p className="pay-sub">
              Paid in credits — the same ones everything here runs on. Not cash, deliberately:
              a model that stays useful keeps paying for the work you make next.
            </p>
            <dl className="pay-split">
              {SPLIT.map((row) => (
                <div key={row.pct}>
                  <dt>{row.pct}</dt>
                  <dd><span className="who">{row.who}</span><span className="sub">{row.sub}</span></dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="anon">
          <div className="anon-in">
            <span className="anon-tag mono"><Ic name="eye-off" /> anonymous by construction</span>
            <h2>Fund it and make it without leaving a name.</h2>
            <p>
              Deposit, join the anonymity set, and spend with a zero-knowledge proof — we never
              learn your wallet. Generation runs on external providers today; hardware-sealed
              compute is on the roadmap, not in the product.
            </p>
            <span className="anon-links">
              <Link className="btn-ghost" to="/about"><Ic name="file-text" /> Read the architecture</Link>
              <Link className="btn-ghost" to="/legal/privacy"><Ic name="eye-off" /> Privacy policy</Link>
            </span>
          </div>
        </section>

        <section className="gaps">
          <div className="gaps-in">
            {GAPS.map((g) => (
              <div key={g.id} className="gap">
                <span className="gap-label mono">{g.label}</span>
                <p>{g.note}</p>
              </div>
            ))}
          </div>
        </section>

        {beat(
          <>
            <h2>Make something worth keeping.</h2>
            <span className="beat-cta">
              <Link className="btn lg" to="/onboard">Get started <Ic name="arrow-right" /></Link>
            </span>
          </>,
          'end',
          'centre',
        )}

        <footer className="cand-foot">
          <div className="cand-foot-in">
            <div className="cand-foot-brand"><Wordmark height={20} /></div>
            {FOOTER.map((col) => (
              <div key={col.h} className="cand-foot-col">
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
    </div>
  );
}
