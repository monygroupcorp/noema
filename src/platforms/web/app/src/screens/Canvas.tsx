import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ReactFlow, Background, BackgroundVariant, Controls, Handle, Position,
  addEdge, useNodesState, useEdgesState,
  type Node, type Edge, type Connection, type NodeProps, type NodeMouseHandler, type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import {
  api, ApiRequestError,
  type FlowDescription, type FlowSummary, type JsonSchema, type Tabula, type TabulaNodus, type TabulaVinculum,
} from '../lib/api';
import './canvas.css';

// ── Ports — real aditus/exitus, derived from a flow's live JSON-Schema ──────────
// aditusToJsonSchema.ts collapses image/video/audio/3d ports to the same
// `{ type: 'string', format: 'uri' }` — there's no signal left on the wire to tell
// them apart, so ports bucket into three honestly-derivable kinds. No fictional
// per-media-type colors (the old demo graph's text/image/video/audio/3d palette).
export type PortType = 'text' | 'number' | 'media';
export interface Port { id: string; label: string; type: PortType }
const PORT_COLOR: Record<PortType, string> = { text: '#5fd0a8', number: '#d68f6f', media: '#5b8cff' };

export function portType(prop: { type: string; format?: string }): PortType {
  if (prop.format === 'uri') return 'media';
  if (prop.type === 'integer' || prop.type === 'number') return 'number';
  return 'text';
}

export function schemaToPorts(schema?: JsonSchema): Port[] {
  if (!schema?.properties) return [];
  return Object.entries(schema.properties).map(([id, prop]) => ({ id, label: prop.title ?? id, type: portType(prop) }));
}

// One placeable node kind on the canvas — a flow's real ports, not the hardcoded demo.
// `inputSchema` carries the flow's full live input JSON-Schema (titles/descriptions/optiones) —
// `inputs` (Port[]) alone is only id/label/type, not enough to build the node parameter panel's form.
export interface PaletteEntry { modusId: string; nomen: string; versio: string; inputs: Port[]; outputs: Port[]; inputSchema: JsonSchema }

export function buildPalette(flows: FlowDescription[]): PaletteEntry[] {
  return flows.map((f) => ({ modusId: f.id, nomen: f.nomen, versio: f.versio, inputs: schemaToPorts(f.input), outputs: schemaToPorts(f.output), inputSchema: f.input }));
}

// The canonical catalog (GET /v1/flows) plus the caller's own (GET /v1/me/flows,
// the picker's owner-scoped twin) — deduped by id for the palette.
export function dedupeFlows(canonical: FlowSummary[], mine: FlowSummary[]): FlowSummary[] {
  const byId = new Map<string, FlowSummary>();
  for (const f of canonical) byId.set(f.id, f);
  for (const f of mine) byId.set(f.id, f);
  return [...byId.values()];
}

// A small fixed rotation of node colors, hashed off modusId for stable variety —
// real flows carry no "compute visibility" field to color by (that was demo flourish).
const NODE_GRADIENTS = [
  'linear-gradient(160deg,#5fd0a8,#1c4a3c)',
  'linear-gradient(160deg,var(--accent),#23264f)',
  'linear-gradient(160deg,#9a8fd6,#2b2456)',
  'linear-gradient(160deg,#d68f6f,#4a261c)',
];
export function colorFor(modusId: string): string {
  let h = 0;
  for (let i = 0; i < modusId.length; i++) h = (h * 31 + modusId.charCodeAt(i)) | 0;
  return NODE_GRADIENTS[Math.abs(h) % NODE_GRADIENTS.length];
}

interface FlowData {
  modusId: string; name: string; badge: string; color: string;
  inputs: Port[]; outputs: Port[]; aditus: Record<string, unknown>;
  // The flow's live input schema, carried per-node so the parameter panel can build its
  // form the same way Card.tsx does — see buildPalette's PaletteEntry.inputSchema.
  inputSchema?: JsonSchema;
  [k: string]: unknown;
}

// ── Tabula <-> React Flow conversions (pure — save/load/autosave + tests) ────────
export function nodesToTabula(nodes: Node<FlowData>[]): TabulaNodus[] {
  return nodes.map((n) => ({ id: n.id, modusId: n.data.modusId, x: n.position.x, y: n.position.y, aditus: n.data.aditus ?? {} }));
}

export function edgesToTabula(edges: Edge[]): TabulaVinculum[] {
  return edges.map((e) => ({
    id: e.id,
    fonteNodusId: e.source,
    fontePorta: e.sourceHandle ?? '',
    scopusNodusId: e.target,
    scopusPorta: e.targetHandle ?? '',
    discordantia: Boolean((e.data as { discordantia?: boolean } | undefined)?.discordantia),
  }));
}

