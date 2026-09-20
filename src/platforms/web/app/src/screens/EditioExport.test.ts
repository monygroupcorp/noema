import { describe, expect, it } from 'vitest';
import { exportJobFor, hostingJobFor, IDLE_JOBS, putJob } from './EditioExport';
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
// idle and fetched only the collection, so reopening it dropped everything the publisher had
// been told and offered "Publish to hosting" again — filing a second edition behind the first.
//
// Seeding from the review queue recovered a HOLD and only a hold. A REFUSAL — which is what
// the default fail-closed gate answers, so the common case, not an edge one — and a
// publication already LIVE were both left in the closed tab. These pin what the server's own
// record of this collection's hosting publication makes the screen say.
describe('hostingJobFor — the hosting publication is still there on the next visit', () => {
  it('recovers a hold, with the server\'s author-safe reason', () => {
    const q = [ed({ id: 'e9', reviewOutcome: 'pending', moderationNote: 'Waiting for a person to look at it.' })];
    expect(hostingJobFor(q)).toEqual({ s: 'held', msg: 'Waiting for a person to look at it.' });
  });

  it('names a reason when the API build predates moderationNote', () => {
    expect(hostingJobFor([ed({ reviewOutcome: 'pending' })]))
      .toEqual({ s: 'held', msg: 'Held for a person to review before it goes live.' });
  });

  it('recovers a REFUSAL, so the reason outlives the tab that filed it', () => {
    // The gate is fail-closed until a scanner is configured, so this is the DEFAULT posture's
    // answer to a public publish — and it was the one outcome the review-queue seed could
    // never see, because a refusal is terminal and leaves that queue.
    const q = [ed({ status: 'rejected', moderationNote: 'Public publishing is closed right now, so this was never checked. Nothing was found in your content.' })];
    expect(hostingJobFor(q)).toEqual({
      s: 'rejected',
      msg: 'Public publishing is closed right now, so this was never checked. Nothing was found in your content.',
    });
  });

  it('recovers a LIVE publication with its baseURI, rather than offering Publish again', () => {
    const q = [ed({ id: 'e4', status: 'published', externalRef: 'https://cdn.example/c1' })];
    expect(hostingJobFor(q)).toEqual({ s: 'ready', url: 'https://cdn.example/c1', kind: 'hosting', editionId: 'e4' });
  });

  it('hands a publication an earlier session left in flight back to the poll', () => {
    // No reviewOutcome and not settled: the worker has not reached it. Dropping it showed a
    // publish control for a publication already on its way.
    expect(hostingJobFor([ed({ id: 'e5' })])).toEqual({ s: 'busy', editionId: 'e5', kind: 'hosting' });
    // Published but the adapter has not written the url yet — the same, not a broken 'ready'.
    expect(hostingJobFor([ed({ id: 'e6', status: 'published' })])).toEqual({ s: 'busy', editionId: 'e6', kind: 'hosting' });
  });

  it('seeds nothing for a retraction — unpublishing is how the button comes back', () => {
    expect(hostingJobFor([ed({ status: 'retracted' })])).toBeNull();
  });

  it('seeds nothing for a stale adapter failure — the publish control IS the retry', () => {
    expect(hostingJobFor([ed({ status: 'failed' })])).toBeNull();
  });

  it('ignores the export-to-you archive — the two destinations are separate publications', () => {
    // A private ZIP is not a hosting publication, and reading one for the other is the bug
    // the per-destination job table exists to prevent.
    const q = [ed({ destination: 'archive', visibility: 'private', status: 'published', externalRef: 'https://cdn.example/z.zip' })];
    expect(hostingJobFor(q)).toBeNull();
  });

  it('takes the newest hosting publication when a collection has been put forth more than once', () => {
    // The server returns this artifact's publications newest first, so the first hosting
    // match is the live one: an older refusal must not speak for a hold standing now.
    const q = [
      ed({ id: 'new', reviewOutcome: 'pending', moderationNote: 'the live one' }),
      ed({ id: 'old', status: 'rejected', moderationNote: 'a stale one' }),
    ];
    expect(hostingJobFor(q)).toEqual({ s: 'held', msg: 'the live one' });
  });

  it('is null on an empty list, so an unpublished collection still gets its button', () => {
    expect(hostingJobFor([])).toBeNull();
  });
});

// The two destinations are two independent publications, and the screen kept ONE slot for
// both — so whichever moved last erased the other. The held publisher is explicitly told
// their "export-to-you download is unaffected", and taking that invitation is what destroyed
// the hold: prepare the ZIP, come back to hosting, and the collection a reviewer was still
// holding read as one nobody had put forth, with the consent box and Publish button back.
// These pin that one destination's job never reaches into another's.
const HELD = { s: 'held', msg: 'Waiting for a person to look at it.' } as const;

describe('putJob — a destination keeps its own job', () => {
  it('leaves a hosting hold standing while the ZIP is prepared, and after it is ready', () => {
    const held = putJob(IDLE_JOBS, 'hosting', HELD);
    const bundling = putJob(held, 'download', { s: 'busy', editionId: 'e2', kind: 'download' });
    expect(bundling.hosting).toEqual(HELD);
    const done = putJob(bundling, 'download', { s: 'ready', url: 'https://cdn.example/z', kind: 'download', editionId: 'e2' });
    expect(done.hosting).toEqual(HELD);
  });

  it('leaves a refusal standing the same way — the download path cannot make it retryable', () => {
    const refused = { s: 'rejected', msg: 'Automated review flagged something in this content, so it was not published.' } as const;
    const after = putJob(putJob(IDLE_JOBS, 'hosting', refused), 'download', { s: 'busy', editionId: 'e2', kind: 'download' });
    expect(after.hosting).toEqual(refused);
  });

  it('does not abandon a ZIP still bundling when a hosting publication starts', () => {
    const bundling = putJob(IDLE_JOBS, 'download', { s: 'busy', editionId: 'e2', kind: 'download' });
    const after = putJob(bundling, 'hosting', { s: 'busy', editionId: 'e3', kind: 'hosting' });
    expect(after.download).toEqual({ s: 'busy', editionId: 'e2', kind: 'download' });
  });

  it('keeps an error with the attempt that produced it, not with the whole screen', () => {
    const after = putJob(putJob(IDLE_JOBS, 'hosting', HELD), 'download', { s: 'err', msg: 'the network went away' });
    expect(after.download).toEqual({ s: 'err', msg: 'the network went away' });
    expect(after.hosting).toEqual(HELD);
  });

  it('starts both destinations idle, so an untouched collection gets both its buttons', () => {
    expect(IDLE_JOBS).toEqual({ download: { s: 'idle' }, hosting: { s: 'idle' } });
  });

  it('does not mutate the table it was given', () => {
    const before = putJob(IDLE_JOBS, 'hosting', HELD);
    putJob(before, 'hosting', { s: 'idle' });
    expect(before.hosting).toEqual(HELD);
  });
});
