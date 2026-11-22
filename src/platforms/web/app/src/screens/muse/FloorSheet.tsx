import { useState } from 'react';
import { type FragmentCategory, type MuseSessionView } from '../../lib/api';
import {
  categoryColor,
  floorCounts,
  floorSheet,
  manualAddError,
  MANUAL_CATEGORIES,
  type FloorPill,
} from '../../lib/muse';

/**
 * The floor sheet (V1) — pulled up from the dock, the full-fidelity cutting floor.
 *
 * Every fragment the session holds, grouped by category in sampling order, with a
 * live/total count per category. A fragment a steer turned off is DARK AND STILL HERE,
 * and tapping it brings it back: "what did my steer turn off" is the question this sheet
 * exists to answer, and reversibility is why the pull-up sheet won over the cheaper
 * options. Weighted fragments carry their weight.
 *
 * The sheet renders from the session it is handed — the one the server returned — so it
 * shows the same floor after a reload as before it.
 */
export function FloorSheet({
  session, busyKey, onToggle, onAdd, adding, onClose,
}: {
  session: MuseSessionView;
  busyKey: string | null;
  onToggle: (pill: FloorPill) => void;
  onAdd: (category: FragmentCategory, text: string) => Promise<boolean>;
  adding: boolean;
  onClose: () => void;
}) {
  const rows = floorSheet(session);
  const { live, total } = floorCounts(session);
  const [addCategory, setAddCategory] = useState<FragmentCategory | ''>('');
  const [addText, setAddText] = useState('');
  const addError = manualAddError(session, addCategory, addText);
  // Silent until the user has said something — a form that opens already complaining
  // reads as broken. Once either field is touched, the reason is on screen rather than
  // hidden behind a disabled button.
  const showError = addCategory !== '' || addText.trim() !== '';

  async function submitAdd(e: { preventDefault: () => void }) {
    e.preventDefault();
    if (addError || addCategory === '' || adding) return;
    if (await onAdd(addCategory, addText)) setAddText('');
  }
  return (
    <div className="muse-sheet" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="muse-sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="muse-sheet-head">
          <span className="gc-l">cutting floor</span>
          <span className="gt-sub mono">{live}/{total} in the draw · tap a fragment to turn it off or back on</span>
          <button type="button" className="btn ghost sm muse-sheet-close" onClick={onClose}>Close</button>
        </div>
        {/* The free widening (noema-242): pick a category, write a fragment, and it lands
            on the floor in the draw. Nothing on this screen composes a phrase that is not
            already here, so this is the form that answers a floor too narrow to work with —
            and it costs nothing to use. */}
        <form className="muse-add" onSubmit={submitAdd}>
          <div className="muse-add-row">
            <select
              className="inp muse-add-cat"
              aria-label="fragment category"
              value={addCategory}
              onChange={(e) => setAddCategory(e.target.value as FragmentCategory | '')}
            >
              <option value="">category…</option>
              {MANUAL_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <input
              className="inp muse-add-text"
              aria-label="fragment text"
              placeholder="write a fragment — e.g. a short, prompt-ready phrase"
              value={addText}
              onChange={(e) => setAddText(e.target.value)}
            />
            <button type="submit" className="btn sm" disabled={!!addError || adding}>
              {adding ? 'adding…' : 'add to the floor'}
            </button>
          </div>
          <div className="gt-sub mono muse-add-note">
            {showError && addError ? addError : 'free — this reaches no model. it lands in the draw at even odds.'}
          </div>
        </form>
        {rows.length === 0 ? (
          <div className="gt-sub mono">this session's floor is empty.</div>
        ) : rows.map((row) => (
          <div key={row.category} className="muse-sheet-cat">
            <div className="muse-cat-row">
              <span className="gc-dot" style={{ background: categoryColor(row.category) }} /> {row.category}
              <span className="gc-n mono">{row.live}/{row.total}</span>
            </div>
            <div className="pref-chips muse-sheet-pills">
              {row.fragments.map((pill) => {
                const key = `${pill.category}:${pill.text}`;
                return (
                  <button
                    key={key}
                    type="button"
                    className={`fchip muse-floor-pill${pill.enabled ? ' on' : ' off'}`}
                    disabled={busyKey === key}
                    title={pill.enabled ? 'in the draw — tap to turn it off' : 'turned off — tap to bring it back'}
                    onClick={() => onToggle(pill)}
                  >
                    <span style={{ background: categoryColor(pill.category), width: 8, height: 8, borderRadius: 2, display: 'inline-block', marginRight: 6 }} />
                    {pill.text}
                    {pill.weight !== 1 && <span className="muse-floor-weight mono"> ×{pill.weight}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
