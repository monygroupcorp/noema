import { describe, expect, it } from 'vitest';
import { computeRow } from './Dashboard';

// No jsdom/@testing-library/react in this app's toolchain (see BuyCreditsModal.test.ts) —
// so this exercises the dashboard's pure compute-row derivation rather than a full DOM
// render, per the item's "any component test the app supports" allowance.
//
// noema-344: the TEE roadmap line used to be mode-gated — only an account already running
// in TEE mode ever saw it. It now reaches every viewer regardless of compute mode.

describe('computeRow — TEE roadmap line visibility (noema-344)', () => {
  it('shared mode carries both the current-state line and the roadmap line', () => {
    const row = computeRow('shared');
    expect(row.text).toBe('shared — running on our compute');
    expect(row.roadmap).toBe('hardware-sealed compute (TEE) is on the roadmap.');
  });

  it('an anonymous/guest execution value (anything other than "tee") still gets the roadmap line', () => {
    const row = computeRow('anonymous');
    expect(row.roadmap).toBe('hardware-sealed compute (TEE) is on the roadmap.');
  });

  it('tee mode is unchanged: no separate roadmap line, since the state line already says it', () => {
    const row = computeRow('tee');
    expect(row.text).toBe('hardware-sealed compute (TEE) is on the roadmap.');
    expect(row.roadmap).toBeUndefined();
  });
});
