import { useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';

// ── Two honest signals (see identity/noema/chat-spec.md) ──────────────────────
// hemisphere = what NOEMA can SEE (lit remote · ring TEE/your-server · dashed local)
// egress     = whether the request LEFT NOEMA, and to whom (↗, warm --egress)
// They are kept deliberately distinct: a local run (dashed, we see nothing) and an
// API run (lit, we see AND it leaves) are different truths — never collapse them.
type Vis = 'remote' | 'tee' | 'local';
type Egress = { left: true; to: string } | { left: false; note: string };
interface Prov { modality: string; route: string; vis: Vis; egress: Egress; canvas?: boolean }
interface Msg { who: 'concierge' | 'you'; body: ReactNode; prov?: Prov[] }

// The hemisphere glyph — shared grammar with Canvas/Funding/Card:
// remote = lit (filled half-disc + ring, accent); tee = ring only (slate);
// local = dashed ring (grey).
function Hemisphere({ vis, className }: { vis: Vis; className?: string }) {
  const lit = vis === 'remote';
  const stroke = vis === 'remote' ? 'var(--accent)' : vis === 'tee' ? 'var(--slate)' : 'var(--grey)';
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {lit && <path d="M12,2 A10 10 0 0 0 12,22 Z" fill="var(--accent)" />}
      <circle cx="12" cy="12" r="10" fill="none" stroke={stroke} strokeWidth="1.4"
        strokeDasharray={vis === 'local' ? '2.4 2.4' : undefined} />
    </svg>
  );
}

// ── Chat routing — the four routes offered by the composer picker ─────────────
type RouteId = 'noema' | 'remote' | 'tee' | 'local';
interface Route { id: RouteId; name: string; vis: Vis; tag: string; tagKind: 'egress' | 'wait' | 'safe'; egress: boolean; desc: ReactNode }

const ROUTES: Route[] = [
  { id: 'noema', name: 'NOEMA default', vis: 'remote', tag: '↗ leaves noema', tagKind: 'egress', egress: true,
    desc: <>Routed to a top provider’s API. <b>Fastest, most capable, cheapest per token</b> — but your words leave our app to that provider. <b>We always name who.</b></> },
  { id: 'remote', name: 'Your remote LLM', vis: 'tee', tag: '↗ to your server', tagKind: 'egress', egress: true,
    desc: <>An endpoint <b>you provision</b>; conversation goes to your infrastructure.</> },
  { id: 'tee', name: 'TEE · sealed', vis: 'tee', tag: '~40s warm-up', tagKind: 'wait', egress: false,
    desc: <>Model loads <b>into a sealed enclave</b> — we see nothing but the meter. Takes a moment to warm up.</> },
  { id: 'local', name: 'Local', vis: 'local', tag: 'nothing leaves', tagKind: 'safe', egress: false,
    desc: <>llama.cpp on <b>your machine</b>. Private by construction; capability bounded by your hardware.</> },
];

// Map a chosen route → a provenance meter. TODO(backend): real routing/egress
// metadata is not in the API yet; this derives the meter presentationally from
// the picker selection so the honest signals are always shown.
function provFor(r: Route, modality: string): Prov {
  switch (r.id) {
    case 'noema':  return { modality, route: 'routed via anthropic api', vis: 'remote', egress: { left: true, to: 'anthropic' } };
    case 'remote': return { modality, route: 'your remote endpoint', vis: 'tee', egress: { left: true, to: 'your server' } };
    case 'tee':    return { modality, route: 'sealed enclave', vis: 'tee', egress: { left: false, note: 'sealed · we see only the meter' } };
    default:       return { modality, route: 'local · llama-ed', vis: 'local', egress: { left: false, note: 'nothing left your machine' } };
  }
}