export function tabulaToNodes(tabula: Pick<Tabula, 'nodi'>, palette: PaletteEntry[]): Node<FlowData>[] {
  const byId = new Map(palette.map((p) => [p.modusId, p]));
  return tabula.nodi.map((n) => {
    const entry = byId.get(n.modusId);
    return {
      id: n.id,
      type: 'flow',
      position: { x: n.x, y: n.y },
      data: {
        modusId: n.modusId,
        name: entry?.nomen ?? n.modusId,
        badge: entry?.versio ?? '',
        color: colorFor(n.modusId),
        inputs: entry?.inputs ?? [],
        outputs: entry?.outputs ?? [],
        aditus: n.aditus ?? {},
        inputSchema: entry?.inputSchema,
      },
    };
  });
}

export function tabulaToEdges(tabula: Pick<Tabula, 'vincula'>): Edge[] {
  return tabula.vincula.map((v) => ({
    id: v.id,
    source: v.fonteNodusId,
    sourceHandle: v.fontePorta,
    target: v.scopusNodusId,
    targetHandle: v.scopusPorta,
    ...(v.discordantia ? { data: { discordantia: true } } : {}),
  }));
}

// Which Tabula to load on open. A direct link from a minted flow's catalog card
// (?modusId=) should reopen that flow's own draft, not always the most-recently-saved
// one. Falls back to tabulae[0] (the existing "most recent" behavior) when no modusId
// is given, or when none of the caller's tabulae carry it.
export function resolveTabulaForModus<T extends Pick<Tabula, 'modusId'>>(tabulae: T[], modusId?: string): T | undefined {
  const match = modusId ? tabulae.find((t) => t.modusId === modusId) : undefined;
  return match ?? tabulae[0];
}

// ── Publish-error-on-edge (AMENDMENT v2 — the one judgment call in this item) ────
// No FocusDemo overlay exists (repo-wide search found none — the spec referenced
// something imaginary). Built to spec instead: on a 400 `input.invalid_graph`, the
// offending edge (details.vinculumId) turns red+dashed with its short code as the
// edge label, PLUS one dismissible banner showing the server's full message. Nothing
// else — no new overlay component, no tooltip system.
export interface PublishErrorState { message: string; edgeId?: string; label?: string }

export function publishErrorState(err: ApiRequestError): PublishErrorState {
  const details = err.details as { code?: string; vinculumId?: string } | undefined;
  if (err.code === 'input.invalid_graph' && details?.vinculumId) {
    return { message: err.message, edgeId: details.vinculumId, label: details.code };
  }
  return { message: err.message };
}

export function applyPublishError(edges: Edge[], state: PublishErrorState): Edge[] {
  return edges.map((e) =>
    e.id === state.edgeId
      ? { ...e, style: { stroke: '#e0554f', strokeWidth: 2, strokeDasharray: '6 4' }, label: state.label }
      : { ...e, style: undefined, label: undefined },
  );
}

export function clearPublishError(edges: Edge[]): Edge[] {
  return edges.map((e) => ({ ...e, style: undefined, label: undefined }));
}

const AUTOSAVE_DEBOUNCE_MS = 1500;

// ── Node delete + undo (pure — capture/restore, cascade itself is xyflow's own) ──
// The app's test toolchain has no jsdom/@testing-library/react (see BuyCreditsModal.test.ts's
// own note) — so delete/cascade/undo are covered here as pure state transitions on
// nodes/edges, with the trash-2 button's presence covered via react-dom/server static
// markup (no DOM event simulation available either way).
export function connectedEdges(edges: Edge[], nodeId: string): Edge[] {
  return edges.filter((e) => e.source === nodeId || e.target === nodeId);
}

export function restoreNode(nodes: Node<FlowData>[], node: Node<FlowData>): Node<FlowData>[] {
  if (nodes.some((n) => n.id === node.id)) return nodes;
  return [...nodes, node];
}

export function restoreEdges(edges: Edge[], toRestore: Edge[]): Edge[] {
  const existing = new Set(edges.map((e) => e.id));
  return [...edges, ...toRestore.filter((e) => !existing.has(e.id))];
}

// ── Node parameter panel (pure — selection/edit state transitions) ──────────────
// A flow's steps had no authoring surface: TabulaNodus.aditus round-tripped through
// nodesToTabula/tabulaToNodes and autosaved already, but nothing client-side let a user
// set it. This is the missing write path — click a node, edit its aditus, same autosave.
// Covered here as pure state transitions (see the delete/undo note above — no DOM
// event simulation available either way in this app's test toolchain).

