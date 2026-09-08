import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  type ConciergeWrite,
  type ConciergeWriteAction,
  type CreateDatasetRequest,
  type Generatio,
  type Tractus,
} from '../lib/api';

// ── WriteProposalCard — the author ladder's one card (concierge-author-ladder) ─
//
// The concierge PROPOSES a write; this card is where a person confirms it. Three things are
// load-bearing and none of them are decoration:
//
//   1. It shows the WHOLE payload. Every key the agent sent gets a row — no summary stands in
//      for a field, and nothing is applied that was not on screen.
//   2. It is AMENDABLE. Scalars get a typed input; a list or nested object (a trait grid, a set
//      of run ids) gets a JSON editor, and a payload that no longer parses disables GO rather
//      than sending something the card is no longer showing.
//   3. GO calls the SAME api.* method the corresponding screen already calls — createDataset,
//      patchCollectionDraft, setGeneratio. There is no concierge write endpoint, and the write
//      happens in the user's own session, on the user's own click, exactly once per card.
//
// An action outside the three never reaches here: the agent-side allowlist
// (`validateWriteProposal`) drops it and only the reply text arrives.

const ACTION_LABEL: Record<ConciergeWriteAction, string> = {
  create_dataset: 'Create a dataset',
  patch_collection_draft: 'Update a collection draft',
  set_preference: 'Change a preference',
};

const ACTION_NOTE: Record<ConciergeWriteAction, string> = {
  create_dataset: 'Mints a new dataset from runs you already made. Nothing is generated and nothing is charged.',
  patch_collection_draft: 'Edits a DRAFT collection. It is not fired — you still start it yourself from the collection screen.',
  set_preference: 'Saves one default on your account. It applies to future runs, never to past ones.',
};

/** Payload fields that name WHICH thing is being written, rather than what it is being written to.
 *  They are shown — the card shows the whole payload — but not editable, because amending one turns
 *  the card into something other than the proposal the allowlist passed: retyping `set_preference`'s
 *  `key` would make it a general-purpose settings editor reachable from chat, and retyping
 *  `create_dataset`'s `source` would send the very shape (`upload`) the grammar refuses. Amendment
 *  belongs on the VALUES, which is where a person actually wants to correct the agent. */
const LOCKED_KEYS: Record<ConciergeWriteAction, readonly string[]> = {
  create_dataset: ['source'],
  patch_collection_draft: ['id'],
  set_preference: ['key'],
};

/** Rows the card renders: a scalar gets a typed input, anything else a JSON editor. Derived from
 *  the payload's own keys, so a field the agent sent can never be silently dropped. */
type Row = { key: string; kind: 'string' | 'number' | 'boolean' | 'json'; locked: boolean };

function rowsOf(action: ConciergeWriteAction, payload: Record<string, unknown>): Row[] {
  const locked = LOCKED_KEYS[action];
  return Object.keys(payload).map((key) => {
    const v = payload[key];
    const base = { key, locked: locked.includes(key) };
    if (typeof v === 'string') return { ...base, kind: 'string' as const };
    if (typeof v === 'number') return { ...base, kind: 'number' as const };
    if (typeof v === 'boolean') return { ...base, kind: 'boolean' as const };
    return { ...base, kind: 'json' as const };
  });
}