const SEED: Msg[] = [
  { who: 'you', body: 'draft a tight logline for a glass-cathedral-from-circuitry short, then make the key frame' },
  { who: 'concierge', body: (
    <>“In a city that prays in fiber-optic light, an architect grows a cathedral from living circuitry — and it starts to dream back.” Here’s the key frame:
      <div className="gen-media" /></>
  ), prov: [
    // image was generated locally — dashed (we see nothing), nothing left the machine
    { modality: 'image', route: 'local · llama-ed', vis: 'local', egress: { left: false, note: 'nothing left your machine' }, canvas: true },
    // the logline text came from the provider API — lit (we see) AND it left NOEMA
    { modality: 'text', route: 'routed via anthropic api', vis: 'remote', egress: { left: true, to: 'anthropic' } },
  ] },
];

function ProvMeter({ p, onCanvas }: { p: Prov; onCanvas: (p: Prov) => void }) {
  return (
    <div className="prov-row">
      <span className="prov">
        <Hemisphere vis={p.vis} className="phemi" />
        <span className="prov-seg">{p.modality} · {p.route}</span>
        <span className="prov-div" />
        {p.egress.left
          ? <span className="prov-egress">↗ left noema → {p.egress.to}</span>
          : <span className="prov-sealed">{p.egress.note}</span>}
      </span>
      {p.canvas && <button className="canvas-btn" onClick={() => onCanvas(p)}>→ canvas</button>}
    </div>
  );
}

export function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>(SEED);
  const [route, setRoute] = useState<RouteId>('noema');   // default selection per spec
  const [pickOpen, setPickOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const sel = ROUTES.find((r) => r.id === route)!;

  function toCanvas(_p: Prov) {
    // TODO(canvas-handoff): seed a canvas node from this generation (modality +
    // this turn's output) once a node-creation entry is callable from chat. No
    // such entry is directly invokable yet, so we navigate to the canvas surface.
    navigate('/canvas');
  }

  function send() {
    const v = taRef.current?.value.trim();
    if (!v) return;
    setMsgs((m) => [
      ...m,
      { who: 'you', body: v },
      { who: 'concierge',
        body: <>Reading that as <span className="verb">make</span> — quoting… <span className="dots"><span /><span /><span /></span></>,
        prov: [provFor(sel, 'text')] },
    ]);
    if (taRef.current) { taRef.current.value = ''; taRef.current.style.height = 'auto'; }
  }

  return (
    <AppShell crumb="chat" concierge={false}>
      <div className="thread"><div className="wrap">
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.who === 'you' ? 'user' : 'bot'}`}>
            <div className="av" />
            <div className="msg-col">
              <div className="who">{m.who === 'concierge' ? 'noema' : 'you'}</div>
              <div className="body">{m.body}</div>
              {m.prov?.map((p, j) => <ProvMeter key={j} p={p} onCanvas={toCanvas} />)}
            </div>
          </div>
        ))}
      </div></div>
      <div className="composer">
        <div className="box">
          <textarea
            ref={taRef} rows={1} placeholder="Describe what you want to make…"
            onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="send" onClick={send}><Ic name="arrow-up" /></button>
        </div>
        <div className="hint">
          {/* Route picker — replaces the old destination indicator. Mirrors the
              selection and opens the four-route popover above the composer. */}
          <div className="route-wrap">
            <button className="route-btn" onClick={() => setPickOpen((o) => !o)} aria-expanded={pickOpen}>
              <Hemisphere vis={sel.vis} className="phemi" />
              <span>{sel.name}</span>
              {sel.egress && <span className="rb-eg">↗</span>}
              <span className="car">▾</span>
            </button>
            {pickOpen && (
              <>
                <div className="route-backdrop" onClick={() => setPickOpen(false)} />
                <div className="route-pop">
                  <div className="route-pop-head">where should this run? · chat routing</div>
                  {ROUTES.map((r) => (
                    <div key={r.id} className={`route-opt${r.id === route ? ' sel' : ''}`}
                      onClick={() => { setRoute(r.id); setPickOpen(false); }}>
                      <Hemisphere vis={r.vis} className="rhemi" />
                      <div>
                        <div className="rname">{r.name}<span className={`route-tag ${r.tagKind}`}>{r.tag}</span></div>
                        <div className="rdesc">{r.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <span className="keys">
            <span><span className="mono">⏎</span> send</span>
            <span><span className="mono">⇧⏎</span> newline</span>
          </span>
        </div>
      </div>
    </AppShell>
  );
}
