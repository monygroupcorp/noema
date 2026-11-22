import { type Dispatch, type SetStateAction } from 'react';
import {
  chooseLora,
  loraCatalog,
  loraCatalogReason,
  LORA_WEIGHT_MAX,
  LORA_WEIGHT_MIN,
  type LoraChoice,
} from '../../lib/muse';

/** The model picker's body: the catalog scoped to the flow's base, the stack under review
 *  with a weight field per entry, and the commit and cancel actions. Muse renders it
 *  inline on a wide viewport and inside the pull-up sheet on a phone. */
export function LoraPanel({
  loraReason, loraOffer, draft, setDraft, familia, catalogLoading, catalogError,
  weightText, setWeightText, streamLive, commitLora, cancelLora,
}: {
  loraReason: ReturnType<typeof loraCatalogReason>;
  loraOffer: ReturnType<typeof loraCatalog>;
  draft: LoraChoice[];
  setDraft: Dispatch<SetStateAction<LoraChoice[]>>;
  familia: string | null;
  catalogLoading: boolean;
  catalogError: string | null;
  weightText: Record<string, string>;
  setWeightText: Dispatch<SetStateAction<Record<string, string>>>;
  streamLive: boolean;
  commitLora: () => void;
  cancelLora: () => void;
}) {
  return (
    <>
      {loraReason ? (
        <div className="gt-sub mono">{loraReason}</div>
      ) : (
        <ul className="muse-lora-list">
          {loraOffer.map((card) => (
            <li key={card.intellaId}>
              <button
                type="button"
                className={`muse-lora-card${draft.some((c) => c.intellaId === card.intellaId) ? ' on' : ''}`}
                onClick={() => setDraft((d) => chooseLora(d, card, familia))}
              >
                <span className="muse-lora-name">{card.nomen}</span>
                {/* The trigger word is shown on every card and again on the
                    chosen one: it is the part a user has to see to trust that
                    the model is reaching the prompt at all. */}
                <span className="muse-lora-trigger mono">trigger {card.trigger}</span>
                {card.access === 'private' && <span className="muse-lora-own mono">yours</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {catalogLoading && <div className="gt-sub mono">Reading the catalogue…</div>}
      {catalogError && <div className="gt-sub mono">{catalogError}</div>}

      {/* THE STACK, in the order it fires, and each entry with its OWN weight field: a
          control where one number moved another would be spending the user's money on a
          model they did not mean to change. An empty field is "its own default". */}
      {draft.length > 0 && (
        <ul className="muse-lora-stack">
          {draft.map((entry, i) => (
            <li key={entry.intellaId} className="muse-lora-stacked">
              <span className="muse-lora-ord mono">{i + 1}</span>
              <span className="muse-lora-name">{entry.nomen}</span>
              <span className="muse-lora-trigger mono">trigger {entry.trigger}</span>
              <label className="cc-field muse-lora-weight">
                <span>Weight</span>
                <input
                  className="cer-input" type="number" inputMode="decimal"
                  min={LORA_WEIGHT_MIN} max={LORA_WEIGHT_MAX} step={0.05}
                  placeholder="its own default"
                  aria-label={`weight for ${entry.nomen}`}
                  value={weightText[entry.intellaId] ?? ''}
                  onChange={(e) => setWeightText((w) => ({ ...w, [entry.intellaId]: e.target.value }))}
                />
              </label>
              <button
                type="button"
                className="linkish muse-lora-drop"
                onClick={() => {
                  setDraft((d) => d.filter((c) => c.intellaId !== entry.intellaId));
                }}
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="gt-sub mono">
        Stack as many as the workflow's base takes — every one of them is pinned and every trigger word
        is written into the prompt. What stacking costs is time: a longer weight download before the
        first piece, and a longer diffusion on each one after it.
      </div>

      {streamLive && (
        <div className="gt-sub mono">
          the stream is holding while you choose — it resumes where it is, with the same count and
          the same cap.
        </div>
      )}

      <div className="muse-lora-actions">
        <button type="button" className="btn accent sm" onClick={commitLora}>
          {draft.length === 0
            ? 'fire without a model'
            : draft.length === 1 ? `use ${draft[0].nomen}` : `use these ${draft.length} models`}
        </button>
        <button type="button" className="btn ghost sm" onClick={cancelLora}>cancel</button>
      </div>
    </>
  );
}
