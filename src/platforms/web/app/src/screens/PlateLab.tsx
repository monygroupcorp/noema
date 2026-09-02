import { useState } from 'react';
import { Landing, type LandingProps } from './Landing';
import { DECK_FORMATS, PLATES, isPlaceholder, type PlateFormat } from './landingPlates';
import './plate-lab.css';

const DISPLAY_FACES = ['fraunces', 'instrument', 'newsreader', 'geist', 'martian'] as const;
const STAGGERS = [0, 18, 36];
const LEADINGS = [1.02, 1.12, 1.22];

/**
 * The coded design laboratory for the landing page.
 *
 * It renders the real `Landing`, not a copy of it — a lab that duplicates the page drifts from it
 * inside a week and then quietly stops telling the truth. Every control here is a prop the page
 * already takes, so what is judged in this room is the thing that ships.
 *
 * Not a public surface: the route is registered only in dev builds. That is also what makes it
 * safe to show placeholders here — on the public page an unfilled run renders nothing.
 */
export function PlateLab() {
  const [display, setDisplay] = useState<LandingProps['face']>('fraunces');
  const [leading, setLeading] = useState(1.12);
  const [crop, setCrop] = useState<PlateFormat>('21:9');
  const [stagger, setStagger] = useState(18);
  const [mode, setMode] = useState<'lock' | 'pass'>('lock');
  const [theme, setTheme] = useState<'current' | 'editorial'>('editorial');
  const [cta, setCta] = useState<'blue' | 'ink' | 'outline'>('ink');
  const [mark, setMark] = useState<'mono' | 'serif'>('serif');
  const filled = PLATES.filter((s) => !isPlaceholder(s)).length;

  return (
    <div className="lab">
      <div className="lab-bar">
        <span className="lab-tag mono">design lab · not public</span>
        <span className="lab-meta mono">{filled}/{PLATES.length} plates · copy is draft</span>
        <span className="lab-ctl">
          <span className="mono">display</span>
          {DISPLAY_FACES.map((f) => (
            <button key={f} className={f === display ? 'on' : ''} onClick={() => setDisplay(f)}>{f}</button>
          ))}
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
          <span className="mono">cta</span>
          {(['blue', 'ink', 'outline'] as const).map((v) => (
            <button key={v} className={v === cta ? 'on' : ''} onClick={() => setCta(v)}>{v}</button>
          ))}
        </span>
        <span className="lab-ctl">
          <span className="mono">mark</span>
          {(['serif', 'mono'] as const).map((v) => (
            <button key={v} className={v === mark ? 'on' : ''} onClick={() => setMark(v)}>{v}</button>
          ))}
        </span>
        <span className="lab-ctl">
          <span className="mono">theme</span>
          <button className={theme === 'current' ? 'on' : ''} onClick={() => setTheme('current')}>current</button>
          <button className={theme === 'editorial' ? 'on' : ''} onClick={() => setTheme('editorial')}>editorial</button>
        </span>
        <span className="lab-ctl">
          <span className="mono">scroll</span>
          <button className={mode === 'lock' ? 'on' : ''} onClick={() => setMode('lock')}>lock</button>
          <button className={mode === 'pass' ? 'on' : ''} onClick={() => setMode('pass')}>pass</button>
        </span>
      </div>

      <Landing
        face={display}
        theme={theme}
        cta={cta}
        mark={mark}
        crop={crop}
        stagger={stagger}
        scroll={mode}
        leading={leading}
        showPlaceholders
      />
    </div>
  );
}
