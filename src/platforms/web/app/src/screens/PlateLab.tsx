import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { Wordmark } from '../ui/Wordmark';
import { PlateDeck } from './PlateDeck';
import { ScrollStage } from './ScrollStage';
import { DECK_FORMATS, PLATES, isPlaceholder, platesIn, type PlateFormat } from './landingPlates';
import './plate-lab.css';

const STAGGERS = [0, 18, 36];
const LEADINGS = [1.02, 1.12, 1.22];

/** The information beats, each one locked to the viewport for as long as the reader stays. */
const BEATS = [
  {
    id: 'explore',
    n: '01',
    title: 'Explore a dataset',
    text: 'Pull your material apart into the vocabulary it is already made of.',
  },
  {
    id: 'train',
    n: '02',
    title: 'Train a visual identity',
    text: 'Teach a model the hand your work is in, and keep the model.',
  },
  {
    id: 'run',
    n: '03',
    title: 'Run a finished workflow',
    text: 'A complete pipeline, not a prompt box. Open it up when you want the controls.',
  },
];

/**
 * The coded design laboratory for the landing page.
 *
 * Not a public surface: the route is registered only in dev builds, so unfilled slots and draft
 * copy cannot reach a visitor. It exists so the page can be judged the only way a scroll page
 * can be — by scrolling it, in the real application, at the widths the capability proof is
 * argued at.
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
  const run = platesIn('deck');
  const coda = platesIn('deck-coda');
  // How far the reader scrolls, in viewport heights, while a block is locked.
  const deckHold = (n: number) => (n - 1) * 0.55;

  const deck = (slots: typeof run, label: string, className?: string) => {
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
    return mode === 'lock' ? (
      <ScrollStage hold={deckHold(slots.length)}>{el}</ScrollStage>
    ) : (
      el
    );
  };

  const beat = (node: React.ReactNode, key: string) =>
    mode === 'lock' ? (
      <ScrollStage key={key} hold={0.8}>
        <div className="beat">{node}</div>
      </ScrollStage>
    ) : (
      <div key={key} className="cand-flow">{node}</div>
    );

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

      <div
        className={`cand cand-type-${font}`}
        style={{ '--hero-leading': String(leading) } as CSSProperties}
      >
        <nav className="cand-nav">
          <span className="brand"><Wordmark height={22} /></span>
          <span className="right">
            <Link className="btn-ghost" to="/pricing">Pricing</Link>
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
          </span>
        </header>

        {deck(run, 'A run of work made in noema, passing')}

        {BEATS.map((b) =>
          beat(
            <>
              <span className="beat-n mono">{b.n}</span>
              <h2>{b.title}</h2>
              <p>{b.text}</p>
            </>,
            b.id,
          ),
        )}

        {deck(coda, 'A second run of work made in noema, passing', 'deck-coda')}

        {beat(
          <>
            <h2>Make something worth keeping.</h2>
            <span className="beat-cta">
              <Link className="btn lg" to="/onboard">Get started <Ic name="arrow-right" /></Link>
            </span>
          </>,
          'end',
        )}
      </div>
    </div>
  );
}
