import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Deck } from './Deck';
import { ScrollStage } from './ScrollStage';
import { WORK_MODES, type WorkMode } from './workModes';
import './landing-modes.css';

/** The real run states, from `RunStatus` in lib/api. The card below walks them in order. */
const RUN_STEPS = [
  { s: 'pending', label: 'queued', pct: 0 },
  { s: 'running', label: 'running', pct: 38 },
  { s: 'running', label: 'running', pct: 74 },
  { s: 'complete', label: 'complete', pct: 100 },
] as const;

/**
 * A demonstration of what a run looks like, built from the product's own run states.
 *
 * It is not a screenshot and it is not pretending to be one: nothing is fetched, no run is
 * dispatched, and the card says so. STANDARD §6 bans invented product screens, and the line
 * between a demonstration and a fake dashboard is whether it admits what it is — so it is
 * labelled, it shows no numbers a real run would report (no cost, no credit balance, no ids),
 * and it loops rather than resolving into something a visitor could mistake for their own work.
 */
function RunDemo() {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setI(RUN_STEPS.length - 1); // the finished state is the still
      return;
    }
    const t = setInterval(() => setI((n) => (n + 1) % (RUN_STEPS.length + 1)), 1400);
    return () => clearInterval(t);
  }, []);

  const step = RUN_STEPS[Math.min(i, RUN_STEPS.length - 1)];
  return (
    <>
      <div className="mode-run" data-state={step.s}>
        <div className="run-panel">
        <div className="run-head">
          <span className="run-flow mono">flux-schnell</span>
          <span className={`run-chip mono st-${step.s}`}>{step.label}</span>
        </div>
        <div className="run-prompt">a figure in a doorway, one cold light</div>
        <div className="run-bar"><span style={{ width: `${step.pct}%` }} /></div>
        <div className="run-out" data-done={step.s === 'complete'}>
          <span className="mono">{step.s === 'complete' ? 'one image' : ' '}</span>
        </div>
        <span className="run-mark mono">a demonstration · nothing is running</span>
        </div>

      </div>
      <span className="mode-plate">
        <span className="mode-name">Running</span>
        <span className="mode-line">Pick a workflow, say what you want, watch it land.</span>
      </span>
    </>
  );
}

/** One room as a deck card: the screen filling the card, its name on a plate over the bottom. */
function ModeCard({ mode }: { mode: WorkMode }) {
  return (
    <>
      {mode.shot ? (
        <img
          className="mode-shot"
          src={mode.shot.src}
          alt={mode.shot.alt}
          width={mode.shot.width}
          height={mode.shot.height}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <span className="mode-shot mode-empty">
          <span className="mono">
            {mode.name.toLowerCase()} — screen capture
            {mode.needsSession ? ' · needs a populated session' : ''}
          </span>
        </span>
      )}
      {/* a label, not a link. In a deck every card but the top one is covered, so a link here
          would be a tab stop on an invisible target and a click on a moving one — the rooms are
          reachable from the row under the heading instead. */}
      <span className="mode-plate">
        <span className="mode-name">{mode.name}</span>
        <span className="mode-line">{mode.line}</span>
      </span>
    </>
  );
}

/**
 * The rooms of the product, shown rather than described.
 *
 * A room with no capture yet renders as a marked empty frame rather than a stock image or a
 * mockup: the page would rather admit a gap than show a screen that does not exist.
 */
export function LandingModes({
  stagger = 18,
  progress = 'lock',
}: {
  stagger?: number;
  progress?: 'lock' | 'pass';
}) {
  const items = [
    ...WORK_MODES.map((m) => <ModeCard key={m.id} mode={m} />),
    <RunDemo key="run" />,
  ];
  const deck = (
    <Deck
      className="deck-modes"
      label="The rooms of the studio, one at a time"
      aspect={16 / 9}
      stagger={stagger}
      progress={progress}
      items={items}
    />
  );

  return (
    <section className="modes">
      <div className="modes-in">
        <h2>Every room of the studio.</h2>
        <p className="modes-sub">
          Each one is a whole way of working, not a tab. You can live in one of them or move
          between all of them.
        </p>
        <nav className="modes-links" aria-label="The rooms">
          {WORK_MODES.map((m) => (
            <Link key={m.id} to={m.route}>{m.name}</Link>
          ))}
        </nav>

      </div>

      {/* the heading stays in normal flow; only the run locks. A pinned viewport holding a
          heading and a card is holding one thing too many. */}
      {progress === 'lock' ? <ScrollStage hold={(items.length - 1) * 0.55}>{deck}</ScrollStage> : deck}
    </section>
  );
}
