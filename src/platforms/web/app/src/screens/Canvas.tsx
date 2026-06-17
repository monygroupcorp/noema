import { useCallback } from 'react';
import {
  ReactFlow, Background, BackgroundVariant, Controls, Handle, Position,
  addEdge, useNodesState, useEdgesState, type Node, type Edge, type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import './canvas.css';

const PORT: Record<string, string> = { text: '#5fd0a8', image: '#5b8cff', video: '#d68f6f', audio: '#d66f9a', '3d': '#b98fe0' };
interface Port { id: string; label: string; type: string }
interface FlowData { name: string; verb: string; color: string; inputs: Port[]; outputs: Port[]; [k: string]: unknown }

const ROW = 26, HEAD = 41, PAD = 8;
const handleTop = (i: number) => HEAD + PAD + i * ROW + 13;

function FlowNode({ data }: { data: FlowData }) {
  return (
    <div className="cnode">
      <div className="cnode-head">
        <span className="cn-fav" style={{ background: data.color }} />
        <b>{data.name}</b>
        <span className="badge accent">{data.verb}</span>
      </div>
      <div className="cnode-body">
        <div className="cn-col">
          {data.inputs.map((p, i) => (
            <div className="cn-row" key={p.id}>
              <Handle type="target" position={Position.Left} id={p.id} className="cn-handle" style={{ top: handleTop(i), background: PORT[p.type] || 'var(--muted)' }} />
              <span className="port">{p.label}</span>
            </div>
          ))}
        </div>
        <div className="cn-col">
          {data.outputs.map((p, i) => (
            <div className="cn-row out" key={p.id}>
              <span className="port">{p.label}</span>
              <Handle type="source" position={Position.Right} id={p.id} className="cn-handle" style={{ top: handleTop(i), background: PORT[p.type] || 'var(--muted)' }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const nodeTypes = { flow: FlowNode };

const initialNodes: Node<FlowData>[] = [
  { id: 'in', type: 'flow', position: { x: 0, y: 140 }, data: { name: 'Prompt', verb: 'input', color: 'linear-gradient(160deg,#5fd0a8,#1c4a3c)', inputs: [], outputs: [{ id: 'text', label: '“…dragon, dusk”', type: 'text' }] } },
  { id: 'flux', type: 'flow', position: { x: 280, y: 80 }, data: { name: 'FLUX Schnell', verb: 'make', color: 'linear-gradient(160deg,var(--accent),#23264f)', inputs: [{ id: 'prompt', label: 'prompt', type: 'text' }], outputs: [{ id: 'image', label: 'image', type: 'image' }] } },
  { id: 'joy', type: 'flow', position: { x: 580, y: 0 }, data: { name: 'JoyCaption', verb: 'describe', color: 'linear-gradient(160deg,#9a8fd6,#2b2456)', inputs: [{ id: 'image', label: 'image', type: 'image' }], outputs: [{ id: 'text', label: 'caption', type: 'text' }] } },
  { id: 'ltx', type: 'flow', position: { x: 580, y: 210 }, data: { name: 'LTX Video', verb: 'animate', color: 'linear-gradient(160deg,#d68f6f,#4a261c)', inputs: [{ id: 'prompt', label: 'prompt', type: 'text' }, { id: 'image', label: 'image', type: 'image' }], outputs: [{ id: 'video', label: 'video', type: 'video' }] } },
];

const initialEdges: Edge[] = [
  { id: 'e1', source: 'in', sourceHandle: 'text', target: 'flux', targetHandle: 'prompt' },
  { id: 'e2', source: 'flux', sourceHandle: 'image', target: 'joy', targetHandle: 'image' },
  { id: 'e3', source: 'flux', sourceHandle: 'image', target: 'ltx', targetHandle: 'image' },
  { id: 'e4', source: 'in', sourceHandle: 'text', target: 'ltx', targetHandle: 'prompt' },
];

export function Canvas() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const onConnect = useCallback((c: Connection) => setEdges((eds) => addEdge(c, eds)), [setEdges]);

  return (
    <AppShell crumb="canvas">
      <div className="canvas-wrap">
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ style: { strokeWidth: 1.5 } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1c2024" />
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="canvas-bar">
          <span className="hint">{nodes.length} tools · drag a handle to wire</span>
          <button className="btn"><Ic name="sparkles" /> Compile to spell</button>
        </div>
      </div>
    </AppShell>
  );
}
