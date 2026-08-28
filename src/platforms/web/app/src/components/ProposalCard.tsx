import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type ConciergeProposal, type FlowDescription, type ModelCard } from '../lib/api';
import { STAGE_LABELS, measure, useRunStream } from '../lib/runStream';
import { mediaFromOutput } from '../lib/media';
import { formatQuote } from '../lib/format';
import { Lightbox } from './Lightbox';

// ── ProposalCard — renders one concierge `ConciergeProposal` (noema-099) ──────
// The chosen flow + editable embellished prompt (trigger-word-highlighted, same
// pattern as Card.tsx's HighlightedPromptField/lora-trigger-hit, noema-061) + the
// chosen models + the authoritative quote + a GO button that reaches the SAME
// createRun -> useRunStream path every other run-launching surface uses (Card.tsx
// doRun(), ~lines 315-331) + an inline "adjust" affordance for a follow-up
// critique turn. Functional bar, not the impeccable-CLI visual pass (Decision
// record, noema-099).

// The SAME heuristic Card.tsx uses (line 463) to find "the" long prompt-shaped
// field in a flow's aditus — reused here (not re-derived) so the editable field
// in the proposal card is the exact field the run will actually be dispatched
// with, not a guess at a fixed key name (flows don't share one).
const PROMPT_KEY_RE = /prompt|lyric|story|description|caption|text|message|content/i;

function findPromptKey(aditus: Record<string, unknown>): string | undefined {
  return Object.keys(aditus).find((k) => typeof aditus[k] === 'string' && PROMPT_KEY_RE.test(k));
}

// ── Trigger-word highlight (noema-061 pattern, reused per Decision record Q1;
// reference: Card.tsx lines 85/110/396) — scoped to just this proposal's chosen
// pinnedModels, not the whole catalog. ─────────────────────────────────────────
function buildTriggerRegex(triggers: string[]): RegExp | null {
  if (triggers.length === 0) return null;
  const escaped = triggers.slice().sort((a, b) => b.length - a.length)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi');
}

type HitSeg = { text: string; hit?: ModelCard };

function splitTriggerHits(text: string, loraMap: Map<string, ModelCard>, re: RegExp | null): HitSeg[] {
  if (!re || !text) return [{ text }];
  const segs: HitSeg[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segs.push({ text: text.slice(last, m.index) });
    segs.push({ text: m[0], hit: loraMap.get(m[0].toLowerCase()) });
    last = m.index + m[0].length;
    if (m[0].length === 0) re.lastIndex += 1;
  }
  if (last < text.length) segs.push({ text: text.slice(last) });
  return segs;
}

function TriggerHitSpan({ text, hit }: { text: string; hit: ModelCard }) {
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setAnchor({ left: r.left, bottom: window.innerHeight - r.top + 6 });
  };
  const close = () => setAnchor(null);
  return (
    <span className="lora-trigger-hit" tabIndex={0} ref={ref}
      onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close}>
      {text}
      {anchor && createPortal(
        <span className="lora-trigger-card" role="tooltip" style={{ left: anchor.left, bottom: anchor.bottom }}>
          <strong>{hit.nomen}</strong>
          {hit.trigger && <span className="ltc-trigger">{hit.trigger}</span>}
          {hit.description && <p>{hit.description}</p>}
          <span className="ltc-meta">{hit.access ?? 'public'} · {hit.license ?? 'unknown license'}</span>
        </span>,
        document.body,
      )}
    </span>
  );
}

function HighlightedField({ value, onChange, loraMap, triggerRe }: {
  value: string; onChange: (v: string) => void; loraMap: Map<string, ModelCard>; triggerRe: RegExp | null;
}) {
  const segs = useMemo(() => splitTriggerHits(value, loraMap, triggerRe), [value, loraMap, triggerRe]);
  return (
    <div className="lora-trigger-wrap pc-prompt-wrap">
      <div className="lora-trigger-overlay" aria-hidden="true">
        {segs.map((s, i) => (s.hit ? <TriggerHitSpan key={i} text={s.text} hit={s.hit} /> : <span key={i}>{s.text}</span>))}
        {'​'}
      </div>
      <textarea className="ta2 lora-trigger-ta pc-prompt-ta" value={value} onChange={(e) => onChange(e.target.value)} rows={3} />
    </div>
  );
}

