import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { useAssistTarget, usePromptAssist } from '../state/promptAssist';
import { buildPrompt } from '../lib/promptExamples';
import { api, newTurnKey, type ConciergeProposal, type ConciergeResult, type ColloquiumSummary } from '../lib/api';
import { useProject } from '../state/project';
import { ProposalCard } from '../components/ProposalCard';
import { pickConciergeThread } from '../lib/conciergeThread';

// Thread history in the compact dock (noema-111). The dock renders only the LATEST turn (not a
// full transcript), so "resume" here means: continue the picked thread on the next send, and show
// its last agent turn as the current result for continuity. Grouping mirrors Chat.tsx.
const DOCK_UNCATEGORIZED = '__uncategorized__';
interface DockGroup { key: string; name: string; threads: ColloquiumSummary[] }
function groupDockThreads(threads: ColloquiumSummary[], nameOf: (id?: string) => string | undefined): DockGroup[] {
  const buckets = new Map<string, DockGroup>();
  for (const t of threads) {
    const resolved = t.projectId ? nameOf(t.projectId) : undefined;
    const key = resolved ? t.projectId! : DOCK_UNCATEGORIZED;
    const name = resolved ?? 'Uncategorized';
    let g = buckets.get(key);
    if (!g) { g = { key, name, threads: [] }; buckets.set(key, g); }
    g.threads.push(t);
  }
  return [...buckets.values()].sort((a, b) => (a.key === DOCK_UNCATEGORIZED ? 1 : b.key === DOCK_UNCATEGORIZED ? -1 : 0));
}
// Reconstruct a ConciergeResult from a stored agent Dictum corpus (a serialized proposal round-trips
// to a proposal; anything else is a plain reply) so the dock shows the resumed thread's last turn.
function agentDictumToResult(corpus: string): ConciergeResult {
  try {
    const parsed = JSON.parse(corpus) as { kind?: string } & Record<string, unknown>;
    if (parsed && parsed.kind === 'proposal') {
      return { ...parsed, tokenUsage: (parsed.tokenUsage as ConciergeProposal['tokenUsage']) ?? { totalTokens: 0 } } as unknown as ConciergeProposal;
    }
  } catch { /* plain reply */ }
  return { kind: 'reply', text: corpus, tokenUsage: { totalTokens: 0 } };
}

