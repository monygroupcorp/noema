import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { Wordmark } from '../ui/Wordmark';
import { PlateDeck } from './PlateDeck';
import { DECK_FORMATS, PLATES, isPlaceholder, platesIn, type PlateFormat } from './landingPlates';
import './plate-lab.css';

const LEADS = [0.7, 0.78, 0.86];

/**
 * The coded design laboratory for the landing page's image mechanism.
 *
 * Not a public surface: the route is registered only in dev builds, so unfilled slots and draft
 * copy cannot reach a visitor. It exists so the deck can be judged the only way a scroll device
 * can be judged — by scrolling past it, in the real application, with real fonts and tokens, at
 * the widths the capability proof is argued at.
 *
 * The two controls are the open decisions. Card crop changes what the art has to be shot for,
 * and lead fraction changes how much of the next card is showing when the reader arrives. Both
 * are cheaper to settle by looking than by specifying.
 */
export function PlateLab() {
  const [format, setFormat] = useState<PlateFormat>('2:1');
  const [lead, setLead] = useState(0.78);
  const filled = PLATES.filter((s) => !isPlaceholder(s)).length;

  return (
    <div className="lab">
      <div className="lab-bar">
        <span className="lab-tag mono">design lab · not public</span>
        <span className="lab-meta mono">
          {filled}/{PLATES.length} plates · copy is draft
        </span>
        <span className="lab-ctl">
          <span className="mono">card</span>
          {DECK_FORMATS.map((f) => (
            <button key={f} className={f === format ? 'on' : ''} onClick={() => setFormat(f)}>
              {f}
            </button>
          ))}
        </span>
        <span className="lab-ctl">
          <span className="mono">lead</span>
          {LEADS.map((l) => (
            <button key={l} className={l === lead ? 'on' : ''} onClick={() => setLead(l)}>
              {Math.round(l * 100)}%
            </button>
          ))}
        </span>
      </div>

      <div className="cand">
        <nav className="cand-nav">
          <span className="brand"><Wordmark height={22} /></span>
          <span className="right">
            <Link className="btn-ghost" to="/pricing">Pricing</Link>
            <Link className="btn" to="/onboard">Open app</Link>
          </span>
        </nav>

        <header className="cand-hero">
          <h1>
            Your own material,<br />
            <span className="dim">a system you can use again.</span>
          </h1>
          <hr className="noema-rule" />
          <p>
            Bring what you already have. Explore it, train on it, and make new work that carries
            the same hand.
          </p>
          <span className="cand-cta">
            <Link className="btn lg" to="/onboard">Get started <Ic name="arrow-right" /></Link>
          </span>
        </header>

        <PlateDeck
          slots={platesIn('deck')}
          format={format}
          lead={lead}
          label="A run of work made in noema, passing"
        />

        <section className="cand-sec">
          <h2>Three ways in.</h2>
          <p className="cand-sub">
            Each one is a complete piece of work, not a step in a form. Start anywhere; they meet
            in the same place.
          </p>
          <div className="cand-paths">
            <article>
              <h3>Explore a dataset</h3>
              <p>Pull your material apart into the vocabulary it is already made of.</p>
            </article>
            <article>
              <h3>Train a visual identity</h3>
              <p>Teach a model the hand your work is in, and keep the model.</p>
            </article>
            <article>
              <h3>Run a finished workflow</h3>
              <p>A complete pipeline, not a prompt box. Open it up when you want the controls.</p>
            </article>
          </div>
        </section>

        <PlateDeck
          slots={platesIn('deck-coda')}
          lead={lead}
          className="deck-coda"
          label="A second run of work made in noema, passing"
        />

        <section className="cand-end">
          <h2>Make something worth keeping.</h2>
          <Link className="btn lg" to="/onboard">Get started <Ic name="arrow-right" /></Link>
        </section>
      </div>
    </div>
  );
}
