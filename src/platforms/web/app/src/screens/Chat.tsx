import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { isExampleCleared, clearExample } from '../lib/chatExample';
import { api, newTurnKey, type ConciergeProposal, type ColloquiumSummary } from '../lib/api';
import { useProject } from '../state/project';
import { ProposalCard } from '../components/ProposalCard';

// ── Two honest signals ────────────────────────────────────────────────────────
// hemisphere = what NOEMA can SEE (lit remote · ring TEE/your-server)
// egress     = whether the request LEFT NOEMA, and to whom (↗, warm --egress)
// They are kept deliberately distinct: a your-server run (ring, we see nothing) and
// an API run (lit, we see AND it leaves) are different truths — never collapse them.
type Vis = 'remote' | 'tee';
type Egress = { left: true; to: string } | { left: false; note: string };
interface Prov { modality: string; route: string; vis: Vis; egress: Egress; canvas?: boolean }
interface Msg { who: 'concierge' | 'you'; body: ReactNode; prov?: Prov[]; isExample?: boolean }


// The hemisphere glyph — shared grammar with Canvas/Funding/Card:
// remote = lit (filled half-disc + ring, accent); tee = ring only (slate).
function Hemisphere({ vis, className }: { vis: Vis; className?: string }) {
  const lit = vis === 'remote';
  const stroke = vis === 'remote' ? 'var(--accent)' : 'var(--slate)';
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      {lit && <path d="M12,2 A10 10 0 0 0 12,22 Z" fill="var(--accent)" />}
      <circle cx="12" cy="12" r="10" fill="none" stroke={stroke} strokeWidth="1.4" />
    </svg>
  );
}

// ── Chat routing — the routes offered by the composer picker ──────────────────
type RouteId = 'noema' | 'remote';
interface Route { id: RouteId; name: string; vis: Vis; tag: string; tagKind: 'egress' | 'wait' | 'safe'; egress: boolean; desc: ReactNode }

const ROUTES: Route[] = [
  { id: 'noema', name: 'NOEMA default', vis: 'remote', tag: '↗ leaves noema', tagKind: 'egress', egress: true,
    desc: <>Routed to a top provider’s API. <b>Fastest, most capable, cheapest per token</b> — but your words leave our app to that provider. <b>We always name who.</b></> },
  { id: 'remote', name: 'Your remote LLM', vis: 'tee', tag: '↗ to your server', tagKind: 'egress', egress: true,
    desc: <>An endpoint <b>you provision</b>; conversation goes to your infrastructure.</> },
];

// Map a chosen route → a provenance meter. TODO(backend): real routing/egress
// metadata is not in the API yet; this derives the meter presentationally from
// the picker selection so the honest signals are always shown.
function provFor(r: Route, modality: string): Prov {
  switch (r.id) {
    case 'noema':  return { modality, route: 'routed via openrouter', vis: 'remote', egress: { left: true, to: 'openrouter' } };
    case 'remote': return { modality, route: 'your remote endpoint', vis: 'tee', egress: { left: true, to: 'your server' } };
  }
}

