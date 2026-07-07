import { describe, expect, it } from 'vitest';
import { ethForCredits, lineMode } from './BuyCreditsModal';
import type { DepositQuote } from '../lib/api';

// No jsdom/@testing-library/react in this app's toolchain today (see package.json) — so
// this exercises the modal's pure step-transition and quick-target logic rather than a
// full DOM render, per the item's "any component test the app supports" allowance.

function quote(pointsQuoted: string): DepositQuote {
  return {
    chainId: 1,
    token: '0x0000000000000000000000000000000000000000',
    amountRaw: '1000000000000000000',
    grossUsd: '3000',
    grossUsdMicro: '3000000000',
    fundingRatePct: 70,
    pointsQuoted,
    depositAddress: '0x0000000000000000000000000000000000000001',
  };
}

describe('ethForCredits', () => {
  it('returns null with no reference quote', () => {
    expect(ethForCredits(1000, null)).toBeNull();
  });

  it('scales linearly off the 1-ETH reference quote', () => {
    // 1 ETH -> 2000 credits, so 1000 credits -> 0.5 ETH.
    expect(ethForCredits(1000, quote('2000'))).toBeCloseTo(0.5, 10);
  });

  it('returns null for a degenerate reference quote', () => {
    expect(ethForCredits(1000, quote('0'))).toBeNull();
  });
});

describe('lineMode — 4-line ledger grammar', () => {
  it('ghosts every line before connect', () => {
    // n/a: 'connect' is the starting phase itself, not a line before it.
    expect(lineMode(2, 'connect')).toBe('ghost');
    expect(lineMode(3, 'connect')).toBe('ghost');
    expect(lineMode(4, 'connect')).toBe('ghost');
  });

  it('settles 01 ASSET once past connect; activates 02 AMOUNT', () => {
    expect(lineMode(1, 'amount')).toBe('settled');
    expect(lineMode(2, 'amount')).toBe('active');
    expect(lineMode(3, 'amount')).toBe('ghost');
  });

  it('activates 03 SIGN during sign and sign-rejected', () => {
    expect(lineMode(2, 'sign')).toBe('settled');
    expect(lineMode(3, 'sign')).toBe('active');
    expect(lineMode(3, 'sign-rejected')).toBe('active');
    expect(lineMode(4, 'sign')).toBe('ghost');
  });

  it('activates 04 SETTLE while settling, then settles everything once settled', () => {
    expect(lineMode(4, 'settle')).toBe('active');
    expect(lineMode(3, 'settle')).toBe('settled');
    expect(lineMode(4, 'settled')).toBe('settled');
  });
});