// A node with no text/media input port has nothing to author — no panel trigger for it.
export function hasEditablePorts(inputs: Port[]): boolean {
  return inputs.some((p) => p.type !== 'number');
}

// The aditus values to show in the panel for a given node — scoped to that node only,
// so selecting a different node never bleeds another node's values into the form.
export function aditusFor(nodes: Node<FlowData>[], nodeId: string): Record<string, unknown> {
  return nodes.find((n) => n.id === nodeId)?.data.aditus ?? {};
}

// Write one field's edited value into that node's data.aditus. The existing autosave
// effect (keyed on `nodes`) picks up the change and persists it via nodesToTabula —
// no new save mechanism.
export function setNodeAditus(nodes: Node<FlowData>[], nodeId: string, key: string, value: unknown): Node<FlowData>[] {
  return nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, aditus: { ...n.data.aditus, [key]: value } } } : n));
}

const ROW = 26, HEAD = 41, PAD = 8;
const handleTop = (i: number) => HEAD + PAD + i * ROW + 13;

export function FlowNode({ id, data, onDelete }: NodeProps<Node<FlowData>> & { onDelete: (nodeId: string) => void }) {
  return (
    <div className="cnode">
      <div className="cnode-head">
        <span className="cn-fav" style={{ background: data.color }} />
        <b>{data.name}</b>
        {data.badge && <span className="badge accent">{data.badge}</span>}
        <button
          type="button"
          className="btn ghost bad sm nodrag cn-delete"
          onClick={() => onDelete(id)}
          aria-label={`Delete ${data.name}`}
        >
          <Ic name="trash-2" />
        </button>
      </div>
      <div className="cnode-body">
        <div className="cn-col">
          {data.inputs.map((p, i) => (
            <div className="cn-row" key={p.id}>
              <Handle type="target" position={Position.Left} id={p.id} className="cn-handle" style={{ top: handleTop(i), background: PORT_COLOR[p.type] }} />
              <span className="port">{p.label}</span>
            </div>
          ))}
        </div>
        <div className="cn-col">
          {data.outputs.map((p, i) => (
            <div className="cn-row out" key={p.id}>
              <span className="port">{p.label}</span>
              <Handle type="source" position={Position.Right} id={p.id} className="cn-handle" style={{ top: handleTop(i), background: PORT_COLOR[p.type] }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// The per-node parameter panel — a node's own input schema turned into a form, reusing
// the exact field-generation pattern Card.tsx already proves out (flow.input.properties
// -> field, prompt-shaped strings get a textarea). Card.tsx is out of scope_dirs for this
// item, so the pattern is reapplied here rather than extracted into a shared import — no
// second schema-to-form *mechanism*, same generation rules. No Concierge assist / LoRA
// trigger highlight (Card.tsx-only, explicit non-goal here): a plain field is enough to
// unblock authoring.
export function NodeParamPanel({ node, onChange, onClose }: {
  node: Node<FlowData>;
  onChange: (key: string, value: unknown) => void;
  onClose: () => void;
}) {
  const properties = node.data.inputSchema?.properties ?? {};
  const aditus = node.data.aditus ?? {};
  return (
    <div className="canvas-node-panel">
      <div className="cnp-head">
        <b>{node.data.name}</b>
        <button type="button" className="btn ghost sm" onClick={onClose} aria-label="Close panel">
          <Ic name="x" />
        </button>
      </div>
      <div className="cnp-body">
        {Object.entries(properties).map(([k, p]) => {
          const isUri = p.format === 'uri';
          const isNum = p.type === 'integer' || p.type === 'number';
          const isText = p.type === 'string' && !isUri;
          const isLong = isText && /prompt|lyric|story|description|caption|text|message|content/i.test(k);
          const hasOptiones = Array.isArray(p.optiones) && p.optiones.length > 0;
          return (
            <div className="field" key={k}>
              <label>{p.title || k}</label>
              {hasOptiones ? (
                <select className="inp" value={String(aditus[k] ?? p.default ?? '')} onChange={(e) => onChange(k, e.target.value)}>
                  {p.optiones!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : isUri ? (
                <input className="inp" value={String(aditus[k] ?? '')} placeholder={p.description || 'paste a URL'} onChange={(e) => onChange(k, e.target.value)} />
              ) : isNum ? (
                <input className="inp mono" type="number" value={aditus[k] === '' || aditus[k] === undefined ? '' : Number(aditus[k])} placeholder={p.description} onChange={(e) => onChange(k, e.target.value === '' ? '' : Number(e.target.value))} />
              ) : isLong ? (
                <textarea className="ta2" value={String(aditus[k] ?? '')} placeholder={p.description} onChange={(e) => onChange(k, e.target.value)} />
              ) : (
                <input className="inp" value={String(aditus[k] ?? '')} placeholder={p.description} onChange={(e) => onChange(k, e.target.value)} />
              )}
            </div>
          );
        })}
        {Object.keys(properties).length === 0 && <div className="cnp-empty">No parameters.</div>}
      </div>
    </div>
  );
}

export function Canvas() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Set only when opened from a minted flow's catalog card ("Edit in Canvas") — the
  // caller's own tabula for that flow, not the most-recently-saved one. See
  // resolveTabulaForModus.
  const modusId = searchParams.get('modusId') || undefined;
  const [tabula, setTabula] = useState<Tabula | null>(null);
  const [palette, setPalette] = useState<PaletteEntry[]>([]);
  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<Node<FlowData>>([]);
  const [edges, setEdges, onEdgesChangeRaw] = useEdgesState<Edge>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<PublishErrorState | null>(null);
  const [undoToast, setUndoToast] = useState<{ nodeName: string } | null>(null);
  // The node whose parameter panel is open — id only, so it self-heals off `nodes` (a
  // delete/undo cycle, or an autosave-triggered node replacement, never shows stale data).
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipNextSave = useRef(true);
  const rfInstance = useRef<ReactFlowInstance<Node<FlowData>, Edge> | null>(null);
  const nodesRef = useRef<Node<FlowData>[]>(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef<Edge[]>(edges);
  edgesRef.current = edges;
  const pendingUndo = useRef<{ node: Node<FlowData>; edges: Edge[] } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load the palette (canonical + owner's own flows, real ports) and the caller's
  // current Tabula — the most recently saved one, or a fresh draft if they have none.
  // Reopening /canvas lands back on the same workspace (no separate picker UI in scope).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ flows: canonical }, { flows: mine }] = await Promise.all([api.listFlows(), api.listMyFlows()]);
      const described = await Promise.all(dedupeFlows(canonical, mine).map((f) => api.getFlow(f.id)));
      if (cancelled) return;
      const built = buildPalette(described);
      setPalette(built);

      const { tabulae } = await api.listTabulae();
      const current = resolveTabulaForModus(tabulae, modusId) ?? (await api.createTabula({ nomen: 'Untitled canvas' })).tabula;
      if (cancelled) return;
      setTabula(current);
      setNodes(tabulaToNodes(current, built));
      setEdges(tabulaToEdges(current));
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave — debounced ~1.5s after any node/edge change, skipping the initial load.
  useEffect(() => {
    if (loading || !tabula) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    setSaveState('saving');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.updateTabula(tabula.id, { nodi: nodesToTabula(nodes), vincula: edgesToTabula(edges) })
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('idle'));
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, loading, tabula]);

  const dismissError = useCallback(() => {
    setError(null);
    setEdges((eds) => clearPublishError(eds));
  }, [setEdges]);

  const onNodesChange = useCallback((changes: Parameters<typeof onNodesChangeRaw>[0]) => {
    onNodesChangeRaw(changes);
    if (error) dismissError();
  }, [onNodesChangeRaw, error, dismissError]);

  const onEdgesChange = useCallback((changes: Parameters<typeof onEdgesChangeRaw>[0]) => {
    onEdgesChangeRaw(changes);
    if (error) dismissError();
  }, [onEdgesChangeRaw, error, dismissError]);

  const onConnect = useCallback((c: Connection) => {
    setEdges((eds) => addEdge(c, eds));
    if (error) dismissError();
  }, [setEdges, error, dismissError]);

  const addNode = useCallback((entry: PaletteEntry) => {
    const id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const count = nodes.length;
    const node: Node<FlowData> = {
      id,
      type: 'flow',
      position: { x: 80 + (count % 4) * 260, y: 80 + Math.floor(count / 4) * 180 },
      data: { modusId: entry.modusId, name: entry.nomen, badge: entry.versio, color: colorFor(entry.modusId), inputs: entry.inputs, outputs: entry.outputs, aditus: {}, inputSchema: entry.inputSchema },
    };
    setNodes((ns) => [...ns, node]);
  }, [nodes.length, setNodes]);

  // Delete a placed node: capture it + its connected edges for undo, then let xyflow's
  // own deleteElements drive the cascade (same onNodesChange/onEdgesChange path as any
  // other graph edit) — no hand-rolled edge filtering on the removal side.
  const deleteNode = useCallback((nodeId: string) => {
    const target = nodesRef.current.find((n) => n.id === nodeId);
    if (!target) return;
    pendingUndo.current = { node: target, edges: connectedEdges(edgesRef.current, nodeId) };
    rfInstance.current?.deleteElements({ nodes: [{ id: nodeId }] });
    setUndoToast({ nodeName: target.data.name });
    setSelectedNodeId((sel) => (sel === nodeId ? null : sel));
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => { setUndoToast(null); pendingUndo.current = null; }, 5000);
  }, []);

  // Clicking a placed node opens its parameter panel — but not a click on the delete
  // button or a port handle (both live inside the node's DOM and would otherwise bubble
  // into this), and not a node with nothing to author (see hasEditablePorts).
  const onNodeClick: NodeMouseHandler<Node<FlowData>> = useCallback((event, node) => {
    const target = event.target as HTMLElement;
    if (target.closest('.cn-delete') || target.closest('.cn-handle')) return;
    if (!hasEditablePorts(node.data.inputs)) return;
    setSelectedNodeId(node.id);
  }, []);

  const updateNodeAditus = useCallback((key: string, value: unknown) => {
    if (!selectedNodeId) return;
    setNodes((ns) => setNodeAditus(ns, selectedNodeId, key, value));
  }, [selectedNodeId, setNodes]);

  const undoDelete = useCallback(() => {
    const pending = pendingUndo.current;
    if (!pending) return;
    setNodes((ns) => restoreNode(ns, pending.node));
    setEdges((eds) => restoreEdges(eds, pending.edges));
    pendingUndo.current = null;
    setUndoToast(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  }, [setNodes, setEdges]);

  const nodeTypes = useMemo(() => ({
    flow: (props: NodeProps<Node<FlowData>>) => <FlowNode {...props} onDelete={deleteNode} />,
  }), [deleteNode]);

  const publish = useCallback(async () => {
    if (!tabula) return;
    setPublishing(true);
    try {
      const { modusId } = await api.publishTabula(tabula.id);
      setError(null);
      navigate(`/card?id=${modusId}`);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        const state = publishErrorState(err);
        setError(state);
        setEdges((eds) => applyPublishError(eds, state));
      } else {
        setError({ message: err instanceof Error ? err.message : 'Publish failed' });
      }
    } finally {
      setPublishing(false);
    }
  }, [tabula, navigate, setEdges]);

  // Derived, not stored: self-heals if the selected node is deleted/undone/replaced by
  // an in-flight load, instead of holding a copy that can go stale.
  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) ?? null : null;

  if (loading) {
    return (
      <AppShell crumb="canvas">
        <div className="canvas-wrap canvas-loading">Loading canvas…</div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb="canvas">
      <div className="canvas-wrap">
        {error && (
          <div className="canvas-error-banner">
            <span>{error.message}</span>
            <button className="cb-dismiss" onClick={dismissError} aria-label="Dismiss">
              <Ic name="x" />
            </button>
          </div>
        )}
        {undoToast && (
          <div className="canvas-undo-toast">
            <span>Deleted "{undoToast.nodeName}"</span>
            <button className="btn ghost sm" onClick={undoDelete}>Undo</button>
          </div>
        )}
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          onNodeClick={onNodeClick}
          onInit={(instance) => { rfInstance.current = instance; }}
          nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ style: { strokeWidth: 1.5 } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1c2024" />
          <Controls showInteractive={false} />
        </ReactFlow>
        {selectedNode && (
          <NodeParamPanel node={selectedNode} onChange={updateNodeAditus} onClose={() => setSelectedNodeId(null)} />
        )}
        <div className="canvas-palette">
          <div className="cp-title">Tools</div>
          {palette.map((entry) => (
            <button key={entry.modusId} className="cp-item" onClick={() => addNode(entry)}>
              <Ic name="plus" /> {entry.nomen}
            </button>
          ))}
          {palette.length === 0 && <div className="cp-empty">No flows registered yet.</div>}
        </div>
        <div className="canvas-bar">
          <span className="hint">
            {nodes.length} tools{saveState !== 'idle' ? ` · ${saveState === 'saving' ? 'saving…' : 'saved'}` : ''} · drag a handle to wire · trash icon deletes a node · select + Backspace removes nodes or edges
          </span>
          <button className="btn" onClick={publish} disabled={publishing || nodes.length === 0}>
            <Ic name="sparkles" /> {publishing ? 'Publishing…' : 'Publish'}
          </button>
        </div>
      </div>
    </AppShell>
  );
}
