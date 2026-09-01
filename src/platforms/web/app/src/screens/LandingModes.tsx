import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Deck } from './Deck';
import { ScrollStage, useStageProgress } from './ScrollStage';
import { WORK_MODES, type WorkMode } from './workModes';
import './landing-modes.css';

/** The real run states, from `RunStatus` in lib/api, and where in the card's own scroll window
 *  each one takes over. The reader's scroll is the clock. */
const RUN_STEPS = [
  { at: 0, s: 'pending', label: 'queued' },
  { at: 0.18, s: 'running', label: 'running' },
  { at: 0.86, s: 'complete', label: 'complete' },
] as const;

/** The last card is a run, so the deck holds on it for one extra card's worth of travel while
 *  it executes. */
const MODES_TRAIL = 1;

type RunStep = (typeof RUN_STEPS)[number];

function stepAt(local: number): RunStep {
  let step: RunStep = RUN_STEPS[0];
  for (const s of RUN_STEPS) if (local >= s.at) step = s;
  return step;
}

/**
 * A demonstration of what a run looks like, built from the product's own run states.
 *
 * It is not a screenshot and it is not pretending to be one: nothing is fetched, no run is
 * dispatched, and the card says so. STANDARD §6 bans invented product screens, and the line
 * between a demonstration and a fake dashboard is whether it admits what it is — so it is
 * labelled, it shows no numbers a real run would report (no cost, no credit balance, no ids),
 * and it loops rather than resolving into something a visitor could mistake for their own work.
 */
function RunDemo({ count, trail, locked }: { count: number; trail: number; locked: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [local, setLocal] = useState(1); // finished until proven otherwise — see below

  useEffect(() => {
    const el = ref.current;
    const stage = el?.closest('.stage') as HTMLElement | null;
    // Without a lock there is no window to run across, and under reduced motion there is no
    // running to show. Both hold on the finished state, which is the still this has to be.
    if (!el || !stage || !locked) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    const measure = () => {
      raf = 0;
      const r = stage.getBoundingClientRect();
      const travel = r.height - (window.innerHeight || 1);
      const p = travel > 0 ? Math.min(1, Math.max(0, -r.top / travel)) : 0;
      const adv = p * (count - 1 + trail);
      // the trail is this card's own clock: 0 the moment the card above it has finished leaving.
      setLocal(Math.min(1, Math.max(0, (adv - (count - 1)) / trail)));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [count, trail, locked]);

  const step = stepAt(local);
  const pct = Math.round(local * 100);
  return (
    <>
      <div className="mode-run" data-state={step.s} ref={ref}>
        <div className="run-panel">
        <div className="run-head">
          <span className="run-flow mono">flux-schnell</span>
          <span className={`run-chip mono st-${step.s}`}>{step.label}</span>
        </div>
        <div className="run-prompt">a figure in a doorway, one cold light</div>
        <div className="run-bar"><span style={{ width: `${pct}%` }} /></div>
        <div className="run-out" data-done={step.s === 'complete'}>
          <span className="mono">{step.s === 'complete' ? 'one image' : `${pct}%`}</span>
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
  showPlaceholders = false,
}: {
  stagger?: number;
  progress?: 'lock' | 'pass';
  /** Render rooms whose capture has not been taken yet as labelled frames. Dev-only. */
  showPlaceholders?: boolean;
}) {
  const run = <ModesRun stagger={stagger} progress={progress} showPlaceholders={showPlaceholders} />;
  return (
    <section className="lp-modes">
      {progress === 'lock' ? (
        <ScrollStage hold={(WORK_MODES.length) * 0.5 + MODES_TRAIL * 0.7}>{run}</ScrollStage>
      ) : (
        run
      )}
    </section>
  );
}

/**
 * The run itself, and the index under it.
 *
 * The index is the same list of rooms twice over: names a reader can click, and a readout of
 * where the run has got to. It lights the room whose card is on top, so the deck never leaves
 * the reader wondering which screen they are looking at — the thing a caption on a moving card
 * cannot do, because the caption moves with it.
 */
function ModesRun({ stagger, progress, showPlaceholders }: { stagger: number; progress: 'lock' | 'pass'; showPlaceholders: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const p = useStageProgress(ref, progress === 'lock');

  // A room with no capture yet is not shown to a visitor — the run carries the rooms that can
  // actually be seen, and grows as captures land. The demonstration always closes it.
  const rooms = showPlaceholders ? WORK_MODES : WORK_MODES.filter((m) => m.shot !== null);
  const items = [
    ...rooms.map((m) => <ModeCard key={m.id} mode={m} />),
    null,
  ];
  items[items.length - 1] = (
    <RunDemo key="run" count={items.length} trail={MODES_TRAIL} locked={progress === 'lock'} />
  );

  // which card is on top: cards depart one per unit of advance, and the last one never does.
  const advance = Math.min(p * (items.length - 1 + MODES_TRAIL), items.length - 1);
  const top = Math.min(items.length - 1, Math.max(0, Math.floor(advance)));

  return (
    <div className="lp-modes-run" ref={ref}>
      <div className="lp-modes-head">
        <h2>Every room of the studio.</h2>
        <p>
          Each one is a whole way of working, not a tab. You can live in one of them or move
          between all of them.
        </p>
      </div>

      <Deck
        className="lp-deck-modes"
        label="The rooms of the studio, one at a time"
        aspect={16 / 9}
        aspectNarrow={3 / 4}
        trail={MODES_TRAIL}
        stagger={stagger}
        progress={progress}
        items={items}
      />

      <nav className="lp-modes-index" aria-label="The rooms">
        {rooms.map((m, i) => (
          <Link key={m.id} to={m.route} data-on={i === top || undefined}>
            {m.name}
          </Link>
        ))}
        <span data-on={top === rooms.length || undefined}>Running</span>
      </nav>
    </div>
  );
}