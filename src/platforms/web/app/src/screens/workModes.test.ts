import { describe, expect, it } from 'vitest';
import { WORK_MODES, shotCount, type WorkMode } from './workModes';

const mode = (over: Partial<WorkMode> = {}): WorkMode => ({
  id: 'm', name: 'M', line: 'l', route: '/m', shot: null, ...over,
});
const shot = { src: '/a.webp', alt: 'a', width: 1440, height: 900 };

describe('the work-mode registry', () => {
  it('gives every room a unique id and a route to walk to', () => {
    const ids = WORK_MODES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of WORK_MODES) expect(m.route.startsWith('/')).toBe(true);
  });

  it('requires alt text on any capture that lands', () => {
    for (const m of WORK_MODES) {
      if (m.shot) expect(m.shot.alt.trim().length).toBeGreaterThan(0);
    }
  });

  it('records which rooms need a populated session, so an empty capture is a known gap', () => {
    expect(WORK_MODES.some((m) => m.needsSession)).toBe(true);
    expect(WORK_MODES.some((m) => !m.needsSession)).toBe(true);
  });
});

describe('shotCount', () => {
  it('counts the rooms that have a real capture behind them', () => {
    expect(shotCount([mode(), mode({ id: 'b', shot })])).toEqual({ filled: 1, total: 2 });
    expect(shotCount([])).toEqual({ filled: 0, total: 0 });
  });
});