export function WriteProposalCard({ write, onDone }: {
  write: ConciergeWrite;
  /** Called once the write lands, with a short line the thread can show. */
  onDone?: (summary: string) => void;
}) {
  const rows = useMemo(() => rowsOf(write.action, write.payload), [write.action, write.payload]);
  // Scalars live as their own value; non-scalars live as the JSON TEXT the user is editing, so a
  // half-typed edit stays on screen instead of being reverted by a failed parse.
  const [values, setValues] = useState<Record<string, unknown>>(() => ({ ...write.payload }));
  const [json, setJson] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const r of rows) if (r.kind === 'json') out[r.key] = JSON.stringify(write.payload[r.key], null, 2);
    return out;
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | undefined>();
  const [done, setDone] = useState<string | undefined>();

  // Which JSON rows currently fail to parse — GO stays disabled while any does.
  const badJson = rows
    .filter((r) => r.kind === 'json')
    .filter((r) => { try { JSON.parse(json[r.key] ?? ''); return false; } catch { return true; } })
    .map((r) => r.key);

  /** The payload as amended — exactly what GO sends, assembled from what is on screen. */
  function amended(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const r of rows) out[r.key] = r.kind === 'json' ? JSON.parse(json[r.key] ?? 'null') : values[r.key];
    return out;
  }

  async function go() {
    setErr(undefined);
    setBusy(true);
    try {
      const p = amended();
      let summary: string;
      switch (write.action) {
        case 'create_dataset': {
          const { dataset } = await api.createDataset(p as unknown as CreateDatasetRequest);
          summary = `Created the dataset “${dataset.name}”.`;
          break;
        }
        case 'patch_collection_draft': {
          const { id, ...patch } = p as { id: string } & { modusId?: string; numerus?: number; tractus?: Tractus[] };
          const { collection } = await api.patchCollectionDraft(String(id), patch);
          summary = `Updated the draft “${collection.nomen ?? collection.id}”.`;
          break;
        }
        case 'set_preference': {
          // A whole-record PUT: read the current generatio first so saving one key never wipes
          // the rest (the same reason Preferences.tsx commits the full object).
          const me = await api.getMe();
          const key = String((p as { key: unknown }).key) as keyof Generatio;
          const next = { ...(me.generatio ?? {}), [key]: (p as { value: unknown }).value } as Generatio;
          await api.setGeneratio(next);
          summary = `Saved ${String(key)}.`;
          break;
        }
      }
      setDone(summary);
      onDone?.(summary);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="write-card">
      <div className="wc-head">
        <span className="wc-action">{ACTION_LABEL[write.action]}</span>
        <span className="wc-kind">proposed · needs your GO</span>
      </div>
      <div className="wc-note">{ACTION_NOTE[write.action]}</div>

      <div className="wc-fields">
        {rows.map((r) => (
          <label key={r.key} className="wc-field">
            <span className="wc-key">{r.key}{r.locked && <span className="wc-locked"> · fixed</span>}</span>
            {r.kind === 'json' ? (
              <textarea
                className="ta2 wc-json"
                rows={Math.min(10, (json[r.key] ?? '').split('\n').length + 1)}
                value={json[r.key] ?? ''}
                disabled={done !== undefined || r.locked}
                onChange={(e) => setJson((j) => ({ ...j, [r.key]: e.target.value }))}
              />
            ) : r.kind === 'boolean' ? (
              <input
                type="checkbox"
                checked={values[r.key] === true}
                disabled={done !== undefined || r.locked}
                onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.checked }))}
              />
            ) : (
              <input
                className="cer-input"
                type={r.kind === 'number' ? 'number' : 'text'}
                value={String(values[r.key] ?? '')}
                readOnly={r.locked}
                disabled={done !== undefined}
                onChange={(e) =>
                  setValues((v) => ({
                    ...v,
                    [r.key]: r.kind === 'number' ? Number(e.target.value) : e.target.value,
                  }))
                }
              />
            )}
          </label>
        ))}
      </div>

      {badJson.length > 0 && (
        <div className="wc-err">{badJson.join(', ')} {badJson.length === 1 ? 'is' : 'are'} not valid JSON yet.</div>
      )}
      {err && <div className="wc-err">{err}</div>}

      {done ? (
        <div className="wc-done">
          <span>✓ {done}</span>
          {write.action === 'set_preference' && <Link to="/preferences">open preferences →</Link>}
        </div>
      ) : (
        <div className="wc-foot">
          <button className="wc-go" disabled={busy || badJson.length > 0} onClick={go}>
            {busy ? 'writing…' : 'GO'}
          </button>
        </div>
      )}

      <style>{`
        .write-card{border:1px solid var(--border,#333);border-radius:var(--radius,10px);padding:12px 14px;margin-top:6px;display:flex;flex-direction:column;gap:8px}
        .wc-head{display:flex;align-items:baseline;gap:8px}
        .wc-action{font-weight:600}
        .wc-kind{font-size:.75em;opacity:.55;text-transform:uppercase;letter-spacing:.04em}
        .wc-note{font-size:.85em;opacity:.7}
        .wc-fields{display:flex;flex-direction:column;gap:8px}
        .wc-field{display:flex;flex-direction:column;gap:3px}
        .wc-key{font-size:.75em;opacity:.6;font-family:monospace}
        .wc-locked{font-style:italic}
        .wc-field input[readonly]{opacity:.6;cursor:default}
        .wc-json{width:100%;resize:vertical;font-family:monospace;font-size:.82em}
        .wc-foot{display:flex;justify-content:flex-end}
        .wc-go{padding:6px 16px;border-radius:8px;font-weight:600}
        .wc-err{color:var(--error,#c33);font-size:.85em}
        .wc-done{font-size:.88em;display:flex;gap:10px;align-items:center;color:var(--good,#57c8a6)}
      `}</style>
    </div>
  );
}
