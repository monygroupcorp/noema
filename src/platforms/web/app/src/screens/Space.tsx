import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Line, Html } from '@react-three/drei';
import * as THREE from 'three';
import { AppShell } from '../shell/AppShell';
import { ErrorBoundary } from '../shell/ErrorBoundary';
import { Ic } from '../lib/icons';

// The 3D Vestigium space — a mathematical embedding scatter (academic, not a star-field).
// Points are creations positioned by their (mock) embedding; clusters emerge; axes are abstract dims.

interface Pt { id: string; pos: [number, number, number]; cluster: string; color: string; prompt: string; model: string }

const CLUSTERS = [
  { key: 'dragons',    color: '#5b8cff', center: [1.3, 0.8, -0.6],  prompts: ['n64 dragon on a neon temple, dusk', 'low-poly wyvern over a canyon', 'crystalline dragon, ice'] },
  { key: 'portraits',  color: '#d68f6f', center: [-1.4, 0.4, 0.9],  prompts: ['cinematic portrait, rim light', 'oil portrait of a sailor', 'studio headshot, soft key'] },
  { key: 'landscapes', color: '#5fd0a8', center: [0.2, -1.3, 1.2],  prompts: ['misty fjord at dawn', 'alpine meadow, golden hour', 'desert mesa under storm'] },
  { key: 'abstract',   color: '#d66f9a', center: [-0.8, 1.4, -1.3], prompts: ['flowing gradient mesh', 'generative noise field', 'iridescent fluid forms'] },
  { key: 'cyber',      color: '#b98fe0', center: [1.0, -0.9, -1.4], prompts: ['neon alley, rain, reflections', 'cyberpunk skyline', 'holographic interface, glow'] },
];
const MODELS = ['flux-schnell', 'sd1-5', 'dalle-iii'];
const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * 0.55; // rough normal

function makePoints(): Pt[] {
  const out: Pt[] = [];
  CLUSTERS.forEach((c) => {
    for (let i = 0; i < 28; i++) {
      out.push({
        id: `${c.key}-${i}`,
        pos: [c.center[0] + g(), c.center[1] + g(), c.center[2] + g()],
        cluster: c.key, color: c.color,
        prompt: c.prompts[i % c.prompts.length],
        model: MODELS[i % MODELS.length],
      });
    }
  });
  return out;
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch { return false; }
}

function Axes() {
  const L = 2.6;
  const box = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(5.4, 5.4, 5.4)), []);
  const lbl = { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--faint)', whiteSpace: 'nowrap' as const, letterSpacing: '.06em' };
  return (
    <group>
      <lineSegments geometry={box}><lineBasicMaterial color="#1b2127" /></lineSegments>
      <Line points={[[-L, 0, 0], [L, 0, 0]]} color="#33404f" lineWidth={1} />
      <Line points={[[0, -L, 0], [0, L, 0]]} color="#33404f" lineWidth={1} />
      <Line points={[[0, 0, -L], [0, 0, L]]} color="#33404f" lineWidth={1} />
      <Html position={[L + 0.15, 0, 0]} style={lbl} center>dim 1</Html>
      <Html position={[0, L + 0.15, 0]} style={lbl} center>dim 2</Html>
      <Html position={[0, 0, L + 0.15]} style={lbl} center>dim 3</Html>
    </group>
  );
}

function PointCloud({ points, query, hoveredId, selectedId, onHover, onSelect }: {
  points: Pt[]; query: string; hoveredId?: string; selectedId?: string;
  onHover: (p: Pt | null) => void; onSelect: (p: Pt) => void;
}) {
  const q = query.trim().toLowerCase();
  return (
    <>
      {points.map((p) => {
        const dim = q !== '' && !p.prompt.toLowerCase().includes(q);
        const active = p.id === hoveredId || p.id === selectedId;
        return (
          <mesh key={p.id} position={p.pos} scale={active ? 2.1 : 1}
            onPointerOver={(e) => { e.stopPropagation(); onHover(p); document.body.style.cursor = 'pointer'; }}
            onPointerOut={() => { onHover(null); document.body.style.cursor = 'auto'; }}
            onClick={(e) => { e.stopPropagation(); onSelect(p); }}>
            <sphereGeometry args={[0.05, 14, 14]} />
            <meshBasicMaterial color={p.color} transparent opacity={dim ? 0.1 : 1} toneMapped={false} />
          </mesh>
        );
      })}
    </>
  );
}

function NoWebGL() {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 'var(--s6)' }}>
      <div style={{ textAlign: 'center', maxWidth: 440 }}>
        <div style={{ fontSize: 24, color: 'var(--accent-soft)', marginBottom: 'var(--s3)', opacity: .7 }}><Ic name="sparkles" /></div>
        <div style={{ color: 'var(--text)', fontSize: 14, marginBottom: 'var(--s2)' }}>The 3D space needs WebGL</div>
        <div style={{ color: 'var(--faint)', fontSize: 12.5, lineHeight: 1.55 }}>
          Your browser has WebGL / hardware acceleration turned off (or this is a sandboxed context), so the 3D view can’t render.
          Enable hardware acceleration to fly your creations — everything else in noema works without it.
        </div>
      </div>
    </div>
  );
}

export function Space() {
  const points = useMemo(makePoints, []);
  const glOk = useMemo(webglAvailable, []);
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<Pt | null>(null);
  const [selected, setSelected] = useState<Pt | null>(null);
  const peek = selected ?? hovered;
  const matches = query.trim() ? points.filter((p) => p.prompt.toLowerCase().includes(query.trim().toLowerCase())).length : points.length;

  return (
    <AppShell crumb="space">
      <div className="space" onClick={() => setSelected(null)}>
        {!glOk ? <NoWebGL /> : (
          <ErrorBoundary fallback={<NoWebGL />}>
            <Canvas dpr={[1, 2]} camera={{ position: [4.2, 3, 5.6], fov: 42 }} style={{ position: 'absolute', inset: 0 }}>
              <color attach="background" args={['#08090A']} />
              <fog attach="fog" args={['#08090A', 9, 18]} />
              <Axes />
              <PointCloud points={points} query={query} hoveredId={hovered?.id} selectedId={selected?.id} onHover={setHovered} onSelect={(p) => setSelected(p)} />
              <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={3.5} maxDistance={16} target={[0, 0, 0]} />
            </Canvas>

            <div className="spacebar">
              <div className="search">
                <Ic name="search" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search your space — by prompt, look, or model…" />
              </div>
              <div className="mono" style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 'var(--fs-xs)', marginTop: 'var(--s2)' }}>
                {points.length} creations · {matches} shown · dim1×dim2×dim3 · UMAP projection · drag to orbit
              </div>
            </div>

            <div className="legend">
              {CLUSTERS.map((c) => (
                <div className="lg" key={c.key}><span className="d" style={{ background: c.color }} />{c.key} · 28</div>
              ))}
            </div>

            <div className={`peek${peek ? ' show' : ''}`}>
              {peek && <>
                <div className="pimg" style={{ background: `linear-gradient(150deg, ${peek.color}33, #0c1a1c 70%)` }} />
                <div className="pmeta">
                  <b>{peek.prompt}</b>
                  <span className="mono" style={{ color: 'var(--faint)' }}>{peek.model} · {peek.cluster}</span>
                  <div style={{ marginTop: 'var(--s3)' }}><Link to="/trace" style={{ color: 'var(--accent-soft)', textDecoration: 'none', fontSize: 12 }}>open creation →</Link></div>
                </div>
              </>}
            </div>
          </ErrorBoundary>
        )}
      </div>
    </AppShell>
  );
}
