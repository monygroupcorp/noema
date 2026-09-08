import { describe, expect, it } from 'vitest';
import { exportJobFor } from './EditioExport';
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
