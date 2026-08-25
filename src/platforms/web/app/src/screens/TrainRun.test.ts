import { describe, expect, it } from 'vitest';
import { trainRunNotice } from './TrainRun';
import type { Run, RunOrder } from '../lib/api';

// No jsdom/@testing-library/react in this app's toolchain (see Canvas.test.ts) — so this
// exercises the pure order-state-to-copy selection rather than a full DOM render.

function run(overrides: Partial<Run> = {}): Run {
  return { id: 'r1', status: 'running', modusId: 'aitoolkit-training', ...overrides };
}

function order(overrides: Partial<RunOrder> = {}): RunOrder {
  return { id: 'o1', state: 'attempting', attempts: 1, attemptsRemaining: 5, ...overrides };
}

const OLD_SLOP_FRAGMENTS = [
  "couldn’t give us a working machine",
  "that’s on us, not",
];

describe('trainRunNotice — sequencing (attempting vs scheduled)', () => {
  it('an attempting order selects the progress copy, never the scheduled/failure copy', () => {
    const notice = trainRunNotice(order({ state: 'attempting' }), run());
    expect(notice.mode).toBe('attempting');
    expect(notice.copy).toBe('getting a machine…');
    expect(notice.chip).not.toBe('scheduled');
    expect(notice.chip).not.toBe('failed');
  });

  it('a scheduled order selects the approved retry copy with the until timestamp', () => {
    const until = '2026-08-26T18:00:00.000Z';
    const notice = trainRunNotice(order({ state: 'scheduled', until }), run());
    expect(notice.mode).toBe('scheduled');
    expect(notice.copy).toBe(
      `No machine this attempt. Retries run hourly until ${new Date(until).toLocaleString()}. ` +
      `Attempts that don't start aren't charged. The finished training lands on your shelf.`,
    );
  });

  it('neither retired slop string is selectable in any order/run state', () => {
    const states: Array<RunOrder['state'] | undefined> = [
      'attempting', 'scheduled', 'fulfilled', 'stopped', 'cancelled', undefined,
    ];
    const statuses: Run['status'][] = ['pending', 'running', 'complete', 'failed'];
    for (const state of states) {
      for (const status of statuses) {
        const notice = trainRunNotice(
          state ? order({ state }) : undefined,
          run({ status }),
        );
        for (const slop of OLD_SLOP_FRAGMENTS) {
          expect(notice.copy ?? '').not.toContain(slop);
        }
      }
    }
  });

  it('a run with no order falls through unaffected (chip mirrors run status)', () => {
    expect(trainRunNotice(undefined, run({ status: 'failed' })).chip).toBe('failed');
    expect(trainRunNotice(undefined, run({ status: 'complete' })).chip).toBe('finished');
    expect(trainRunNotice(undefined, run({ status: 'running' })).chip).toBe('running');
  });
});
