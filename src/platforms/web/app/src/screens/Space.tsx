import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { AppShell } from '../shell/AppShell';
import { ErrorBoundary } from '../shell/ErrorBoundary';
import { Ic } from '../lib/icons';
import { sampleImages, launchTraining } from '../lib/training';
import { api } from '../lib/api';
import type { Vestigium as ApiVestigium } from '../lib/api';
import { useSession } from '../state/session';

// The 3D Vestigium space. Two data sources:
//   real    — a signed-in/commitment caller's OWN vestigia, PCA-projected on demand
//             by GET /api/vestigia/projection.
//   static  — the precomputed 163k-gen ComfyDeploy corpus under /public/space* (the
//             "public exhibit"), shown to anon/no-history callers.
// Both share one set of layers — text ("what people asked for") / image ("what it
// looked like") — and the same Corpus/PtMeta shapes so the rendering below (Cloud,
// gallery, search, selection) doesn't care which source fed it.
//
// A THIRD source — the flat fallback grid (product ruling 2026-07-13) — kicks in when
// the caller HAS vestigia but the 3D projection isn't available (no CLIP configured,
// too few embedded items, or a 503). The space is a full history, not a projection-gated
// view: it falls back to a plain chronological list/grid of the same vestigia, never an
// empty screen. See buildFallbackItems() + SpaceFallbackGrid below.

// Pure formatting helpers (exported for component-level testing — this app's toolchain
// has no jsdom/@testing-library/react, see Canvas.test.ts, so logic is kept pure and
// tested without a DOM render).
export function vestigiumSnippet(promptum: string, len = 160): string {
  const p = promptum ?? '';
  return p.length > len ? `${p.slice(0, len)}…` : p;
}
export function formatVestigiumDate(natum: string): string {
  if (!natum) return '';
  const d = new Date(natum);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
// buildFallbackItems: the flat-grid data shape, newest first — the CALLER's full
// vestigia history as returned by GET /api/vestigia (already sorted newest-first
// server-side; this just narrows/normalizes for the grid).
export interface FallbackItem { id: string; promptum: string; imagoUrl?: string; natum: string }
export function buildFallbackItems(vestigia: ApiVestigium[]): FallbackItem[] {
  return vestigia.map(v => ({ id: v.id, promptum: v.promptum, imagoUrl: v.imagoUrl, natum: v.natum }));
}

// ---- Unit-scale normalization (noema-050) -------------------------------------------
// A projected cloud's raw extent tracks dataset variance: a 4-vestigium caller space's
// PCA output lands orders of magnitude smaller than the 163k-gen demo corpus's, so a
// scene/camera tuned for the big corpus makes a small real space collapse to a few
// sub-pixel dots (live check, 2026-07-13). Normalize every cloud — real AND
// static demo, same code path, no exemption — to a fixed unit bounding volume before it
// reaches Cloud/camera framing: center on the centroid, uniform-scale (never per-axis;
// that would distort the PCA layout's relative distances) so the overall max extent
// maps to SCENE_EXTENT. Target matches this app's own build-time convention for the
// demo corpus (scripts/corpus-space/project.py: "normalize to a centered cube ~[-2.5,
// 2.5]") — so re-normalizing an already-normalized demo cloud is a no-op-ish rescale,
// not a fork.
export const SCENE_EXTENT = 5; // full-width target (±2.5) of the normalized bounding cube

export interface Bounds { center: [number, number, number]; maxExtent: number }

export function computeBounds(positions: Float32Array): Bounds {
  const n = positions.length / 3;
  if (n === 0) return { center: [0, 0, 0], maxExtent: 0 };
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return {
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
    maxExtent: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0),
  };
}

// Center on the centroid, then uniform-scale so maxExtent -> SCENE_EXTENT. Degenerate
// clouds (n=1, or every point coincident -> maxExtent 0) skip the scale (divide-by-zero
// guard) and just center — a single point still lands at the origin, visible and framed.
export function normalizeToUnitScale(positions: Float32Array): Float32Array {
  const n = positions.length / 3;
  const out = new Float32Array(positions.length);
  if (n === 0) return out;
  const { center, maxExtent } = computeBounds(positions);
  const scale = maxExtent > 1e-6 ? SCENE_EXTENT / maxExtent : 1;
  for (let i = 0; i < n; i++) {
    out[i * 3] = (positions[i * 3] - center[0]) * scale;
    out[i * 3 + 1] = (positions[i * 3 + 1] - center[1]) * scale;
    out[i * 3 + 2] = (positions[i * 3 + 2] - center[2]) * scale;
  }
  return out;
}

// Camera framing (noema-050 decision 2): position/fov derived from the fixed
// SCENE_EXTENT envelope, not hardcoded for the big corpus. Every normalized cloud lands
// inside the identical envelope regardless of point count, so one derived framing fits
// 2 points and 2000 alike. Direction + distance/extent ratio preserve the app's prior
// (pre-noema-050) view angle, which was tuned against the demo corpus's own ~[-2.5,2.5]
// scale — so this is the same shot, just derived from the envelope instead of pinned to it.
export function frameCameraToBounds(): { position: [number, number, number]; fov: number } {
  const half = SCENE_EXTENT / 2;
  const dir: [number, number, number] = [0.5433, 0.3951, 0.7408]; // unit vector, prior view angle
  const dist = half * 3.2397;                                     // prior distance/half-extent ratio
  return { position: [dir[0] * dist, dir[1] * dist, dir[2] * dist], fov: 42 };
}

// ---- Reference grid/axes (noema-051) ------------------------------------------------
// Live check (2026-07-13): unit scale fixed the collapse-to-dots problem,
// but the space still reads as disorienting with no fixed reference frame ("where did my
// axis go!"). Restores the wireframe-cube + labeled-axis reference (dropped in the
// noema-033 real-data rewrite) sized off the CURRENT SCENE_EXTENT envelope, not the old
// hardcoded 5.4 — same visual margin-past-the-envelope ratio the original had (box a hair
// past the ±2.5 cube, axis lines a hair past that), so it still fits both a 2-point real
// space and the 2000-point demo corpus post-normalization.
export function axesGridSize(extent: number): { boxSize: number; axisLength: number } {
  return { boxSize: extent + 0.4, axisLength: extent / 2 + 0.1 };
}

export type Layer = 'text' | 'image';
interface Manifest { n: number; k: number; projection: string }
interface Cluster { label: string; terms: string[]; color: string; count: number }
interface PtMeta { p: string; m: string; c: string; u: string; d: string; s?: string; l?: string[] }
interface Corpus { positions: Float32Array; clusters: Uint16Array; manifest: Manifest; clusterInfo: Record<string, Cluster>; }

