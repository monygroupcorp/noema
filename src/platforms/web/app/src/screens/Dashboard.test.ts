import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EMPTY_HOLDINGS, computeRow, holdings, royaltyFigure, royaltyFoot } from './Dashboard';
import type { EarningsView } from '../lib/api';
import type { Project } from '../lib/projects';

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

// The royalties tile used to print a large "◈ 0" for an account that has earned nothing.
// DESIGN.md D-58: the figure appears once there is one; before the read lands the tile holds
// its place (D-61); the foot line carries the empty tile.
describe('royaltyFigure — the number on the royalties tile', () => {
  it('holds its place with a dash before the read lands', () => {
    expect(royaltyFigure(null)).toBe('—');
  });
  it('is absent for a lifetime of nothing, so the foot line carries the tile', () => {
    expect(royaltyFigure(view())).toBeNull();
  });
  it('prints the lifetime once there is one', () => {
    expect(royaltyFigure(view({ lifetime: { impetus: '12500', usd: 4.2 } }))).toBe('12,500');
  });
});

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

// The holdings row under each project card on the dashboard used to print six glyphs each
// reading 0 for a project with nothing in it. DESIGN.md D-58: render the counts that are
// non-zero, or one line saying the item is new.

function project(over: Partial<Project> = {}): Project {
  return {
    id: 'p', name: 'P', glyph: 'P', color: '#000', desc: '', updated: 'just now',
    chats: [], cards: [], canvases: [], gens: 0, datasetIds: [], modelIds: [], collectionIds: [],
    ...over,
  };
}

describe('holdings — the glyph row under a dashboard project card', () => {
  it('returns nothing for a project with nothing in it, so the row prints one line instead of six zeros', () => {
    expect(holdings(project())).toEqual([]);
    expect(EMPTY_HOLDINGS).toBe('nothing in it yet');
  });

  it('keeps only the non-zero holdings, in the spec order', () => {
    const p = project({
      chats: [{ id: 'c', title: 't', when: 'now' }],
      datasetIds: ['d1', 'd2'],
      cards: [{ id: 'k', name: 'n', verb: 'make' }],
    });
    expect(holdings(p)).toEqual([
      { ico: 'message-square', n: 1 },
      { ico: 'database', n: 2 },
      { ico: 'star', n: 1 },
    ]);
  });
});

// DESIGN.md P-1d / D-50: the topbar's "Start" is the home screen's one way to begin; the body
// does not offer a second start button beside it.
describe('the home screen start door', () => {
  const SOURCE = readFileSync(fileURLToPath(new URL('./Dashboard.tsx', import.meta.url)), 'utf8');
  it('carries no start button of its own', () => {
    expect(SOURCE).not.toContain('Create something');
    expect(SOURCE).not.toMatch(/className="btn"[^>]*to="\/catalog"/);
  });
});
