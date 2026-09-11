import { describe, expect, it } from 'vitest';
import { exportJobFor, heldCollectionJob } from './EditioExport';
import type { Editio } from '../lib/editio';

// Publishing a collection to hosting goes out at visibility 'marketplace' — a moderated
// public surface — so the moderation gate can HOLD it, and under the interim posture that
// holds every public publish, it always does. The screen's poll only ever ended on
// published / rejected / failed, so a held publication sat at "Publishing…" and re-polled
// forever: the publisher was never told a person had to clear it. These pin the terminal
// states, the hold included.
const ed = (p: Partial<Editio>): Editio => ({
  id: 'e1',
  artifact: { kind: 'collectio', id: 'c1' },
  destination: 'gallery',
  visibility: 'marketplace',
  custody: 'ours',
  status: 'pending',
  createdAt: '2026-09-07T00:00:00.000Z',
  updatedAt: '2026-09-07T00:00:00.000Z',
  ...p,
});

describe('exportJobFor — a hold ends the poll instead of hiding behind it', () => {
  it('tells the publisher a hold, with the server\'s author-safe reason', () => {
    const job = exportJobFor(ed({ reviewOutcome: 'pending', moderationNote: 'Waiting for a person to look at it.' }), 'hosting');
    expect(job).toEqual({ s: 'held', msg: 'Waiting for a person to look at it.' });
  });

  it('still names a reason when the API build predates moderationNote', () => {
    const job = exportJobFor(ed({ reviewOutcome: 'pending' }), 'hosting');
    expect(job?.s).toBe('held');
    expect(job && 'msg' in job && job.msg).toBe('Held for a person to review before it goes live.');
  });

  it('does not confuse a hold with a refusal — they are different sentences and different copy', () => {
    const held = exportJobFor(ed({ reviewOutcome: 'pending' }), 'hosting');
    const refused = exportJobFor(ed({ status: 'rejected', moderationNote: 'Automated review flagged something in this content, so it was not published.' }), 'hosting');
    expect(held?.s).toBe('held');
    expect(refused).toEqual({ s: 'rejected', msg: 'Automated review flagged something in this content, so it was not published.' });
  });

  it('keeps polling only while the publication is genuinely still settling', () => {
    // No reviewOutcome: the worker has not reached it yet. This is the one case that must
    // NOT terminate, and the one the hold used to be mistaken for.
    expect(exportJobFor(ed({}), 'hosting')).toBeNull();
    // Published but not yet carrying its hosted url — the adapter is still finishing.
    expect(exportJobFor(ed({ status: 'published' }), 'hosting')).toBeNull();
  });

  it('hands back the hosted url once the adapter has one', () => {
    const job = exportJobFor(ed({ status: 'published', externalRef: 'https://cdn.example/c1' }), 'hosting');
    expect(job).toEqual({ s: 'ready', url: 'https://cdn.example/c1', kind: 'hosting', editionId: 'e1' });
  });

  it('reports an adapter failure as retryable, not as a moderation outcome', () => {
    const job = exportJobFor(ed({ status: 'failed' }), 'download');
    expect(job?.s).toBe('err');
    expect(job && 'msg' in job && job.msg).toContain('try again');
  });
});

// `exportJobFor` ends the poll that is already running; it does nothing for the NEXT visit,
// because the poll only exists in the session that pressed the button. The screen mounted at
// idle and fetched only the collection, so a reload dropped a hold entirely and offered
// "Publish to hosting" again — filing a second edition behind the first. These pin the seed
// that recovers it, the way the shelf already does for a held model.
describe('heldCollectionJob — a hold is still there on the next visit', () => {
  it('recovers this collection’s hold, with the server’s author-safe reason', () => {
    const q = [ed({ id: 'e9', reviewOutcome: 'pending', moderationNote: 'Waiting for a person to look at it.' })];
    expect(heldCollectionJob(q, 'c1')).toEqual({ s: 'held', msg: 'Waiting for a person to look at it.' });
  });

  it('names a reason when the API build predates moderationNote', () => {
    expect(heldCollectionJob([ed({ reviewOutcome: 'pending' })], 'c1'))
      .toEqual({ s: 'held', msg: 'Held for a person to review before it goes live.' });
  });

  it('ignores a hold on a DIFFERENT collection', () => {
    const q = [ed({ artifact: { kind: 'collectio', id: 'c2' }, reviewOutcome: 'pending' })];
    expect(heldCollectionJob(q, 'c1')).toBeNull();
  });

  it('ignores a held model — the shelf owns those, and an intella id could collide', () => {
    const q = [ed({ artifact: { kind: 'intella', id: 'c1' }, reviewOutcome: 'pending' })];
    expect(heldCollectionJob(q, 'c1')).toBeNull();
  });

  it('ignores an entry a reviewer has already adjudicated', () => {
    expect(heldCollectionJob([ed({ reviewOutcome: 'approved' })], 'c1')).toBeNull();
    expect(heldCollectionJob([ed({ status: 'rejected', reviewOutcome: 'rejected' })], 'c1')).toBeNull();
  });

  it('takes the newest hold when a collection has been put forth more than once', () => {
    // The queue is newest-first (MongoEditionum sorts natum: -1), so the first match wins.
    const q = [
      ed({ id: 'new', reviewOutcome: 'pending', moderationNote: 'the live one' }),
      ed({ id: 'old', reviewOutcome: 'pending', moderationNote: 'a stale one' }),
    ];
    expect(heldCollectionJob(q, 'c1')).toEqual({ s: 'held', msg: 'the live one' });
  });

  it('is null on an empty queue, so an unpublished collection still gets its button', () => {
    expect(heldCollectionJob([], 'c1')).toBeNull();
  });
});