const SEED: Msg[] = [
  { who: 'you', body: 'draft a tight logline for a glass-cathedral-from-circuitry short, then make the key frame', isExample: true },
  { who: 'concierge', body: (
    <>“In a city that prays in fiber-optic light, an architect grows a cathedral from living circuitry — and it starts to dream back.” Here’s the key frame:
      <div className="gen-media" /></>
  ), prov: [
    // image was generated on a RunPod GPU — lit (we see), and it left NOEMA to the provider
    { modality: 'image', route: 'generated on runpod', vis: 'remote', egress: { left: true, to: 'runpod' }, canvas: true },
    // the logline text came from the concierge's provider — lit (we see) AND it left NOEMA
    { modality: 'text', route: 'routed via openrouter', vis: 'remote', egress: { left: true, to: 'openrouter' } },
  ], isExample: true },
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

// ── Thread history (noema-111) — group the caller's threads by project ────────
// Threads arrive newest-first from GET /v1/colloquia. A thread with no projectId
// (or whose project isn't in the current workspace) falls into "Uncategorized",
// which is always sorted last.
const UNCATEGORIZED = '__uncategorized__';
interface ThreadGroup { key: string; name: string; threads: ColloquiumSummary[] }
function groupThreads(threads: ColloquiumSummary[], nameOf: (id?: string) => string | undefined): ThreadGroup[] {
  const buckets = new Map<string, ThreadGroup>();
  for (const t of threads) {
    const resolved = t.projectId ? nameOf(t.projectId) : undefined;
    const key = resolved ? t.projectId! : UNCATEGORIZED;
    const name = resolved ?? 'Uncategorized';
    let g = buckets.get(key);
    if (!g) { g = { key, name, threads: [] }; buckets.set(key, g); }
    g.threads.push(t);
  }
  return [...buckets.values()].sort((a, b) =>
    a.key === UNCATEGORIZED ? 1 : b.key === UNCATEGORIZED ? -1 : 0,
  );
}
function threadTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
// One agent Dictum's corpus → a rendered body: a serialized proposal (JSON with kind:'proposal',
// see colloquiaRouter.dictumCorpus) round-trips to a ProposalCard; anything else is a plain reply.
function hydrateAgentBody(corpus: string, onAdjust: (priorRunId: string | undefined) => void): ReactNode {
  try {
    const parsed = JSON.parse(corpus) as { kind?: string } & Record<string, unknown>;
    if (parsed && parsed.kind === 'proposal') {
      const proposal = { ...parsed, tokenUsage: (parsed.tokenUsage as ConciergeProposal['tokenUsage']) ?? { totalTokens: 0 } } as unknown as ConciergeProposal;
      return <ProposalCard proposal={proposal} onAdjust={onAdjust} />;
    }
  } catch { /* not JSON — a plain text reply */ }
  return corpus;
}

// Inline styles for the history drawer (noema-111). The chat stylesheet (styles/app.css)
// owns the surrounding chrome; the drawer ships its own layout inline so it is self-contained
// and theme-variable driven (var(--*) match the rest of the app's tokens).
const H = {
  backdrop: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 40 } as const,
  drawer: {
    position: 'fixed', top: 0, left: 0, bottom: 0, width: 'min(320px, 85vw)', zIndex: 41,
    background: 'var(--panel, #14161c)', borderRight: '1px solid var(--line, #2a2f3a)',
    display: 'flex', flexDirection: 'column', boxShadow: '2px 0 16px rgba(0,0,0,0.3)',
  } as const,
  head: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 14px', borderBottom: '1px solid var(--line, #2a2f3a)' } as const,
  newBtn: { marginLeft: 'auto', fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid var(--line, #2a2f3a)', background: 'transparent', color: 'inherit', cursor: 'pointer' } as const,
  xBtn: { display: 'flex', padding: '4px', background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' } as const,
  body: { overflowY: 'auto', padding: '8px 6px', flex: 1 } as const,
  empty: { opacity: 0.6, fontSize: '13px', padding: '16px 12px' } as const,
  groupName: { fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.55, padding: '10px 10px 4px' } as const,
  item: { display: 'flex', flexDirection: 'column', gap: '2px', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: '8px', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' } as const,
  itemActive: { background: 'var(--hover, rgba(255,255,255,0.06))' } as const,
  itemTitle: { fontSize: '13px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const,
  itemPreview: { fontSize: '12px', opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const,
  itemTime: { fontSize: '11px', opacity: 0.45 } as const,
  bar: { display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' } as const,
  toggle: { fontSize: '12px', padding: '5px 12px', borderRadius: '6px', border: '1px solid var(--line, #2a2f3a)', background: 'transparent', color: 'inherit', cursor: 'pointer' } as const,
};

export function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>(() => (isExampleCleared() ? [] : SEED));
  const [route, setRoute] = useState<RouteId>('noema');   // default selection per spec
  const [pickOpen, setPickOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  const sel = ROUTES.find((r) => r.id === route)!;

  // The concierge thread (noema-095) — lazily created on the first send() in this
  // screen instance. `critiqueOf` is set by a ProposalCard's "adjust" affordance
  // (Decision record Q3) and consumed by the NEXT send() as `priorRunId`, then cleared.
  const [colloquiumId, setColloquiumId] = useState<string | undefined>();
  const [sending, setSending] = useState(false);
  const [critiqueOf, setCritiqueOf] = useState<string | undefined>();

  // Thread history (noema-111): the caller's own past threads, grouped by project.
  // The active project stamps new threads; the whole set groups the list. A thread is
  // created lazily on first send() — mounting this screen never creates a throwaway one.
  const { project, projects } = useProject();
  const [threads, setThreads] = useState<ColloquiumSummary[]>([]);
  const [listOpen, setListOpen] = useState(false);
  const projectNameOf = (id?: string): string | undefined =>
    id ? projects.find((p) => p.id === id)?.name : undefined;

  async function refreshThreads() {
    try {
      const { colloquia } = await api.listColloquia();
      setThreads(colloquia);
    } catch { /* offline / not-yet-authed — keep whatever we have */ }
  }
  // Load the thread list once on mount (no auto-resume, no auto-create — the list is the
  // landing state; a click resumes, a send starts fresh).
  useEffect(() => { void refreshThreads(); }, []);

  // `?seed=…` — another surface (e.g. a fresh collection's hub) hands the concierge an opening
  // line. It PREFILLS the composer and nothing more: the user still reads it, edits it, and
  // presses send. Consumed once — cleared after the first send so it cannot re-seed.
  const [params] = useSearchParams();
  const [seed, setSeed] = useState<string | null>(() => params.get('seed'));
  useEffect(() => {
    if (!seed || !taRef.current) return;
    const ta = taRef.current;
    ta.value = seed;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
    ta.focus();
  }, [seed]);

  // Resume a past thread: hydrate the message list from its dicta and make it the active
  // colloquium so the next send() continues it (not a new thread).
  async function resume(id: string) {
    try {
      const { dicta } = await api.getColloquium(id);
      const hydrated: Msg[] = dicta
        .filter((d) => d.genus !== 'systema')
        .map((d) =>
          d.genus === 'user'
            ? { who: 'you', body: d.corpus }
            : { who: 'concierge', body: hydrateAgentBody(d.corpus, adjust) },
        );
      clearExample();
      setMsgs(hydrated);
      setColloquiumId(id);
      setListOpen(false);
    } catch (e) {
      setMsgs((m) => [...m, { who: 'concierge', body: e instanceof Error ? e.message : String(e) }]);
      setListOpen(false);
    }
  }

  // Start a fresh thread: drop the active colloquium + message list. The next send() creates
  // a new thread (stamped with the active project).
  function startNew() {
    setColloquiumId(undefined);
    setMsgs([]);
    clearExample();
    setListOpen(false);
  }

  function toCanvas(_p: Prov) {
    // TODO(canvas-handoff): seed a canvas node from this generation (modality +
    // this turn's output) once a node-creation entry is callable from chat. No
    // such entry is directly invokable yet, so we navigate to the canvas surface.
    navigate('/canvas');
  }

  function dismissExample() {
    clearExample();
    setMsgs((prev) => prev.filter((m) => !m.isExample));
  }

  // ProposalCard's inline "adjust" affordance (Q3/Step 6): pre-focus the composer
  // and tag the next send() as a critique turn referencing this proposal's run.
  function adjust(priorRunId: string | undefined) {
    setCritiqueOf(priorRunId);
    taRef.current?.focus();
  }

  async function send() {
    const v = taRef.current?.value.trim();
    if (!v || sending) return;
    setMsgs((m) => {
      const hadExample = m.some((x) => x.isExample);
      const base = hadExample ? m.filter((x) => !x.isExample) : m;
      if (hadExample) clearExample();
      return [...base, { who: 'you', body: v }];
    });
    if (taRef.current) { taRef.current.value = ''; taRef.current.style.height = 'auto'; }
    if (seed) setSeed(null);   // one-shot prefill — never re-seeds after the first send
    const priorRunId = critiqueOf;
    setCritiqueOf(undefined);

    setSending(true);
    let createdThread = false;
    try {
      let cid = colloquiumId;
      if (!cid) {
        // Stamp the active project (noema-111) so the thread groups correctly in history.
        const { colloquium } = await api.createColloquium(project ? { projectId: project.id } : {});
        cid = colloquium.id;
        setColloquiumId(cid);
        createdThread = true;
      }
      const { result } = await api.postDictum(cid, {
        turnKey: newTurnKey(),
        message: v,
        ...(priorRunId ? { priorRunId } : {}),
      });
      setMsgs((m) => [
        ...m,
        result.kind === 'proposal'
          ? { who: 'concierge', body: <ProposalCard proposal={result as ConciergeProposal} onAdjust={adjust} /> }
          : { who: 'concierge', body: result.text, prov: [provFor(sel, 'text')] },
      ]);
      // A new thread now exists (or an existing one advanced) — refresh history so it lists.
      if (createdThread) void refreshThreads();
    } catch (e) {
      setMsgs((m) => [...m, { who: 'concierge', body: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setSending(false);
    }
  }

  const groups = groupThreads(threads, projectNameOf);

  return (
    <AppShell crumb="chat" concierge={false}>
      {/* Thread history (noema-111) — a project-grouped drawer of the caller's past threads. */}
      {listOpen && <div style={H.backdrop} onClick={() => setListOpen(false)} />}
      {listOpen && (
        <aside style={H.drawer} aria-label="Conversation history">
          <div style={H.head}>
            <b>Conversations</b>
            <button style={H.newBtn} onClick={startNew}>+ New</button>
            <button style={H.xBtn} onClick={() => setListOpen(false)} aria-label="Close history"><Ic name="x" /></button>
          </div>
          <div style={H.body}>
            {groups.length === 0 && <div style={H.empty}>No conversations yet.</div>}
            {groups.map((g) => (
              <div key={g.key}>
                <div style={H.groupName}>{g.name}</div>
                {g.threads.map((t) => (
                  <button
                    key={t.id}
                    style={{ ...H.item, ...(t.id === colloquiumId ? H.itemActive : {}) }}
                    onClick={() => resume(t.id)}
                  >
                    <span style={H.itemTitle}>{t.titulus || t.preview || 'Untitled'}</span>
                    {t.titulus && t.preview && <span style={H.itemPreview}>{t.preview}</span>}
                    <span style={H.itemTime}>{threadTime(t.mutatum)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </aside>
      )}
      <div className="thread"><div className="wrap">
        <div style={H.bar}>
          <button style={H.toggle} onClick={() => { setListOpen(true); void refreshThreads(); }} aria-label="Conversation history">
            ☰ History
          </button>
        </div>
        {msgs.some((m) => m.isExample) && (
          <button className="byo-dismiss chat-example-clear" onClick={dismissExample} title="Clear example conversation" aria-label="Clear example conversation">✕</button>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.who === 'you' ? 'user' : 'bot'}${m.isExample ? ' chat-example' : ''}`}>
            <div className="av" />
            <div className="msg-col">
              <div className="who">{m.who === 'concierge' ? 'noema' : 'you'}{m.isExample && <span className="badge chat-example-badge">Example</span>}</div>
              <div className="body">{m.body}</div>
              {m.prov?.map((p, j) => <ProvMeter key={j} p={p} onCanvas={toCanvas} />)}
            </div>
          </div>
        ))}
        {sending && (
          <div className="stage"><span className="dots"><span /><span /><span /></span> noema is thinking…</div>
        )}
      </div></div>
      <div className="composer">
        <div className="box">
          <textarea
            ref={taRef} rows={1} placeholder="Describe what you want to make…"
            onInput={(e) => { const t = e.currentTarget; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 160) + 'px'; }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="send" disabled={sending} onClick={send}><Ic name="arrow-up" /></button>
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