// Chat collapses into this on every screen except full chat (utilitarian co-pilot).
// When a form's prompt field is focused it slides open with tailored augmentation:
// a copyable example, and a "write it for me" draft from the user's brief.
export function Concierge({ hasContext }: { hasContext: boolean }) {
  const target = useAssistTarget();
  const location = useLocation();
  const { clear } = usePromptAssist();
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Idle-branch colloquia wiring (noema-099, Step 7): the same client methods and
  // local-state-plus-handler shape as `brief`/`setBrief`/`gen()` above, mirrored
  // for the compact idle panel. Per Decision record Q4, identity is unchanged
  // (authHeaders()/getActivePurse() inside api.createColloquium/postDictum).
  const idleRef = useRef<HTMLInputElement>(null);
  const [idleMsg, setIdleMsg] = useState('');
  const [idleSending, setIdleSending] = useState(false);
  const [idleColloquiumId, setIdleColloquiumId] = useState<string | undefined>();
  const [idleResult, setIdleResult] = useState<ConciergeResult | null>(null);
  const [idleCritiqueOf, setIdleCritiqueOf] = useState<string | undefined>();

  // Thread history in the dock (noema-111): pick a past thread to continue. The active project
  // stamps a NEW dock thread; the list groups the caller's threads by project.
  const { project, projects } = useProject();
  const [threads, setThreads] = useState<ColloquiumSummary[]>([]);
  const [histOpen, setHistOpen] = useState(false);
  // The dock is remounted per-screen (AppShell), so this fires once per mount to resolve the
  // active-thread pointer BEFORE the user's first send — otherwise idleSend()'s lazy create
  // (below) fires on every navigation and orphans the prior thread (noema-324).
  const autoResumeAttempted = useRef(false);
  const projectNameOf = (id?: string): string | undefined => (id ? projects.find((p) => p.id === id)?.name : undefined);

  async function refreshThreads() {
    try {
      const { colloquia } = await api.listColloquia();
      setThreads(colloquia);
    } catch { /* offline / not-yet-authed */ }
  }
  // Resume a thread in the dock: make it active (next send continues it) and surface its last
  // agent turn as the current result.
  async function resumeDock(id: string) {
    setHistOpen(false);
    setIdleColloquiumId(id);
    try {
      const { dicta } = await api.getColloquium(id);
      const lastAgent = [...dicta].reverse().find((d) => d.genus === 'agent');
      setIdleResult(lastAgent ? agentDictumToResult(lastAgent.corpus) : null);
    } catch { /* keep the thread active even if the last-turn fetch fails */ }
  }
  function startNewDock() {
    setHistOpen(false);
    setIdleColloquiumId(undefined);
    setIdleResult(null);
  }

  // Resume by default (noema-324): on mount, with no active pointer yet, pick the caller's most
  // recent thread and resume into it. Runs once per mount (guarded by the ref) so it never fights
  // the explicit "+ New conversation" affordance, which clears the pointer on purpose afterward.
  // Zero existing threads is the one case this leaves the pointer unset — idleSend() below still
  // creates lazily on the first message, same as it always has.
  useEffect(() => {
    if (autoResumeAttempted.current) return;
    autoResumeAttempted.current = true;
    void (async () => {
      try {
        const { colloquia } = await api.listColloquia();
        setThreads(colloquia);
        const pick = pickConciergeThread(colloquia);
        if (pick.action === 'resume') void resumeDock(pick.id);
      } catch { /* offline / not-yet-authed — falls back to lazy create on first send */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A fresh target (new object on each field focus) slides the panel open and resets.
  // On mobile (<=760px) the panel must not auto-open — it collides with the OS keyboard —
  // so `.cbtn` remains the sole open trigger there. Checked live (not cached at mount)
  // since the viewport can rotate or resize mid-session.
  useEffect(() => {
    setBrief(''); setDraft(null); setCopied(false);
    if (!target) return;
    const mq = window.matchMedia('(max-width:760px)');
    if (!mq.matches) setOpen(true);
  }, [target]);

  // First-visit activation (noema-226, IA ruling #5): the first time this browser lands on a given
  // route, the panel announces itself the same way the assist-target focus effect already does —
  // same `open` state, same mobile guard (auto-open collides with the OS keyboard there). Tracked
  // per-pathname in localStorage so it survives reload/close and never re-fires on a repeat visit.
  useEffect(() => {
    const key = `concierge-seen:${location.pathname}`;
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, '1');
    const mq = window.matchMedia('(max-width:760px)');
    if (!mq.matches) setOpen(true);
  }, [location.pathname]);

  function gen() {
    if (!target) return;
    const text = buildPrompt(target.flowId, brief);
    if (text) setDraft(text);
  }
  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {});
  }

  // The idle branch's round trip through the real colloquia endpoint (Step 7).
  async function idleSend() {
    const v = idleMsg.trim();
    if (!v || idleSending) return;
    const priorRunId = idleCritiqueOf;
    setIdleCritiqueOf(undefined);
    setIdleSending(true);
    let createdThread = false;
    try {
      let cid = idleColloquiumId;
      if (!cid) {
        // Stamp the active project (noema-111) so the dock thread groups in history.
        const { colloquium } = await api.createColloquium(project ? { projectId: project.id } : {});
        cid = colloquium.id;
        setIdleColloquiumId(cid);
        createdThread = true;
      }
      const { result } = await api.postDictum(cid, {
        turnKey: newTurnKey(),
        message: v,
        ...(priorRunId ? { priorRunId } : {}),
      });
      setIdleResult(result);
      setIdleMsg('');
      if (createdThread) void refreshThreads();
    } catch (e) {
      setIdleResult({ kind: 'reply', text: e instanceof Error ? e.message : String(e), tokenUsage: { totalTokens: 0 } });
    } finally {
      setIdleSending(false);
    }
  }
  // ProposalCard's "adjust" affordance: pre-focus this panel's input and tag the
  // next idleSend() as a critique turn referencing the proposal's run (Q3/Step 6).
  function idleAdjust(priorRunId: string | undefined) {
    setIdleCritiqueOf(priorRunId);
    idleRef.current?.focus();
  }

  return (
    <div className={`concierge${hasContext ? ' has-context' : ''}${open ? ' open' : ''}${target ? ' assist' : ''}`}>
      <div className="cpanel">
        <div className="chead">
          <span className="orb" /><b>Concierge</b>
          {target && <span className="ctxtag">{target.flowName} · {target.fieldLabel}</span>}
          <span className="x" onClick={() => { setOpen(false); clear(); }}><Ic name="x" /></span>
        </div>

        {target ? (
          <div className="cassist">
            {target.hint && <div className="chint">{target.hint}</div>}
            <div className="ex">
              <div className="extext">{target.example}</div>
              <div className="exact">
                <button onClick={() => target.apply(target.example)}>Use this</button>
                <button className="ghost" onClick={() => copy(target.example)}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
            </div>

            {draft && (
              <div className="ex draft">
                <div className="extext">{draft}</div>
                <div className="exact"><button onClick={() => target.apply(draft)}>Insert</button></div>
              </div>
            )}

            <div className="cinput">
              <input
                value={brief}
                placeholder={`tell me the vibe — I’ll write the ${target.fieldLabel}…`}
                onChange={(e) => setBrief(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') gen(); }}
              />
              <button onClick={gen}><Ic name="arrow-up" /></button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <div className="cbody" style={{ flex: 1, margin: 0 }}>Tell me what to make or change. I’ll pick the tool and run it.</div>
              <button
                style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '5px', border: '1px solid var(--line, #2a2f3a)', background: 'transparent', color: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap' }}
                onClick={() => { const next = !histOpen; setHistOpen(next); if (next) void refreshThreads(); }}
              >
                {histOpen ? 'Close' : '☰ Recent'}
              </button>
            </div>

            {histOpen && (
              <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid var(--line, #2a2f3a)', borderRadius: '8px', padding: '4px', marginBottom: '8px' }}>
                <button
                  style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: '12px', padding: '6px 8px', borderRadius: '6px', border: 'none', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
                  onClick={startNewDock}
                >+ New conversation</button>
                {threads.length === 0 && <div style={{ opacity: 0.6, fontSize: '12px', padding: '6px 8px' }}>No conversations yet.</div>}
                {groupDockThreads(threads, projectNameOf).map((g) => (
                  <div key={g.key}>
                    <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.55, padding: '6px 8px 2px' }}>{g.name}</div>
                    {g.threads.map((t) => (
                      <button
                        key={t.id}
                        style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: '12px', padding: '5px 8px', borderRadius: '6px', border: 'none', background: t.id === idleColloquiumId ? 'var(--hover, rgba(255,255,255,0.06))' : 'transparent', color: 'inherit', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                        onClick={() => void resumeDock(t.id)}
                      >{t.titulus || t.preview || 'Untitled'}</button>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {idleResult && (
              idleResult.kind === 'proposal'
                ? <ProposalCard proposal={idleResult} onAdjust={idleAdjust} />
                : <div className="ex"><div className="extext">{idleResult.text}</div></div>
            )}

            {idleSending && (
              <div className="stage"><span className="dots"><span /><span /><span /></span> thinking…</div>
            )}

            <div className="cinput">
              <input
                ref={idleRef}
                value={idleMsg}
                placeholder="make · adjust · explain…"
                onChange={(e) => setIdleMsg(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void idleSend(); }}
              />
              <button disabled={idleSending} onClick={() => void idleSend()}><Ic name="arrow-up" /></button>
            </div>
          </>
        )}
      </div>
      <div className="cbtn" onClick={() => setOpen((o) => !o)}>
        <span className="orb" />
        <span className="lab">Concierge<small>{target ? `help with the ${target.fieldLabel}` : 'make · adjust · explain'}</small></span>
      </div>
    </div>
  );
}
