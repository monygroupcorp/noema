import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  aditusFor, applyPublishError, buildPalette, clearPublishError, connectedEdges, dedupeFlows, edgesToTabula,
  FlowNode, hasEditablePorts, loadCanvas, nodesToTabula, portType, publishErrorState, resolveTabulaForModus, restoreEdges,
  restoreNode, schemaToPorts, setNodeAditus, tabulaToEdges, tabulaToNodes,
} from './Canvas';
import { loadFailureKind } from '../components/LoadFailure';
import { ApiRequestError, type JsonSchema } from '../lib/api';
import type { Node, Edge } from '@xyflow/react';

// No jsdom/@testing-library/react in this app's toolchain (see BuyCreditsModal.test.ts) —
// so this exercises the canvas's pure schema/conversion/error-mapping logic rather than a
// full DOM render, per the item's "component test the app supports" allowance.

describe('portType — honestly-derivable port kinds off the wire schema', () => {
  it('media for any format:uri property (image/video/audio/3d all collapse to this on the wire)', () => {
    expect(portType({ type: 'string', format: 'uri' })).toBe('media');
  });
  it('number for integer/number', () => {
    expect(portType({ type: 'integer' })).toBe('number');
    expect(portType({ type: 'number' })).toBe('number');
  });
  it('text for a plain string (no format)', () => {
    expect(portType({ type: 'string' })).toBe('text');
  });
});

describe('schemaToPorts', () => {
  it('empty for a schema with no properties', () => {
    expect(schemaToPorts(undefined)).toEqual([]);
    expect(schemaToPorts({ type: 'object' })).toEqual([]);
  });
  it('projects each property to a labeled, typed port', () => {
    const ports = schemaToPorts({
      type: 'object',
      properties: {
        prompt: { type: 'string', title: 'Prompt' },
        image: { type: 'string', format: 'uri' },
      },
    });
    expect(ports).toEqual([
      { id: 'prompt', label: 'Prompt', type: 'text' },
      { id: 'image', label: 'image', type: 'media' },
    ]);
  });
});

describe('buildPalette — node palette from real flow schemas (no hardcoded demo graph)', () => {
  it('derives inputs/outputs from each flow\'s live input/output schema', () => {
    const inputSchema: JsonSchema = { type: 'object', properties: { prompt: { type: 'string' } } };
    const palette = buildPalette([
      {
        id: 'make-upscale', nomen: 'FLUX Schnell', versio: '1.0.0',
        input: inputSchema,
        output: { type: 'object', properties: { image: { type: 'string', format: 'uri' } } },
      },
    ]);
    expect(palette).toEqual([{
      modusId: 'make-upscale', nomen: 'FLUX Schnell', versio: '1.0.0',
      inputs: [{ id: 'prompt', label: 'prompt', type: 'text' }],
      outputs: [{ id: 'image', label: 'image', type: 'media' }],
      inputSchema,
    }]);
  });
});