const BG = '#08090A';
const base = (layer: Layer) => (layer === 'image' ? '/space-image' : '/space');

// Selection view-state (no server object exists for a space selection yet — the house
// precedent for this class, client view-state with no backend store, is state/project.tsx's
// namespaced localStorage overlay: keys scoped by active animaId, try/catch reads, tolerate
// garbage). Spheres are coordinates in a specific projection LAYER; a stored set is only ever
// restored onto the layer it was carved in, never silently reprojected onto another.
export type SelSphere = { x: number; y: number; z: number; r: number; mode: 'inc' | 'exc' };
export const selectionKey = (scope: string) => `noema-${scope}-space-selection`;
export function loadStoredSelection(scope: string, layer: Layer): SelSphere[] {
  try {
    const raw = localStorage.getItem(selectionKey(scope));
    if (raw) {
      const v = JSON.parse(raw);
      if (v && v.layer === layer && Array.isArray(v.spheres)) return v.spheres;
    }
  } catch { /* malformed entry restores to empty, never throws */ }
  return [];
}

// The corpus explorer mounts on data presence, not a build flag (UX handoff 2, D7): it always
// loads and shows a real loading → space | empty state. Corpus artifacts are static files under
// `public/space*` (built by scripts/corpus-space); absent → the honest empty state below.

function webglAvailable(): boolean {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch { return false; }
}
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

// Shared normalization pass (noema-050) — applied to every Corpus regardless of source,
// so the demo-corpus path isn't forked/exempted (decision 4). See normalizeToUnitScale.
function normalizeCorpus(corpus: Corpus): Corpus {
  return { ...corpus, positions: normalizeToUnitScale(corpus.positions) };
}

async function loadCorpus(layer: Layer): Promise<Corpus> {
  const b = base(layer);
  const [manifest, clusterInfo, pointsBuf, attrsBuf] = await Promise.all([
    fetch(`${b}/manifest.json`).then(r => { if (!r.ok) throw new Error('no layer'); return r.json(); }),
    fetch(`${b}/clusters.json`).then(r => r.json()),
    fetch(`${b}/points.bin`).then(r => r.arrayBuffer()),
    fetch(`${b}/attrs.bin`).then(r => r.arrayBuffer()),
  ]);
  return { manifest, clusterInfo, positions: new Float32Array(pointsBuf), clusters: new Uint16Array(attrsBuf) };
}

// Real-data source: PCA-projected vestigia for the CALLER, adapted to the Corpus/PtMeta
// shapes above. `clusters[i]` (from the endpoint) describes cluster id `i` positionally —
// see VestigiaProjection.ts. Throws 'no layer' (same signal loadCorpus uses) when the
// caller has no vestigia embedded on this dimension yet, so the layer-switch fallback
// (image → text, text → static/empty) reuses the same catch path.
async function loadRealCorpus(layer: Layer): Promise<{ corpus: Corpus; meta: PtMeta[] }> {
  const embedding = layer === 'image' ? 'imago' : 'promptum';
  const [projection, vestigiaResp] = await Promise.all([
    api.vestigiaProjection(embedding),
    api.listVestigia(5000),
  ]);
  if (projection.n === 0) throw new Error('no layer');

  const byId = new Map(vestigiaResp.vestigia.map(v => [v.id, v]));
  const n = projection.points.length;
  const positions = new Float32Array(n * 3);
  const clusters = new Uint16Array(n);
  const meta: PtMeta[] = [];
  projection.points.forEach((pt, i) => {
    positions[i * 3] = pt.p[0]; positions[i * 3 + 1] = pt.p[1]; positions[i * 3 + 2] = pt.p[2];
    clusters[i] = pt.cluster;
    const v = byId.get(pt.id);
    meta.push({
      p: (v?.promptum ?? '').slice(0, 160),
      m: v?.intellaIds?.join(', ') || '?',
      c: 'your space',
      u: '',
      d: v?.natum ? v.natum.slice(0, 10) : '',
      s: v?.imagoUrl,
      l: [],
    });
  });

  const clusterInfo: Record<string, Cluster> = {};
  projection.clusters.forEach((cl, id) => {
    clusterInfo[String(id)] = { label: cl.label, terms: [], color: cl.color, count: cl.count };
  });
  const manifest: Manifest = { n, k: projection.clusters.length, projection: 'PCA' };
  return { corpus: { positions, clusters, manifest, clusterInfo }, meta };
}

function Axes() {
  const { boxSize, axisLength: L } = axesGridSize(SCENE_EXTENT);
  const box = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(boxSize, boxSize, boxSize)), [boxSize]);
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

function Cloud({ corpus, baseColors, dimMask, onPick, onFocusPoint }: {
  corpus: Corpus; baseColors: Float32Array; dimMask: Uint8Array | null;
  // onPick carries the FULL result of a non-drag click: an index when the ray hit a
  // selectable point, null when it hit empty space. The consumer selects on the former
  // and deselects on the latter — nothing outside this callback may cancel a pick.
  onPick: (i: number | null) => void; onFocusPoint: (i: number) => void;
}) {
  const { camera, gl, controls } = useThree() as any;
  const pointsRef = useRef<THREE.Points>(null);
  const n = corpus.clusters.length;

  // round sprite so points render as circles, not squares
  const circle = useMemo(() => {
    const s = 64, c = document.createElement('canvas'); c.width = c.height = s;
    const ctx = c.getContext('2d')!;
    ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    const t = new THREE.CanvasTexture(c); t.needsUpdate = true; return t;
  }, []);

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(corpus.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    return g;
  }, [corpus, n]);

  useEffect(() => {
    const col = geometry.getAttribute('color') as THREE.BufferAttribute;
    const arr = col.array as Float32Array;
    for (let i = 0; i < n; i++) {
      const f = dimMask && dimMask[i] === 1 ? 0.045 : 1;
      arr[i * 3] = baseColors[i * 3] * f; arr[i * 3 + 1] = baseColors[i * 3 + 1] * f; arr[i * 3 + 2] = baseColors[i * 3 + 2] * f;
    }
    col.needsUpdate = true;
  }, [geometry, baseColors, dimMask, n]);

  useEffect(() => {
    const ray = new THREE.Raycaster(); const mouse = new THREE.Vector2(); const el = gl.domElement;
    let downXY: [number, number] | null = null;
    const pickAt = (cx: number, cy: number): number | null => {
      if (!pointsRef.current) return null;
      const rect = el.getBoundingClientRect();
      mouse.x = ((cx - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((cy - rect.top) / rect.height) * 2 + 1;
      // threshold scales with zoom level (camera distance to its orbit target)
      const zoomDist = controls?.target ? camera.position.distanceTo(controls.target) : camera.position.length();
      ray.params.Points!.threshold = zoomDist * 0.012;
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObject(pointsRef.current);   // sorted nearest-first along ray
      for (const h of hits) {
        const idx = h.index ?? -1;
        // when a filter is active, only highlighted (non-dimmed) points are selectable
        if (idx >= 0 && (!dimMask || dimMask[idx] === 0)) return idx;
      }
      return null;
    };
    const onDown = (e: PointerEvent) => { if (e.button === 0) downXY = [e.clientX, e.clientY]; };
    const onUp = (e: PointerEvent) => {
      if (!downXY) return;
      const moved = Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]); downXY = null;
      if (moved > 5) return;                       // a drag = orbit, not a pick
      onPick(pickAt(e.clientX, e.clientY));
    };
    const onDbl = (e: MouseEvent) => { const i = pickAt(e.clientX, e.clientY); if (i != null) onFocusPoint(i); };
    el.addEventListener('pointerdown', onDown); el.addEventListener('pointerup', onUp); el.addEventListener('dblclick', onDbl);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); el.removeEventListener('dblclick', onDbl); };
  }, [camera, gl, controls, onPick, onFocusPoint, dimMask]);

  return (
    <points ref={pointsRef} geometry={geometry}>
      <pointsMaterial map={circle} alphaTest={0.5} size={0.04} sizeAttenuation vertexColors transparent opacity={0.95} depthWrite={false} />
    </points>
  );
}

