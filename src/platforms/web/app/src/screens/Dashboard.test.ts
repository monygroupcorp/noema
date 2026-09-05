import { describe, expect, it } from 'vitest';
import { computeRow, royaltyFoot } from './Dashboard';
import type { EarningsView } from '../lib/api';

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

// The royalties tile used to read a hardcoded em-dash under "coming soon — payouts land with
// noesis", while runs were already paying spell and model royalties onto the ledger. It reads
// GET /v1/me/earnings now, and this covers the line it prints under the number.

function view(over: Partial<EarningsView> = {}): EarningsView {
  return { lifetime: { impetus: '0', usd: 0 }, streams: [], earnings: [], ...over };
}

describe('royaltyFoot — what the royalties tile says under the number', () => {
  it('says nothing before the read lands, rather than claiming a state it has not seen', () => {
    expect(royaltyFoot(null)).toBe('');
  });

  it('tells an account that has earned nothing what would pay it', () => {
    expect(royaltyFoot(view())).toBe('publish a flow or a model — every run that uses it pays you');
  });

  it('names the streams that actually paid, in the API order', () => {
    const e = view({
      lifetime: { impetus: '175', usd: 0 },
      streams: [
        { kind: 'spell-royalty', impetus: '150', usd: 0, count: 2 },
        { kind: 'model-royalty', impetus: '25', usd: 0, count: 1 },
      ],
    });
    expect(royaltyFoot(e)).toBe('spell royalties · model royalties — credited to your balance');
  });

  it('ignores a stream that is present but has paid nothing', () => {
    const e = view({ streams: [{ kind: 'host-cut', impetus: '0', usd: 0, count: 0 }] });
    expect(royaltyFoot(e)).toBe('publish a flow or a model — every run that uses it pays you');
  });
});