export interface ProposalGoRequest { modusId?: string; verb?: string; aditus: Record<string, unknown>; pinnedModels: string[] }

export function ProposalCard({ proposal, onAdjust }: {
  proposal: ConciergeProposal;
  /** Pre-focuses the chat input for a critique turn; passed this card's runId
   *  (once GO has launched one) so the follow-up `dicta` call can reference it. */
  onAdjust: (priorRunId: string | undefined) => void;
}) {
  const promptKey = useMemo(() => findPromptKey(proposal.aditus), [proposal.aditus]);
  const [aditus, setAditus] = useState<Record<string, unknown>>(proposal.aditus);
  const [promptValue, setPromptValue] = useState(
    promptKey ? String(proposal.aditus[promptKey] ?? '') : proposal.embellishedPrompt,
  );
  const [runId, setRunId] = useState<string | undefined>();
  const [dispatching, setDispatching] = useState(false);
  const [dispatchErr, setDispatchErr] = useState<string | undefined>();
  const [lightbox, setLightbox] = useState(false);
  const runStream = useRunStream(runId);

  function setPrompt(v: string) {
    setPromptValue(v);
    if (promptKey) setAditus((a) => ({ ...a, [promptKey]: v }));
  }

  // Model-card lookup for the trigger-word highlight, scoped to pinnedModels
  // (same source/endpoint as Card.tsx: listModelsByBasis(flow.familia), noema-061).
  const [loraMap, setLoraMap] = useState<Map<string, ModelCard>>(new Map());
  useEffect(() => {
    if (!proposal.modusId || proposal.pinnedModels.length === 0) { setLoraMap(new Map()); return; }
    let live = true;
    api.getFlow(proposal.modusId)
      .then((flow: FlowDescription) => {
        if (!live || !flow.familia) return;
        return api.listModelsByBasis(flow.familia);
      })
      .then((r) => {
        if (!live || !r) return;
        // pinnedModels holds "intellaId or slug" (ConciergeProposal doc) — match either.
        const pinned = new Set(proposal.pinnedModels);
        const map = new Map<string, ModelCard>();
        for (const m of r.models ?? []) {
          if (m.trigger && (pinned.has(m.intellaId) || (m.slug && pinned.has(m.slug)))) map.set(m.trigger.toLowerCase(), m);
        }
        setLoraMap(map);
      })
      .catch(() => { if (live) setLoraMap(new Map()); });
    return () => { live = false; };
  }, [proposal.modusId, proposal.pinnedModels]);
  const triggerRe = useMemo(() => buildTriggerRegex(Array.from(loraMap.keys())), [loraMap]);

  // GO — the same createRun -> capture runId -> useRunStream(runId) shape as
  // Card.tsx's doRun() (~lines 315-331); no new call surface, no altered signature.
  async function go() {
    setDispatchErr(undefined);
    setRunId(undefined);
    setDispatching(true);
    try {
      const { run } = await api.createRun({
        ...(proposal.modusId ? { modusId: proposal.modusId } : {}),
        ...(proposal.verb ? { verb: proposal.verb } : {}),
        aditus,
        pinnedModels: proposal.pinnedModels,
      });
      setRunId(run.id);
    } catch (e) {
      setDispatchErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDispatching(false);
    }
  }

  const flowLabel = proposal.modusId ?? proposal.verb ?? '—';
  const media = mediaFromOutput(runStream.exitus);
  const { amount: quoteAmount, recipientShort } = formatQuote(proposal.quote);

  return (
    <div className="proposal-card">
      <div className="pc-head">
        <span className="pc-flow">{flowLabel}</span>
        {proposal.delta && <span className="pc-delta">adjusted · {proposal.delta}</span>}
      </div>
      {proposal.rationale && <div className="pc-rationale">{proposal.rationale}</div>}

      <div className="pc-field">
        <label>prompt <span className="opt">editable</span></label>
        <HighlightedField value={promptValue} onChange={setPrompt} loraMap={loraMap} triggerRe={triggerRe} />
      </div>

      {proposal.pinnedModels.length > 0 && (
        <div className="pc-models">
          {proposal.pinnedModels.map((m) => <span key={m} className="pc-model-chip">{m}</span>)}
        </div>
      )}

      <div className="pc-foot">
        <div className="pc-quote-block">
          <span className="pc-quote">~{quoteAmount}</span>
          <span className="pc-recipient" title={proposal.quote.recipient}>
            <span className="pc-recipient-label">recipient</span> {recipientShort}
          </span>
        </div>
        <button className="ghost pc-adjust" onClick={() => onAdjust(runId)}>adjust</button>
        <button className="pc-go" disabled={dispatching} onClick={go}>{dispatching ? 'dispatching…' : 'GO'}</button>
      </div>

      {dispatchErr && <div className="pc-err">{dispatchErr}</div>}
      {runId && (
        <div className="pc-run">
          <span>{runStream.terminal ?? 'running…'}</span>
          {runStream.terminal !== 'complete' && (
            <span>
              {' '}· {STAGE_LABELS[runStream.stageIdx]} {measure(runStream.progressus)}
              {!runStream.terminal && ` · ${runStream.elapsedSec}s elapsed`}
            </span>
          )}
          <Link to={`/run?id=${runId}`}>open run view →</Link>
          {runStream.terminal === 'failed' && runStream.charged !== undefined && (
            <span> · charged {runStream.charged} credits</span>
          )}
          {runStream.terminal === 'complete' && media?.kind === 'image' && (
            <img
              src={media.url}
              alt=""
              className="rimg-clickable"
              onClick={() => setLightbox(true)}
            />
          )}
        </div>
      )}
      {lightbox && media?.kind === 'image' && (
        <Lightbox src={media.url} onClose={() => setLightbox(false)} />
      )}

      <style>{`
        .proposal-card{border:1px solid var(--border,#333);border-radius:var(--radius,10px);padding:12px 14px;margin-top:6px;display:flex;flex-direction:column;gap:8px}
        .pc-head{display:flex;align-items:center;gap:8px;font-weight:600}
        .pc-delta{font-weight:400;font-size:.85em;opacity:.7}
        .pc-rationale{font-size:.9em;opacity:.75}
        .pc-field label{display:block;font-size:.8em;opacity:.7;margin-bottom:4px}
        .pc-prompt-wrap{position:relative}
        .pc-prompt-ta{width:100%;resize:vertical}
        .pc-models{display:flex;flex-wrap:wrap;gap:6px}
        .pc-model-chip{font-size:.78em;padding:2px 8px;border-radius:999px;background:color-mix(in srgb,var(--accent,#888) 15%,transparent)}
        .pc-foot{display:flex;align-items:center;gap:10px;margin-top:2px}
        .pc-quote-block{display:flex;flex-direction:column;gap:1px;margin-right:auto}
        .pc-quote{font-size:.85em;opacity:.75}
        .pc-recipient{font-size:.7em;opacity:.5;display:flex;gap:4px;align-items:center}
        .pc-recipient-label{text-transform:uppercase;letter-spacing:.03em}
        .pc-go{padding:6px 16px;border-radius:8px;font-weight:600}
        .pc-err{color:var(--error,#c33);font-size:.85em}
        .pc-run{font-size:.85em;opacity:.85;display:flex;gap:8px;align-items:center}
        .rimg-clickable{max-width:100%;max-height:280px;object-fit:contain;border-radius:var(--radius,10px);display:block;cursor:pointer}

        .lora-trigger-overlay{position:absolute;inset:0;padding:9px 11px;border:1px solid transparent;
          pointer-events:none;white-space:pre-wrap;word-wrap:break-word;overflow:hidden;color:transparent}
        .lora-trigger-hit{position:relative;background:color-mix(in srgb,var(--accent) 35%,transparent);
          border-radius:3px;pointer-events:auto;color:transparent}
        .lora-trigger-card{position:fixed;z-index:var(--z-pop,60);background:var(--bg-2,#1a1a1a);
          border:1px solid var(--border,#333);border-radius:8px;padding:8px 10px;max-width:260px;font-size:.85em;
          box-shadow:0 10px 30px rgba(0,0,0,.4)}
        .lora-trigger-card strong{display:block;margin-bottom:2px}
        .lora-trigger-card .ltc-trigger{display:inline-block;font-family:monospace;opacity:.75;margin-bottom:4px}
        .lora-trigger-card p{margin:4px 0;opacity:.85}
        .lora-trigger-card .ltc-meta{display:block;margin-top:4px;opacity:.6;text-transform:capitalize}
      `}</style>
    </div>
  );
}