function Highlight({ corpus, index }: { corpus: Corpus; index: number | null }) {
  if (index == null) return null;
  const p = corpus.positions;
  return (
    <mesh position={[p[index * 3], p[index * 3 + 1], p[index * 3 + 2]]}>
      <sphereGeometry args={[0.06, 16, 16]} /><meshBasicMaterial color="#ffffff" toneMapped={false} />
    </mesh>
  );
}

interface Focus { x: number; y: number; z: number; dist: number; key: number }

// Smoothly flies the orbit target + camera to a new origin (double-click point / cluster jump).
function CameraRig({ focus }: { focus: Focus | null }) {
  const { camera, controls } = useThree() as any;
  const goal = useRef<{ target: THREE.Vector3; cam: THREE.Vector3 } | null>(null);
  useEffect(() => {
    if (!focus || !controls) return;
    const t = new THREE.Vector3(focus.x, focus.y, focus.z);
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    goal.current = { target: t, cam: t.clone().add(dir.multiplyScalar(focus.dist)) };
  }, [focus, controls, camera]);
  useFrame(() => {
    if (!controls || !goal.current) return;
    controls.target.lerp(goal.current.target, 0.14);
    camera.position.lerp(goal.current.cam, 0.14);
    controls.update();
    if (camera.position.distanceTo(goal.current.cam) < 0.02) goal.current = null;
  });
  return null;
}

function NoWebGL() {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', padding: 'var(--s6)' }}>
      <div style={{ textAlign: 'center', maxWidth: 440 }}>
        <div style={{ fontSize: 24, color: 'var(--accent-soft)', marginBottom: 'var(--s3)', opacity: .7 }}><Ic name="sparkles" /></div>
        <div style={{ color: 'var(--text)', fontSize: 14, marginBottom: 'var(--s2)' }}>The 3D space needs WebGL</div>
        <div style={{ color: 'var(--faint)', fontSize: 12.5, lineHeight: 1.55 }}>Enable hardware acceleration to fly the corpus.</div>
      </div>
    </div>
  );
}

// The flat-grid fallback (product ruling 2026-07-13): a plain, always-available
// chronological view of the caller's full vestigia history — remove-from-space and
// feedback controls live here since they're independent of whether the 3D projection
// is up. Newest first (buildFallbackItems preserves the server's order).
const IMPRESSIO_GLYPH: Record<'amor' | 'risus' | 'maeror', string> = { amor: '♡', risus: '☺', maeror: '☹' };
function SpaceFallbackGrid({ items, onRemove, onImpressio }: {
  items: ApiVestigium[];
  onRemove: (id: string) => void;
  onImpressio: (id: string, impressio: 'amor' | 'risus' | 'maeror') => void;
}) {
  const rows = buildFallbackItems(items);
  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: 'var(--s6)' }} onClick={(e) => e.stopPropagation()}>
      <div className="mono" style={{ textAlign: 'center', color: 'var(--accent-soft)', fontSize: 'var(--fs-xs)', marginBottom: 'var(--s4)' }}>
        your space · {rows.length.toLocaleString()} creations · list view (projection unavailable)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, maxWidth: 1100, margin: '0 auto' }}>
        {rows.map((it) => {
          const src = items.find(v => v.id === it.id);
          const impressio = src?.impressio;
          // actumId (FK -> Actum) is the id /run?id= accepts — present when this trace
          // resolved from a completed generation; some traces never resolve one, so the
          // link is conditional (item noema-110: don't fabricate a target when absent).
          const runHref = src?.actumId ? `/run?id=${src.actumId}` : null;
          const linkStyle = { display: 'block', color: 'inherit', textDecoration: 'none' } as const;
          const media = (
            <div style={{ aspectRatio: '1 / 1', background: '#0c1116' }}>
              {it.imagoUrl && <img src={it.imagoUrl} loading="lazy" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
            </div>
          );
          const text = (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--text)', lineHeight: 1.4, marginBottom: 6, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                {vestigiumSnippet(it.promptum) || '(no prompt)'}
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: 'var(--faint)', marginBottom: 6 }}>{formatVestigiumDate(it.natum)}</div>
            </>
          );
          return (
            <div key={it.id} style={{ border: '1px solid var(--hair)', borderRadius: 10, overflow: 'hidden', background: 'var(--panel)' }}>
              {runHref ? <Link to={runHref} title="resume run" style={linkStyle}>{media}</Link> : media}
              <div style={{ padding: 8 }}>
                {runHref ? <Link to={runHref} style={linkStyle}>{text}</Link> : text}
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {(['amor', 'risus', 'maeror'] as const).map(k => (
                    <button key={k} onClick={() => onImpressio(it.id, k)} title={k}
                      style={{
                        flex: 1, padding: '3px 0', borderRadius: 6, fontSize: 12, cursor: 'pointer',
                        border: '1px solid var(--hair)',
                        background: impressio?.auctorImpressio === k ? 'var(--accent-bg)' : 'var(--raised)',
                        color: impressio?.auctorImpressio === k ? 'var(--accent-soft)' : 'var(--muted)',
                      }}>{IMPRESSIO_GLYPH[k]}</button>
                  ))}
                  <button onClick={() => onRemove(it.id)} title="remove from space"
                    style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--hair)', background: 'var(--raised)', color: 'var(--faint)', fontSize: 12, cursor: 'pointer' }}>✕</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Space() {
  return <CorpusSpace />;
}

