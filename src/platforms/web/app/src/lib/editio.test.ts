import { describe, expect, it } from 'vitest';
import { publishNote, publishOutcome, type Editio } from './editio';

// The publish surfaces (Shelf, Card, EditioHub, EditioExport) have no DOM test harness in this
// app's toolchain, so what is exercised here is the classification they all now share — the
// point being that `status` alone is not enough to tell a publisher what happened.

function ed(over: Partial<Editio> = {}): Editio {
  return {
    id: 'ed_1',
    artifact: { kind: 'intella', id: 'in_1' },
    destination: 'huggingface',
    visibility: 'unlisted',
    custody: 'ours',
    status: 'pending',
    createdAt: '2026-09-04T00:00:00.000Z',
    updatedAt: '2026-09-04T00:00:00.000Z',
    ...over,
  };
}

describe('publishOutcome — the one axis a publisher is told about', () => {
  it('reads a moderation HOLD off reviewOutcome, not status', () => {
    // The whole trap: a held publication keeps status:'pending' forever.
    expect(publishOutcome(ed({ status: 'pending', reviewOutcome: 'pending' }))).toBe('held');
  });

  it('is settling for a publication that is genuinely still working', () => {
    expect(publishOutcome(ed({ status: 'pending' }))).toBe('settling');
  });

  it('separates a gate refusal from an adapter failure', () => {
    expect(publishOutcome(ed({ status: 'rejected' }))).toBe('refused');
    expect(publishOutcome(ed({ status: 'failed' }))).toBe('failed');
  });

  it('treats a reviewer-declined hold as the same refusal as an automatic one', () => {
    expect(publishOutcome(ed({ status: 'rejected', reviewOutcome: 'rejected' }))).toBe('refused');
  });

  it('is live once published, even though an approved hold still carries reviewOutcome', () => {
    expect(publishOutcome(ed({ status: 'published', reviewOutcome: 'approved' }))).toBe('live');
  });

  it('is withdrawn after a retract', () => {
    expect(publishOutcome(ed({ status: 'retracted' }))).toBe('withdrawn');
  });
});

describe('publishNote — a refusal is never explained by nothing', () => {
  it('uses the server note when the API sends one', () => {
    expect(publishNote(ed({ status: 'rejected', moderationNote: 'Automated review flagged something in this content, so it was not published.' })))
      .toBe('Automated review flagged something in this content, so it was not published.');
  });

  it('falls back when the API build predates the field, and tells a hold from a refusal', () => {
    expect(publishNote(ed({ status: 'rejected' }))).toBe('Refused by automated review.');
    expect(publishNote(ed({ status: 'pending', reviewOutcome: 'pending' })))
      .toBe('Held for a person to review before it goes live.');
  });

  it('never invents a finding the server did not report', () => {
    // The old fallback said "Flagged by automated review." for everything, including a hold
    // under the blanket manual-review posture, where nothing had been inspected at all.
    expect(publishNote(ed({ status: 'pending', reviewOutcome: 'pending' })))
      .not.toContain('Flagged');
  });
});
