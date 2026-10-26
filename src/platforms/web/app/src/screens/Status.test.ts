import { describe, expect, it } from 'vitest';
import { statCards } from './Status';
import type { MeStatus } from '../lib/api';

// No jsdom/@testing-library/react in this app's toolchain (see BuyCreditsModal.test.ts) — so
// this exercises the pure derivation the stat row renders from.

function me(over: Partial<MeStatus> = {}): MeStatus {
  return { balanceImpetus: '0', balanceUsd: 0, gens: [], studios: [], joinable: [], takenAt: 'now', ...over };
}

describe('statCards — the row of figures under the Activity page head', () => {
  it('holds every card with an ellipsis before the account read lands', () => {
    expect(statCards(null).map((c) => c.n)).toEqual(['…', '…', '…']);
  });

  it('prints the balance even at zero — next to "Add credits" the zero is the fact to act on — and no other zero', () => {
    const cards = statCards(me());
    expect(cards).toEqual([{ l: 'Balance', n: '0', d: 'credits · ≈ $0.00' }]);
  });

  it('draws the run and studio counts once there is something to count', () => {
    const cards = statCards(me({
      balanceImpetus: '1200', balanceUsd: 0.4,
      gens: [{} as MeStatus['gens'][number], {} as MeStatus['gens'][number]],
      studios: [{} as MeStatus['studios'][number]],
    }));
    expect(cards.map((c) => [c.l, c.n])).toEqual([['Balance', '1,200'], ['Runs', '2'], ['Studios', '1']]);
    expect(cards[0].d).toBe('credits · ≈ $0.40');
  });
});