describe('dedupeFlows', () => {
  it('unions canonical + owner\'s-own flows by id', () => {
    const out = dedupeFlows(
      [{ id: 'a' }, { id: 'b' }],
      [{ id: 'b' }, { id: 'c' }],
    );
    expect(out.map((f) => f.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('resolveTabulaForModus — which tabula ?modusId= reopens (noema-224)', () => {
  const tabulae = [
    { id: 't1', modusId: 'm-old' },
    { id: 't2', modusId: 'm-target' },
  ];

  it('resolves to the tabula whose modusId matches, not just the first', () => {
    expect(resolveTabulaForModus(tabulae, 'm-target')).toEqual(tabulae[1]);
  });

  it('falls back to the most-recent tabula only when no match exists', () => {
    expect(resolveTabulaForModus(tabulae, 'm-nonexistent')).toEqual(tabulae[0]);
    expect(resolveTabulaForModus(tabulae, undefined)).toEqual(tabulae[0]);
  });
});

describe('Tabula <-> React Flow round trip (save/load)', () => {
  const paletteInputSchema: JsonSchema = { type: 'object', properties: { prompt: { type: 'string', title: 'Prompt' } } };
  const palette = [{ modusId: 'make-upscale', nomen: 'FLUX Schnell', versio: '1.0.0', inputs: [], outputs: [{ id: 'image', label: 'image', type: 'media' as const }], inputSchema: paletteInputSchema }];
  const tabula = {
    nodi: [{ id: 'n1', modusId: 'make-upscale', x: 40, y: 60, aditus: { prompt: 'a dragon' } }],
    vincula: [{ id: 'e1', fonteNodusId: 'n1', fontePorta: 'image', scopusNodusId: 'n2', scopusPorta: 'in', discordantia: false }],
  };

  it('loads a saved Tabula into React Flow nodes/edges carrying the real palette ports', () => {
    const nodes = tabulaToNodes(tabula, palette);
    expect(nodes).toEqual([{
      id: 'n1', type: 'flow', position: { x: 40, y: 60 },
      data: { modusId: 'make-upscale', name: 'FLUX Schnell', badge: '1.0.0', color: expect.any(String), inputs: [], outputs: palette[0].outputs, aditus: { prompt: 'a dragon' }, inputSchema: paletteInputSchema },
    }]);
    const edges = tabulaToEdges(tabula);
    expect(edges).toEqual([{ id: 'e1', source: 'n1', sourceHandle: 'image', target: 'n2', targetHandle: 'in' }]);
  });

  it('saves React Flow nodes/edges back to the exact Tabula wire shape', () => {
    const nodes = tabulaToNodes(tabula, palette);
    const edges = tabulaToEdges(tabula);
    expect(nodesToTabula(nodes)).toEqual(tabula.nodi);
    expect(edgesToTabula(edges)).toEqual(tabula.vincula);
  });
});

describe('publish-error-on-edge (AMENDMENT v2)', () => {
  function apiError(code: string, message: string, details?: Record<string, unknown>): ApiRequestError {
    return { name: 'ApiRequestError', code, message, status: 400, details } as ApiRequestError;
  }

  it('names the offending edge + short code for a wire-specific graph error', () => {
    const state = publishErrorState(apiError('input.invalid_graph', 'The graph contains a cycle', { code: 'cycle', vinculumId: 'e1' }));
    expect(state).toEqual({ message: 'The graph contains a cycle', edgeId: 'e1', label: 'cycle' });
  });

  it('falls back to a banner-only message when the graph error names no edge (e.g. empty graph)', () => {
    const state = publishErrorState(apiError('input.invalid_graph', 'The graph is empty', { code: 'empty' }));
    expect(state).toEqual({ message: 'The graph is empty' });
  });

  it('falls back to a banner-only message for a non-graph error', () => {
    const state = publishErrorState(apiError('not_found.tabula', "Tabula 'x' not found"));
    expect(state).toEqual({ message: "Tabula 'x' not found" });
  });

  it('highlights only the offending edge red+dashed with its code as the label; others are untouched', () => {
    const edges: Edge[] = [{ id: 'e1', source: 'a', target: 'b' }, { id: 'e2', source: 'b', target: 'c' }];
    const styled = applyPublishError(edges, { message: 'cycle', edgeId: 'e1', label: 'cycle' });
    expect(styled[0]).toMatchObject({ id: 'e1', label: 'cycle', style: { stroke: '#e0554f', strokeDasharray: '6 4' } });
    expect(styled[1]).toMatchObject({ id: 'e2', style: undefined, label: undefined });
  });

  it('clears every edge\'s highlight/label on graph edit or successful publish', () => {
    const edges: Edge[] = [{ id: 'e1', source: 'a', target: 'b', style: { stroke: 'red' }, label: 'cycle' }];
    expect(clearPublishError(edges)).toEqual([{ id: 'e1', source: 'a', target: 'b', style: undefined, label: undefined }]);
  });
});

describe('node delete affordance — trash-2 control renders in the node header', () => {
  // No jsdom/@testing-library/react in this app's toolchain (see the file-top note) — so
  // presence is exercised via a static server render (no click simulation available either
  // way; the cascade/undo behavior below is covered as pure state transitions instead).
  it('renders a trash-2 delete button in the header, wired to onDelete(id)', () => {
    const onDelete = vi.fn();
    const data = { modusId: 'make-upscale', name: 'FLUX Schnell', badge: '1.0.0', color: '#000', inputs: [], outputs: [], aditus: {} };
    const props = { id: 'n1', data, onDelete } as unknown as Parameters<typeof FlowNode>[0];
    const html = renderToStaticMarkup(createElement(FlowNode, props));
    expect(html).toContain('cn-delete');
    expect(html).toContain('Delete FLUX Schnell');
  });
});

describe('connectedEdges — edges touching a given node (either end)', () => {
  it('matches edges where the node is source or target, ignores the rest', () => {
    const edges: Edge[] = [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n3', target: 'n1' },
      { id: 'e3', source: 'n2', target: 'n3' },
    ];
    expect(connectedEdges(edges, 'n1').map((e) => e.id)).toEqual(['e1', 'e2']);
  });
  it('empty for a node with no edges', () => {
    expect(connectedEdges([{ id: 'e1', source: 'n2', target: 'n3' }], 'n1')).toEqual([]);
  });
});

describe('delete cascade + undo restore — pure state transitions', () => {
  const flowData = { modusId: 'make-upscale', name: 'FLUX Schnell', badge: '1.0.0', color: '#000', inputs: [], outputs: [], aditus: {} };
  const node: Node<typeof flowData> = { id: 'n1', type: 'flow', position: { x: 0, y: 0 }, data: flowData };
  const deletedEdges: Edge[] = [{ id: 'e1', source: 'n1', target: 'n2' }];

  it('restoreNode re-adds a previously-deleted node to state', () => {
    expect(restoreNode([], node)).toEqual([node]);
  });
  it('restoreNode is a no-op if the node id is already present (no dupes)', () => {
    expect(restoreNode([node], node)).toEqual([node]);
  });
  it('restoreEdges re-adds the node\'s previously-connected edges', () => {
    expect(restoreEdges([], deletedEdges)).toEqual(deletedEdges);
  });
  it('restoreEdges skips edges already present (no dupes)', () => {
    expect(restoreEdges(deletedEdges, deletedEdges)).toEqual(deletedEdges);
  });
  it('undo (restoreNode + restoreEdges) reconstructs exactly the pre-delete graph', () => {
    const nodesBefore: Node<typeof flowData>[] = [{ id: 'n0', type: 'flow', position: { x: 0, y: 0 }, data: flowData }, node];
    const edgesBefore: Edge[] = [...deletedEdges];
    // simulate the cascade delete: node + its edges removed from state
    const nodesAfterDelete = nodesBefore.filter((n) => n.id !== 'n1');
    const edgesAfterDelete = edgesBefore.filter((e) => e.id !== 'e1');
    // undo re-adds both
    const restoredNodes = restoreNode(nodesAfterDelete, node);
    const restoredEdges = restoreEdges(edgesAfterDelete, connectedEdges(edgesBefore, 'n1'));
    expect(restoredNodes).toEqual(nodesBefore);
    expect(restoredEdges).toEqual(edgesBefore);
  });
});

describe('node parameter panel — per-node aditus editing (noema-217)', () => {
  // No jsdom/@testing-library/react in this app's toolchain (see the file-top note) — so
  // the panel's click-to-open/edit-writes-aditus behavior is covered as pure state
  // transitions on the same functions Canvas() wires into onNodeClick/onChange, mirroring
  // the delete/undo tests above.
  const promptSchema: JsonSchema = { type: 'object', properties: { prompt: { type: 'string', title: 'Prompt' } } };
  const flowDataWith = (aditus: Record<string, unknown>) => ({
    modusId: 'make-upscale', name: 'FLUX Schnell', badge: '1.0.0', color: '#000',
    inputs: [{ id: 'prompt', label: 'Prompt', type: 'text' as const }], outputs: [],
    aditus, inputSchema: promptSchema,
  });
  const nodeA: Node<ReturnType<typeof flowDataWith>> = { id: 'n1', type: 'flow', position: { x: 0, y: 0 }, data: flowDataWith({ prompt: 'a dragon' }) };
  const nodeB: Node<ReturnType<typeof flowDataWith>> = { id: 'n2', type: 'flow', position: { x: 0, y: 0 }, data: flowDataWith({ prompt: 'a phoenix' }) };

  it('hasEditablePorts is true for a node with a text or media input port', () => {
    expect(hasEditablePorts([{ id: 'prompt', label: 'Prompt', type: 'text' }])).toBe(true);
    expect(hasEditablePorts([{ id: 'image', label: 'Image', type: 'media' }])).toBe(true);
  });

  it('hasEditablePorts is false for a node with no text/media input ports — no panel trigger', () => {
    expect(hasEditablePorts([{ id: 'steps', label: 'Steps', type: 'number' }])).toBe(false);
    expect(hasEditablePorts([])).toBe(false);
  });

  it('editing a node\'s prompt writes into that node\'s aditus, which nodesToTabula persists', () => {
    const updated = setNodeAditus([nodeA, nodeB], 'n1', 'prompt', 'a new dragon');
    expect(aditusFor(updated, 'n1')).toEqual({ prompt: 'a new dragon' });
    expect(nodesToTabula(updated).find((n) => n.id === 'n1')?.aditus).toEqual({ prompt: 'a new dragon' });
  });

  it('editing node A leaves node B\'s values untouched — clicking node B does not show node A\'s values', () => {
    const updated = setNodeAditus([nodeA, nodeB], 'n1', 'prompt', 'a new dragon');
    expect(aditusFor(updated, 'n2')).toEqual({ prompt: 'a phoenix' });
  });
});

// ── loadCanvas — the screen's one load, and what a visitor sees when it fails ──────────
// The canvas used to await its reads in an effect with no catch: a visitor whose load failed
// — a refused caller, a 5xx, a dropped connection — stayed on "Loading canvas…" for good.
// The load now rejects to the screen, which maps the rejection to a LoadFailure kind. No
// jsdom here (see above): an in-memory localStorage stands in for the anonymous commitment
// store and a fetch stub for the server.
describe('loadCanvas — the rejection reaches the screen, with the kind it shows', () => {
  const store = new Map<string, string>();
  const localStorageStub = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const flows = [{ id: 'f1', nomen: 'Flow one', versio: '1.0.0' }];
  const described = { id: 'f1', nomen: 'Flow one', versio: '1.0.0', input: { type: 'object', properties: {} }, output: { type: 'object', properties: {} } };
  const draft = { id: 't1', nomen: 'Untitled canvas', nodi: [], vincula: [] };

  // The server as an anonymous visitor meets it, with one path's answer overridden.
  function serve(overrides: Record<string, () => Response> = {}) {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const key = `${method} ${url}`;
      if (overrides[key]) return overrides[key]();
      if (key === 'GET /v1/flows') return json({ flows });
      if (key === 'GET /v1/me/flows') return json({ flows: [] });
      if (key === 'GET /v1/flows/f1') return json(described);
      if (key === 'GET /v1/tabulae') return json({ tabulae: [] });
      if (key === 'POST /v1/tabulae') return json({ tabula: draft }, 201);
      return json({ error: { code: 'not_found', message: `no route ${key}` } }, 404);
    });
  }

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', localStorageStub);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('a visitor with no session gets the palette and a draft of their own — no gate', async () => {
    const fetchSpy = serve();
    vi.stubGlobal('fetch', fetchSpy);
    const { palette, tabula } = await loadCanvas(undefined);
    expect(palette.map((p) => p.modusId)).toEqual(['f1']);
    expect(tabula.id).toBe('t1');
    // Every owner-scoped read carried the anonymous commitment; nothing was refused.
    const ownerScoped = fetchSpy.mock.calls.filter(([u]) => /\/v1\/(me\/flows|tabulae)$/.test(String(u)));
    expect(ownerScoped).toHaveLength(3);
    for (const [, init] of ownerScoped) expect((init?.headers as Record<string, string>)['x-commitment']).toMatch(/^0x/);
  });

  it('a server that refuses the caller rejects with its 403, which the screen shows as the door', async () => {
    vi.stubGlobal('fetch', serve({ 'GET /v1/tabulae': () => json({ error: { code: 'auth.forbidden', message: 'tabulae require an identified account' } }, 403) }));
    const err = await loadCanvas(undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 403 });
    expect(loadFailureKind(err)).toBe('signin');
  });

  it('a 5xx on any read rejects, which the screen shows with a retry', async () => {
    vi.stubGlobal('fetch', serve({ 'GET /v1/me/flows': () => json({ error: { code: 'internal', message: 'upstream unavailable' } }, 503) }));
    const err = await loadCanvas(undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 503 });
    expect(loadFailureKind(err)).toBe('transient');
  });

  it('a connection that drops rejects too — the loader is never terminal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const err = await loadCanvas(undefined).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(loadFailureKind(err)).toBe('transient');
  });

  it('a load the screen has left creates no draft on its behalf', async () => {
    const fetchSpy = serve();
    vi.stubGlobal('fetch', fetchSpy);
    const controller = new AbortController();
    controller.abort();
    const err = await loadCanvas(undefined, controller.signal).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(fetchSpy.mock.calls.some(([, init]) => (init?.method ?? 'GET') === 'POST')).toBe(false);
  });

  it('?modusId= reopens that flow\'s own tabula without creating a draft', async () => {
    const mine = { id: 't9', nomen: 'Mine', modusId: 'f1', nodi: [], vincula: [] };
    const fetchSpy = serve({ 'GET /v1/tabulae': () => json({ tabulae: [draft, mine] }) });
    vi.stubGlobal('fetch', fetchSpy);
    const { tabula } = await loadCanvas('f1');
    expect(tabula.id).toBe('t9');
    expect(fetchSpy.mock.calls.some(([, init]) => (init?.method ?? 'GET') === 'POST')).toBe(false);
  });
});
