import { describe, expect, it } from 'vitest';
import { inFlightLine, pendingReviewLine, recentPieces, runLiveness, STALL_MESSAGE } from './CanonicRun';

// No jsdom/@testing-library/react in this app's toolchain — so this exercises the run
// screen's pure liveness classification rather than a full DOM render (see BuyCreditsModal.test.ts).

function coll(over: Partial<Parameters<typeof runLiveness>[0]> = {}) {
  return { status: 'running', completed: 0, failed: 0, rejected: 0, ...over };
}

describe('runLiveness — stuck vs working (noema-358)', () => {
  it('is stalled when a run is actively going but dispatched NOTHING (noema-357 case)', () => {
    const live = runLiveness(coll({ status: 'running', inFlight: 0, pendingReview: 0 }));
    expect(live.state).toBe('stalled');
  });

  it('is inflight, not stalled, once pieces are dispatched but none have settled yet', () => {
    const live = runLiveness(coll({ status: 'running', inFlight: 3, pendingReview: 0 }));
    expect(live.state).toBe('inflight');
    expect(live.inFlight).toBe(3);
  });

  it('is not stalled while a run is still pending (just fired, not yet agens)', () => {
    const live = runLiveness(coll({ status: 'pending', inFlight: 0, pendingReview: 0 }));
    expect(live.state).toBe('normal');
  });

  it('is not stalled once ANY piece has settled, even with zero in flight', () => {
    const live = runLiveness(coll({ status: 'running', completed: 1, inFlight: 0, pendingReview: 0 }));
    expect(live.state).toBe('normal');
  });

  it('is not stalled when acta are parked pending review — that is real progress', () => {
    const live = runLiveness(coll({ status: 'running', inFlight: 0, pendingReview: 2 }));
    expect(live.state).toBe('normal');
    expect(live.pendingReview).toBe(2);
  });

  it('is not stalled while paused — Resume, not "stalled", is the honest word', () => {
    const live = runLiveness(coll({ status: 'running', paused: true, inFlight: 0, pendingReview: 0 }));
    expect(live.state).toBe('normal');
  });

  it('treats missing inFlight/pendingReview as zero (an older payload shape)', () => {
    const live = runLiveness(coll({ status: 'running' }));
    expect(live.state).toBe('stalled');
  });

  it('is normal once the run is no longer active (complete/cancelled)', () => {
    const live = runLiveness(coll({ status: 'complete' }));
    expect(live.state).toBe('normal');
  });
});

describe('display text', () => {
  it('the stall message names the honest recovery action', () => {
    expect(STALL_MESSAGE).toMatch(/stalled/);
  });

  it('singularizes the in-flight line at n=1', () => {
    expect(inFlightLine(1)).toContain('1 piece in flight');
    expect(inFlightLine(2)).toContain('2 pieces in flight');
  });

  it('singularizes the pending-review line at n=1', () => {
    expect(pendingReviewLine(1)).toBe('1 piece awaiting review');
    expect(pendingReviewLine(5)).toBe('5 pieces awaiting review');
  });
});

describe('recentPieces — what the arrivals strip shows (collection-run-shows-nothing)', () => {
  // listCollectionPieces walks the collection's acta in dispatch order, so it answers
  // oldest-first. The strip is a window on what just landed, so it reads from the tail.
  it('puts the newest arrival first', () => {
    expect(recentPieces(['first', 'second', 'third'], 10)).toEqual(['third', 'second', 'first']);
  });

  it('keeps the newest N and drops the older ones, not the other way round', () => {
    const made = Array.from({ length: 100 }, (_, i) => i);
    const shown = recentPieces(made, 24);
    expect(shown).toHaveLength(24);
    expect(shown[0]).toBe(99);
    expect(shown[23]).toBe(76);
  });

  it('is empty for a run that has made nothing, rather than throwing', () => {
    expect(recentPieces([], 24)).toEqual([]);
  });

  it('shows everything when fewer pieces exist than the window holds', () => {
    expect(recentPieces([1, 2], 24)).toEqual([2, 1]);
  });

  it('shows nothing for a non-positive window rather than slicing from the wrong end', () => {
    expect(recentPieces([1, 2, 3], 0)).toEqual([]);
    expect(recentPieces([1, 2, 3], -5)).toEqual([]);
  });
});