function CorpusSpace() {
  const glOk = useMemo(webglAvailable, []);
  // Selection persistence is scoped like the project overlay: namespaced by the active
  // animaId, anon path stays local-only. Switching accounts mid-session must not bleed one
  // account's spheres into another's view — resync (render-time, before commit) on scope
  // change, mirroring state/project.tsx's loadedScope pattern.
  const { activeAnimaId } = useSession();
  const scope = activeAnimaId ?? 'anon';
  const [selScope, setSelScope] = useState(scope);
  const [layer, setLayer] = useState<Layer>('text');
  const [imageLayerOk, setImageLayerOk] = useState(true);
  // Data source switch: null while the
  // caller's own history is being checked; true = real vestigia (their own space), false
  // = fall back to the static "public exhibit" corpus (anon or no history yet).
  const [hasReal, setHasReal] = useState<boolean | null>(null);
  const [corpus, setCorpus] = useState<Corpus | null>(null);
  const cameraFrame = useMemo(() => frameCameraToBounds(), []);
  // OrbitControls captures its construction-time camera/target as its own reset baseline
  // (three.js OrbitControls.reset()) — since the Canvas below is mounted with `camera=
  // {{ position: cameraFrame.position }}`, .reset() re-applies exactly the #137 framed
  // view (position + target), no separate stored target needed.
  const controlsRef = useRef<any>(null);
  const resetView = () => controlsRef.current?.reset();
  const [meta, setMeta] = useState<PtMeta[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Flat chronological fallback (product ruling 2026-07-13): populated when the caller
  // HAS vestigia but the 3D projection can't build (no CLIP, too few embedded, 503) — the
  // primary data (GET /api/vestigia) always works, so this is never an empty screen.
  const [fallbackVestigia, setFallbackVestigia] = useState<ApiVestigium[] | null>(null);
  const [query, setQuery] = useState('');
  const [activeCluster, setActiveCluster] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);   // hovered/clicked point → highlight + small peek
  const [viewer, setViewer] = useState<number | null>(null);   // full-size image viewer
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galLimit, setGalLimit] = useState(12);                // infinite-scroll page size
  const [focus, setFocus] = useState<Focus | null>(null);      // camera fly-to target
  const [sphere, setSphere] = useState<{ x: number; y: number; z: number; r: number } | null>(null);
  const [selection, setSelection] = useState<SelSphere[]>(() => loadStoredSelection(scope, layer));
  const focusKey = useRef(0);
  const MIN_R = 0.03, DEFAULT_R = MIN_R;   // a selection starts atomic; expand outward via the slider

  // Account switch mid-session: reload this account's stored selection for the current
  // layer (or empty if it has none) before the next paint, same technique project.tsx uses
  // to keep the render-time state sync ahead of the persist effect below.
  if (selScope !== scope) {
    setSelScope(scope);
    setSelection(loadStoredSelection(scope, layer));
  }

  // Write-through: small state, plain synchronous set alongside every change (project.tsx
  // convention). Layer travels with the spheres so a later restore never lands them on a
  // different projection. Selection emptied by any existing gesture (remove-one, clear-all)
  // clears the stored entry too — one effect covers every path, no per-gesture bookkeeping.
  useEffect(() => {
    try {
      if (selection.length === 0) localStorage.removeItem(selectionKey(scope));
      else localStorage.setItem(selectionKey(scope), JSON.stringify({ layer, spheres: selection }));
    } catch { /* storage unavailable — this is view-state only, safe to skip */ }
  }, [selection, layer, scope]);

  const addSel = (mode: 'inc' | 'exc') => { if (sphere) setSelection(s => [...s, { x: sphere.x, y: sphere.y, z: sphere.z, r: sphere.r, mode }]); };

  // Single click on a point: highlight it, open its neighborhood sphere at the atomic
  // default radius, and open the side panel — the camera stays exactly where the user
  // put it. Double-click is this plus a fly-to (focusPoint below).
  const selectPoint = (i: number) => {
    if (!corpus) return;
    const p = corpus.positions;
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    setSphere({ x, y, z, r: DEFAULT_R });
    setActiveCluster(null); setGalleryOpen(true); setPicked(i);
  };
  // Single click that hit no point: deselect. Routed through the pick result rather than
  // a click bubbling off the canvas, so a click that DID hit a point is not cancelled.
  const clearPick = () => setPicked(null);
  const focusPoint = (i: number) => {                            // double-click: fly + select sphere neighborhood
    if (!corpus) return;
    const p = corpus.positions; focusKey.current++;
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    setFocus({ x, y, z, dist: 1.5, key: focusKey.current });
    selectPoint(i);
  };
  const focusCluster = (id: number) => {
    if (!corpus) return;
    setSphere(null);
    const p = corpus.positions, cl = corpus.clusters;
    let cx = 0, cy = 0, cz = 0, c = 0;
    for (let i = 0; i < cl.length; i++) if (cl[i] === id) { cx += p[i * 3]; cy += p[i * 3 + 1]; cz += p[i * 3 + 2]; c++; }
    if (!c) return; cx /= c; cy /= c; cz /= c;
    let s = 0;
    for (let i = 0; i < cl.length; i++) if (cl[i] === id) { const dx = p[i * 3] - cx, dy = p[i * 3 + 1] - cy, dz = p[i * 3 + 2] - cz; s += Math.sqrt(dx * dx + dy * dy + dz * dz); }
    s /= c; focusKey.current++;
    setFocus({ x: cx, y: cy, z: cz, dist: Math.min(Math.max(s * 2.4, 1.6), 8), key: focusKey.current });
  };

  // Source check: does the caller (signed-in or anon-commitment) have any vestigia at
  // all? Runs once — decides real-vs-static for every subsequent layer load below.
  useEffect(() => {
    api.listVestigia(1).then(r => setHasReal(r.count > 0)).catch(() => setHasReal(false));
  }, []);

  useEffect(() => {
    if (hasReal === null) return;   // wait for the source check above
    setCorpus(null); setErr(null); setActiveCluster(null); setPicked(null); setGalleryOpen(false); setFallbackVestigia(null);
    if (hasReal) {
      loadRealCorpus(layer).then(({ corpus, meta }) => { setCorpus(normalizeCorpus(corpus)); setMeta(meta); }).catch(e => {
        if (layer === 'image') { setImageLayerOk(false); setLayer('text'); return; }
        // Projection unavailable (no CLIP, too few embedded, 503) but the caller DOES
        // have vestigia — fall back to their full chronological history, never an
        // empty screen (product ruling 2026-07-13).
        api.listVestigia(500).then(r => setFallbackVestigia(r.vestigia)).catch(() => setErr(String(e)));
      });
    } else {
      fetch('/space/meta.json').then(r => r.json()).then(setMeta).catch(() => {});
      loadCorpus(layer).then(normalizeCorpus).then(setCorpus).catch(e => {
        if (layer === 'image') { setImageLayerOk(false); setLayer('text'); } else setErr(String(e));
      });
    }
  }, [layer, hasReal]);

  const removeFallbackItem = (id: string) => {
    api.removeVestigium(id).then(() => setFallbackVestigia(v => v ? v.filter(x => x.id !== id) : v)).catch(() => {});
  };
  const setFallbackImpressio = (id: string, impressio: 'amor' | 'risus' | 'maeror') => {
    api.setVestigiumImpressio(id, impressio).then(({ vestigium }) => {
      setFallbackVestigia(v => v ? v.map(x => x.id === id ? vestigium : x) : v);
    }).catch(() => {});
  };

  const baseColors = useMemo(() => {
    if (!corpus) return new Float32Array(0);
    const n = corpus.clusters.length;
    const rgb: Record<number, [number, number, number]> = {};
    for (const k in corpus.clusterInfo) rgb[+k] = hexToRgb(corpus.clusterInfo[k].color);
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const c = rgb[corpus.clusters[i]] ?? [0.6, 0.6, 0.6]; arr[i * 3] = c[0]; arr[i * 3 + 1] = c[1]; arr[i * 3 + 2] = c[2]; }
    return arr;
  }, [corpus]);

  const q = query.trim().toLowerCase();
  const dimMask = useMemo(() => {
    if (!corpus) return null;
    if (activeCluster == null && !q && !sphere) return null;
    const p = corpus.positions, n = corpus.clusters.length, mask = new Uint8Array(n);
    const r2 = sphere ? sphere.r * sphere.r : 0;
    for (let i = 0; i < n; i++) {
      let dim = false;
      if (activeCluster != null && corpus.clusters[i] !== activeCluster) dim = true;
      if (!dim && sphere) {
        const dx = p[i * 3] - sphere.x, dy = p[i * 3 + 1] - sphere.y, dz = p[i * 3 + 2] - sphere.z;
        dim = dx * dx + dy * dy + dz * dz > r2;
      }
      if (!dim && q && meta) dim = !meta[i].p.toLowerCase().includes(q);
      mask[i] = dim ? 1 : 0;
    }
    return mask;
  }, [corpus, activeCluster, q, meta, sphere]);

  const shown = useMemo(() => {
    if (!corpus) return 0;
    if (!dimMask) return corpus.clusters.length;
    let c = 0; for (let i = 0; i < dimMask.length; i++) if (dimMask[i] === 0) c++; return c;
  }, [corpus, dimMask]);

  // dataset membership: inside ANY include sphere AND inside NO exclude sphere
  const selMask = useMemo(() => {
    if (!corpus || selection.length === 0) return null;
    const p = corpus.positions, n = corpus.clusters.length, mask = new Uint8Array(n);
    const inc = selection.filter(s => s.mode === 'inc'), exc = selection.filter(s => s.mode === 'exc');
    if (inc.length === 0) return mask;
    const inR = (s: typeof inc[0], x: number, y: number, z: number) => {
      const dx = x - s.x, dy = y - s.y, dz = z - s.z; return dx * dx + dy * dy + dz * dz <= s.r * s.r;
    };
    for (let i = 0; i < n; i++) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      if (inc.some(s => inR(s, x, y, z)) && !exc.some(s => inR(s, x, y, z))) mask[i] = 1;
    }
    return mask;
  }, [corpus, selection]);
  const selCount = useMemo(() => { let c = 0; if (selMask) for (let i = 0; i < selMask.length; i++) c += selMask[i]; return c; }, [selMask]);

  const selectedIndices = () => { const out: number[] = []; if (selMask) for (let i = 0; i < selMask.length; i++) if (selMask[i]) out.push(i); return out; };

  const exportManifest = () => {
    if (!corpus || !meta || !selMask) return;
    const items = selectedIndices().map(i => { const m = meta[i]; return { idx: i, src: m.s, caption: m.p, model: m.m, corpus: m.c, loras: m.l }; });
    const manifest = { version: 1, layer, created: new Date().toISOString(), spheres: selection, count: items.length, items };
    const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `selection-${layer}-${items.length}.json`; a.click();
    URL.revokeObjectURL(a.href);
  };

  // ── train: build an inline dataset manifest from the selection and start a
  // canon ai-toolkit training run via POST /v1/runs (modus.aitoolkit-training).
  const [trainOpen, setTrainOpen] = useState(false);
  const [trigger, setTrigger] = useState('');
  const [baseModel, setBaseModel] = useState('klein-4b');
  const [steps, setSteps] = useState(500);
  const [maxImages, setMaxImages] = useState(80);
  const [autocap, setAutocap] = useState(false);
  const [training, setTraining] = useState(false);
  const [trainMsg, setTrainMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const startTraining = async () => {
    if (!meta || !selMask || !trigger.trim() || training) return;
    const withUrl = selectedIndices().filter(i => meta[i]?.s);   // need an image url
    if (withUrl.length === 0) { setTrainMsg({ ok: false, text: 'no images with a usable url in selection' }); return; }
    const images = sampleImages(withUrl.map(i => ({ url: meta[i].s as string, caption: meta[i].p })), maxImages);
    if (!window.confirm(`Start a LoRA training run on ${images.length} images (trigger "${trigger.trim()}", ${steps} steps)?\n\nThis launches real GPU compute.`)) return;
    setTraining(true); setTrainMsg(null);
    try {
      const run = await launchTraining({ images, triggerWord: trigger, baseModel, steps, autocaption: autocap });
      setTrainMsg({ ok: true, text: `training started · run ${run.id.slice(0, 8)} · ${run.status}` });
    } catch (e) {
      setTrainMsg({ ok: false, text: `failed: ${String((e as Error).message).slice(0, 120)}` });
    } finally { setTraining(false); }
  };

  // gallery source: a sphere neighborhood (double-click) OR an isolated cluster.
  const GAL_CAP = 3000, GAL_PAGE = 12;
  const galleryView = useMemo(() => {
    if (!corpus) return { idx: [] as number[], total: 0 };
    const p = corpus.positions, cl = corpus.clusters;
    if (sphere) {
      const r2 = sphere.r * sphere.r; const hits: { i: number; d: number }[] = [];
      for (let i = 0; i < cl.length; i++) {
        const dx = p[i * 3] - sphere.x, dy = p[i * 3 + 1] - sphere.y, dz = p[i * 3 + 2] - sphere.z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d <= r2) hits.push({ i, d });
      }
      hits.sort((a, b) => a.d - b.d);                 // nearest first
      return { idx: hits.slice(0, GAL_CAP).map(h => h.i), total: hits.length };
    }
    if (activeCluster != null) {
      const out: number[] = []; let total = 0;
      for (let i = 0; i < cl.length; i++) if (cl[i] === activeCluster) { total++; if (out.length < GAL_CAP) out.push(i); }
      return { idx: out, total };
    }
    return { idx: [], total: 0 };
  }, [corpus, activeCluster, sphere]);
  const galleryIdx = galleryView.idx;
  const scrollRef = useRef<HTMLDivElement>(null);
  // reset the scroll window whenever the selection changes
  useEffect(() => { setGalLimit(GAL_PAGE); }, [activeCluster, sphere, galleryOpen]);
  // bootstrap: grow the page until the grid actually overflows, so there's
  // something to scroll (12 thumbs alone don't fill a tall drawer).
  useEffect(() => {
    const el = scrollRef.current;
    if (!galleryOpen || !el || galLimit >= galleryIdx.length) return;
    if (el.scrollHeight <= el.clientHeight + 40) {
      const id = setTimeout(() => setGalLimit((l) => Math.min(l + GAL_PAGE, galleryIdx.length)), 60);
      return () => clearTimeout(id);
    }
  }, [galLimit, galleryIdx, galleryOpen]);

  const sortedClusters = useMemo(() => corpus
    ? Object.entries(corpus.clusterInfo).map(([id, c]) => ({ id: +id, ...c })).sort((a, b) => b.count - a.count)
    : [], [corpus]);

  const peek = picked != null && meta ? meta[picked] : null;
  const activeInfo = activeCluster != null && corpus ? corpus.clusterInfo[activeCluster] : null;
  const view = viewer != null && meta ? meta[viewer] : null;
  // what the gallery is showing: a sphere neighborhood or an isolated cluster
  const galInfo = sphere
    ? { label: `◉ neighborhood · r=${sphere.r.toFixed(2)}`, color: '#cfe3ff', count: galleryView.total }
    : activeInfo;

  return (
    <AppShell crumb="space">
      {/* No clear-on-click here: deselection is driven by the pick result inside the
          canvas (see onPick below), which is the only place that knows whether the
          click landed on a point. Clicks still bubble normally, which the panels
          above rely on. */}
      <div className="space">
        {fallbackVestigia ? (
          <SpaceFallbackGrid items={fallbackVestigia} onRemove={removeFallbackItem} onImpressio={setFallbackImpressio} />
        ) : !glOk ? <NoWebGL /> : err ? (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--faint)', fontSize: 13, padding: 24, textAlign: 'center', maxWidth: 460, margin: '0 auto' }}>
            <div>
              <div style={{ fontSize: 22, color: 'var(--accent-soft)', opacity: .7, marginBottom: 12 }}><Ic name="footprints" /></div>
              <div style={{ color: 'var(--text)', fontSize: 14, marginBottom: 8 }}>Your space is empty</div>
              <div style={{ lineHeight: 1.6 }}>Nothing to explore yet — as you generate, your creations gather here as a 3D memory you can fly through, cluster, and cultivate.</div>
            </div>
          </div>
        ) : !corpus ? (
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--faint)', fontSize: 13 }}>loading the {layer} space…</div>
        ) : (
          <ErrorBoundary fallback={<NoWebGL />}>
            <Canvas dpr={[1, 2]} camera={{ position: cameraFrame.position, fov: cameraFrame.fov }} style={{ position: 'absolute', inset: 0 }}>
              <color attach="background" args={[BG]} />
              <fog attach="fog" args={[BG, 11, 22]} />
              <Axes />
              <Cloud corpus={corpus} baseColors={baseColors} dimMask={dimMask} onPick={(i) => { if (i == null) clearPick(); else selectPoint(i); }} onFocusPoint={focusPoint} />
              <Highlight corpus={corpus} index={picked} />
              {selection.map((s, i) => (
                <mesh key={i} position={[s.x, s.y, s.z]}>
                  <sphereGeometry args={[s.r, 20, 14]} />
                  <meshBasicMaterial color={s.mode === 'inc' ? '#39d98a' : '#ff5470'} wireframe transparent opacity={0.18} depthWrite={false} />
                </mesh>
              ))}
              {sphere && (
                <mesh position={[sphere.x, sphere.y, sphere.z]}>
                  <sphereGeometry args={[sphere.r, 24, 16]} />
                  <meshBasicMaterial color="#9ec5ff" wireframe transparent opacity={0.14} depthWrite={false} />
                </mesh>
              )}
              <CameraRig focus={focus} />
              <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} minDistance={0.4} maxDistance={22}
                zoomToCursor screenSpacePanning panSpeed={1.1} zoomSpeed={1.1}
                mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }} />
            </Canvas>

            {/* orientation cluster (noema-051): reset-view (camera) and home (navigation)
                are deliberately two distinct affordances, not merged into one button. */}
            <div className="orient-cluster" onClick={(e) => e.stopPropagation()}>
              <button onClick={resetView} title="reset view — reframe the camera">
                <Ic name="rotate-cw" /> reset view
              </button>
              <Link to="/app" title="back to app home">
                <Ic name="home" /> home
              </Link>
            </div>

            {/* top bar: layer toggle + search */}
            <div className="spacebar" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', gap: 8, marginBottom: 8, justifyContent: 'center' }}>
                {(['text', 'image'] as Layer[]).map(l => (
                  <button key={l} onClick={() => setLayer(l)} disabled={l === 'image' && !imageLayerOk}
                    style={{
                      padding: '5px 12px', borderRadius: 8, fontSize: 12, cursor: l === 'image' && !imageLayerOk ? 'not-allowed' : 'pointer',
                      border: '1px solid var(--hair)', background: layer === l ? 'var(--accent-bg)' : 'var(--raised)',
                      color: layer === l ? 'var(--accent-soft)' : (l === 'image' && !imageLayerOk ? 'var(--faint)' : 'var(--muted)'),
                    }}>
                    {l === 'text' ? 'prompt space' : `image space${imageLayerOk ? '' : ' (building…)'}`}
                  </button>
                ))}
              </div>
              <div className="search">
                <Ic name="search" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={meta ? 'Search the prompt space…' : 'loading prompts…'} disabled={!meta} />
              </div>
              <div className="mono" style={{ textAlign: 'center', color: hasReal ? 'var(--accent-soft)' : 'var(--faint)', fontSize: 'var(--fs-xs)', marginTop: 'var(--s2)' }}>
                {hasReal ? 'your space' : 'the public exhibit'} · {corpus.manifest.n.toLocaleString()} creations · {shown.toLocaleString()} shown · {sortedClusters.length} clusters · CLIP ViT-B/32 · {corpus.manifest.projection}
              </div>
              <div className="mono" style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 'var(--fs-xs)', marginTop: 2, opacity: .8 }}>
                drag rotate · mid/right-drag pan · scroll = zoom-to-cursor · dbl-click point or cluster = fly there
              </div>
            </div>

            {/* legend */}
            <div className="legend" onClick={(e) => e.stopPropagation()} style={{ maxHeight: '58vh', overflowY: 'auto' }}>
              {sortedClusters.map((c) => (
                <div className="lg" key={c.id} style={{ cursor: 'pointer', opacity: activeCluster == null || activeCluster === c.id ? 1 : 0.4 }}
                  onClick={() => { const on = activeCluster === c.id; setActiveCluster(on ? null : c.id); setGalleryOpen(!on); if (!on) focusCluster(c.id); }}>
                  <span className="d" style={{ background: c.color }} />{c.label} · {c.count.toLocaleString()}
                </div>
              ))}
            </div>

            {/* dataset selection panel */}
            {selection.length > 0 && (
              <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', left: 18, top: 18, zIndex: 8, width: 232, background: 'color-mix(in srgb, var(--panel) 92%, transparent)', backdropFilter: 'blur(8px)', border: '1px solid var(--hair)', borderRadius: 12, padding: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <b style={{ fontSize: 13, color: 'var(--text)' }}>dataset selection</b>
                  <span className="mono" style={{ marginLeft: 'auto', color: 'var(--accent-soft)', fontSize: 12 }}>{selCount.toLocaleString()} items</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 150, overflowY: 'auto', marginBottom: 9 }}>
                  {selection.map((s, i) => (
                    <div key={i} className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)' }}>
                      <span style={{ color: s.mode === 'inc' ? '#5fe0a0' : '#ff8098', flex: '0 0 auto' }}>{s.mode === 'inc' ? '＋' : '－'}</span>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>r={s.r.toFixed(2)} · ({s.x.toFixed(1)},{s.y.toFixed(1)},{s.z.toFixed(1)})</span>
                      <button onClick={() => setSelection(sel => sel.filter((_, j) => j !== i))} style={{ marginLeft: 'auto', background: 'none', border: 0, color: 'var(--faint)', cursor: 'pointer' }}>✕</button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setTrainOpen(o => !o)} disabled={selCount === 0} style={{ flex: 1, padding: '6px 0', borderRadius: 8, border: '1px solid #2c6b4f', background: 'rgba(57,217,138,.12)', color: '#5fe0a0', fontSize: 12, cursor: selCount ? 'pointer' : 'not-allowed' }}>{trainOpen ? '▾ train' : '▸ train'}</button>
                  <button onClick={exportManifest} disabled={selCount === 0} style={{ flex: 1, padding: '6px 0', borderRadius: 8, border: '1px solid var(--hair)', background: 'var(--accent-bg)', color: 'var(--accent-soft)', fontSize: 12, cursor: selCount ? 'pointer' : 'not-allowed' }}>export</button>
                  <button onClick={() => setSelection([])} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--hair)', background: 'var(--raised)', color: 'var(--faint)', fontSize: 12, cursor: 'pointer' }}>clear</button>
                </div>

                {trainOpen && (
                  <div style={{ marginTop: 9, paddingTop: 9, borderTop: '1px solid var(--hair)', display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <input value={trigger} onChange={(e) => setTrigger(e.target.value)} placeholder="trigger word (required)"
                      style={{ width: '100%', padding: '6px 8px', borderRadius: 7, border: '1px solid var(--hair)', background: 'var(--raised)', color: 'var(--text)', fontSize: 12, boxSizing: 'border-box' }} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <select value={baseModel} onChange={(e) => setBaseModel(e.target.value)} style={{ flex: 1, padding: '5px 6px', borderRadius: 7, border: '1px solid var(--hair)', background: 'var(--raised)', color: 'var(--text)', fontSize: 11.5 }}>
                        <option value="klein-4b">klein-4b</option>
                      </select>
                      <label className="mono" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--faint)' }}>
                        steps<input type="number" min={50} max={4000} step={50} value={steps} onChange={(e) => setSteps(parseInt(e.target.value) || 0)} style={{ width: 52, padding: '4px 5px', borderRadius: 6, border: '1px solid var(--hair)', background: 'var(--raised)', color: 'var(--text)', fontSize: 11.5 }} />
                      </label>
                    </div>
                    <label className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--faint)' }}>
                      max images<input type="number" min={5} max={500} step={5} value={maxImages} onChange={(e) => setMaxImages(parseInt(e.target.value) || 0)} style={{ width: 56, padding: '4px 5px', borderRadius: 6, border: '1px solid var(--hair)', background: 'var(--raised)', color: 'var(--text)', fontSize: 11.5 }} />
                      <span style={{ marginLeft: 'auto' }}>{selCount > maxImages ? `sampling ${maxImages}/${selCount.toLocaleString()}` : `all ${selCount}`}</span>
                    </label>
                    <label className="mono" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--muted)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={autocap} onChange={(e) => setAutocap(e.target.checked)} />
                      auto-caption (ignore prompts)
                    </label>
                    <button onClick={startTraining} disabled={training || !trigger.trim()} style={{ padding: '7px 0', borderRadius: 8, border: '1px solid #2c6b4f', background: training ? 'var(--raised)' : 'rgba(57,217,138,.18)', color: '#5fe0a0', fontSize: 12.5, cursor: training || !trigger.trim() ? 'not-allowed' : 'pointer' }}>
                      {training ? 'starting…' : '⚡ start training run'}
                    </button>
                    {trainMsg && <div className="mono" style={{ fontSize: 10.5, lineHeight: 1.4, color: trainMsg.ok ? '#5fe0a0' : '#ff8098' }}>{trainMsg.text}{trainMsg.ok && <> · <Link to="/status" style={{ color: 'var(--accent-soft)' }}>status →</Link></>}</div>}
                  </div>
                )}
              </div>
            )}

            {/* browse button when a cluster is isolated */}
            {activeInfo && !galleryOpen && (
              <button onClick={(e) => { e.stopPropagation(); setGalleryOpen(true); }}
                style={{ position: 'absolute', left: 18, bottom: 18, zIndex: 6, transform: 'translateY(calc(-58vh - 8px))',
                  padding: '7px 12px', borderRadius: 9, border: '1px solid var(--hair)', background: 'var(--raised)', color: 'var(--accent-soft)', fontSize: 12, cursor: 'pointer' }}>
                ▦ browse {activeInfo.label} ({activeInfo.count.toLocaleString()})
              </button>
            )}

            {/* small peek (hover/last pick) */}
            <div className={`peek${peek ? ' show' : ''}`} onClick={(e) => { e.stopPropagation(); if (picked != null) setViewer(picked); }} style={{ cursor: peek ? 'pointer' : 'default' }}>
              {peek && <>
                {peek.s ? <div className="pimg" style={{ backgroundImage: `url(${peek.s})`, backgroundSize: 'cover', backgroundPosition: 'center' }} /> : <div className="pimg" />}
                <div className="pmeta">
                  <b style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{peek.p || '(no prompt)'}</b>
                  <span className="mono" style={{ color: 'var(--faint)' }}>{peek.m} · {peek.c} · {peek.d} · click to enlarge</span>
                </div>
              </>}
            </div>

            {/* gallery drawer */}
            {galleryOpen && galInfo && (
              <div onClick={(e) => e.stopPropagation()} style={{
                position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(420px, 80vw)', zIndex: 7,
                background: 'color-mix(in srgb, var(--panel) 96%, transparent)', backdropFilter: 'blur(10px)',
                borderLeft: '1px solid var(--hair)', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--hair)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: '0 0 auto', width: 9, height: 9, borderRadius: '50%', background: galInfo.color }} />
                  <b style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{galInfo.label}</b>
                  <span className="mono" style={{ color: 'var(--faint)', fontSize: 11, flex: '0 0 auto' }}>{Math.min(galLimit, galleryIdx.length)} / {galInfo.count.toLocaleString()}</span>
                  <button onClick={() => { setGalleryOpen(false); setSphere(null); }} style={{ marginLeft: 'auto', background: 'none', border: 0, color: 'var(--faint)', cursor: 'pointer', fontSize: 16 }}>✕</button>
                </div>
                {sphere && (
                  <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--hair)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="mono" style={{ color: 'var(--faint)', fontSize: 11, flex: '0 0 auto' }}>radius</span>
                      <input type="range" min={0.03} max={2.5} step={0.01} value={sphere.r}
                        onChange={(e) => setSphere(s => s ? { ...s, r: parseFloat(e.target.value) } : s)} style={{ flex: 1 }} />
                      <span className="mono" style={{ color: 'var(--muted)', fontSize: 11, flex: '0 0 auto', width: 30 }}>{sphere.r.toFixed(2)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => addSel('inc')} style={{ flex: 1, padding: '6px 0', borderRadius: 8, border: '1px solid #2c6b4f', background: 'rgba(57,217,138,.12)', color: '#5fe0a0', fontSize: 12, cursor: 'pointer' }}>＋ include in dataset</button>
                      <button onClick={() => addSel('exc')} style={{ flex: 1, padding: '6px 0', borderRadius: 8, border: '1px solid #7a3140', background: 'rgba(255,84,112,.12)', color: '#ff8098', fontSize: 12, cursor: 'pointer' }}>－ exclude</button>
                    </div>
                  </div>
                )}
                <div ref={scrollRef}
                  onScroll={(e) => { const el = e.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 240) setGalLimit((l) => Math.min(l + GAL_PAGE, galleryIdx.length)); }}
                  style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridAutoRows: 'min-content', gap: 6, alignContent: 'start' }}>
                  {galleryIdx.slice(0, galLimit).map((i) => {
                    const m = meta?.[i];
                    return (
                      <div key={i} onClick={() => setViewer(i)} title={m?.p}
                        style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: 6, overflow: 'hidden', background: '#0c1116', cursor: 'pointer', border: viewer === i ? '1px solid var(--accent)' : '1px solid var(--hair)' }}>
                        {m?.s && <img src={m.s} loading="lazy" alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />}
                      </div>
                    );
                  })}
                  {!meta && <div className="mono" style={{ gridColumn: '1/-1', color: 'var(--faint)', fontSize: 12, padding: 12 }}>loading thumbnails…</div>}
                  {meta && galLimit < galleryIdx.length && <div className="mono" style={{ gridColumn: '1/-1', color: 'var(--faint)', fontSize: 11, padding: 8, textAlign: 'center' }}>scroll for more…</div>}
                </div>
              </div>
            )}

            {/* full-size viewer */}
            {view && (
              <div onClick={() => setViewer(null)} style={{ position: 'absolute', inset: 0, zIndex: 20, background: 'rgba(4,5,7,.82)', display: 'grid', placeItems: 'center', padding: 24 }}>
                <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: 16, maxWidth: 'min(1000px, 92vw)', maxHeight: '88vh', background: 'var(--panel)', border: '1px solid var(--hair)', borderRadius: 14, overflow: 'hidden' }}>
                  <div style={{ flex: '0 0 auto', maxWidth: '62vw', background: '#06090c', display: 'grid', placeItems: 'center' }}>
                    {view.s ? <img src={view.s} alt="" style={{ maxWidth: '100%', maxHeight: '88vh', objectFit: 'contain', display: 'block' }} /> : <div style={{ padding: 60, color: 'var(--faint)' }}>no image</div>}
                  </div>
                  <div style={{ width: 280, padding: '18px 18px', overflowY: 'auto', flexShrink: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span className="mono" style={{ color: 'var(--faint)', fontSize: 11 }}>{view.m} · {view.c} · {view.d}</span>
                      <button onClick={() => setViewer(null)} style={{ background: 'none', border: 0, color: 'var(--faint)', cursor: 'pointer', fontSize: 16 }}>✕</button>
                    </div>
                    <div style={{ color: 'var(--text)', fontSize: 13, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{view.p || '(no prompt)'}</div>
                    {view.l && view.l.length > 0 && <div className="mono" style={{ color: 'var(--accent-soft)', fontSize: 11.5, marginTop: 12 }}>{view.l.map(x => `<lora:${x}>`).join('  ')}</div>}
                    {view.s && <a href={view.s} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 14, color: 'var(--accent-soft)', fontSize: 12, textDecoration: 'none' }}>open original ↗</a>}
                  </div>
                </div>
              </div>
            )}
          </ErrorBoundary>
        )}
      </div>
    </AppShell>
  );
}
