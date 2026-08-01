import { useEffect, useRef, useState } from 'react';
import { Ic } from '../lib/icons';
import { useAssistTarget, usePromptAssist } from '../state/promptAssist';
import { buildPrompt } from '../lib/promptExamples';
import { api, newTurnKey, type ConciergeResult } from '../lib/api';
import { ProposalCard } from '../components/ProposalCard';

// Chat collapses into this on every screen except full chat (utilitarian co-pilot).
// When a form's prompt field is focused it slides open with tailored augmentation:
// a copyable example, and a "write it for me" draft from the user's brief.
export function Concierge({ hasContext }: { hasContext: boolean }) {
  const target = useAssistTarget();
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
    try {
      let cid = idleColloquiumId;
      if (!cid) {
        const { colloquium } = await api.createColloquium();
        cid = colloquium.id;
        setIdleColloquiumId(cid);
      }
      const { result } = await api.postDictum(cid, {
        turnKey: newTurnKey(),
        message: v,
        ...(priorRunId ? { priorRunId } : {}),
      });
      setIdleResult(result);
      setIdleMsg('');
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
            <div className="cbody">Tell me what to make or change. I’ll pick the tool and run it.</div>

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
