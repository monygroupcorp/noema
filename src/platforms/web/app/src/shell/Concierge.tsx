import { useEffect, useState } from 'react';
import { Ic } from '../lib/icons';
import { useAssistTarget } from '../state/promptAssist';
import { buildPrompt } from '../lib/promptExamples';

// Chat collapses into this on every screen except full chat (utilitarian co-pilot).
// When a form's prompt field is focused it slides open with tailored augmentation:
// a copyable example, and a "write it for me" draft from the user's brief.
export function Concierge({ hasContext }: { hasContext: boolean }) {
  const target = useAssistTarget();
  const [open, setOpen] = useState(false);
  const [brief, setBrief] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // A fresh target (new object on each field focus) slides the panel open and resets.
  useEffect(() => {
    setBrief(''); setDraft(null); setCopied(false);
    if (target) setOpen(true);
  }, [target]);

  function gen() {
    if (!target) return;
    const text = buildPrompt(target.flowId, brief);
    if (text) setDraft(text);
  }
  function copy(text: string) {
    navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {});
  }

  return (
    <div className={`concierge${hasContext ? ' has-context' : ''}${open ? ' open' : ''}${target ? ' assist' : ''}`}>
      <div className="cpanel">
        <div className="chead">
          <span className="orb" /><b>Concierge</b>
          {target && <span className="ctxtag">{target.flowName} · {target.fieldLabel}</span>}
          <span className="x" onClick={() => setOpen(false)}><Ic name="x" /></span>
        </div>

        {target ? (
          <div className="cassist">
            {target.hint && <div className="chint">{target.hint}</div>}
            <div className="ex">
              <div className="exlbl">try something like</div>
              <div className="extext">{target.example}</div>
              <div className="exact">
                <button onClick={() => target.apply(target.example)}>Use this</button>
                <button className="ghost" onClick={() => copy(target.example)}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
            </div>

            {draft && (
              <div className="ex draft">
                <div className="exlbl">Concierge draft</div>
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
            <div className="cinput">
              <input placeholder="make · adjust · explain…" />
              <button><Ic name="arrow-up" /></button>
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
