import { describe, expect, it } from 'vitest';
import {
  applyPublishError, buildPalette, clearPublishError, dedupeFlows, edgesToTabula,
  nodesToTabula, portType, publishErrorState, schemaToPorts, tabulaToEdges, tabulaToNodes,
} from './Canvas';
import type { ApiRequestError } from '../lib/api';
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
    const palette = buildPalette([
      {
        id: 'make-upscale', nomen: 'FLUX Schnell', versio: '1.0.0',
        input: { type: 'object', properties: { prompt: { type: 'string' } } },
        output: { type: 'object', properties: { image: { type: 'string', format: 'uri' } } },
      },
    ]);
    expect(palette).toEqual([{
      modusId: 'make-upscale', nomen: 'FLUX Schnell', versio: '1.0.0',
      inputs: [{ id: 'prompt', label: 'prompt', type: 'text' }],
      outputs: [{ id: 'image', label: 'image', type: 'media' }],
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

describe('Tabula <-> React Flow round trip (save/load)', () => {
  const palette = [{ modusId: 'make-upscale', nomen: 'FLUX Schnell', versio: '1.0.0', inputs: [], outputs: [{ id: 'image', label: 'image', type: 'media' as const }] }];
  const tabula = {
    nodi: [{ id: 'n1', modusId: 'make-upscale', x: 40, y: 60, aditus: { prompt: 'a dragon' } }],
    vincula: [{ id: 'e1', fonteNodusId: 'n1', fontePorta: 'image', scopusNodusId: 'n2', scopusPorta: 'in', discordantia: false }],
  };

  it('loads a saved Tabula into React Flow nodes/edges carrying the real palette ports', () => {
    const nodes = tabulaToNodes(tabula, palette);
    expect(nodes).toEqual([{
      id: 'n1', type: 'flow', position: { x: 40, y: 60 },
      data: { modusId: 'make-upscale', name: 'FLUX Schnell', badge: '1.0.0', color: expect.any(String), inputs: [], outputs: palette[0].outputs, aditus: { prompt: 'a dragon' } },
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
