import { type MuseSteerProposal } from '../../lib/api';
import {
  categoryColor,
  droppedNote,
  proposalPills,
  writesForConfirm,
  type SheetPhase,
  type SteerPill,
} from '../../lib/muse';

/**
 * The consent sheet (S9) — what a steer proposed, awaiting a ruling.
 *
 * A DIFFERENT SURFACE FROM THE CUTTING FLOOR. The floor sheet is the standing state of the
 * session; this is a proposal about it, and nothing in it has been applied. Every pill is
 * vetoable by tapping, Cancel writes nothing at all, and Confirm is the only thing on this
 * screen that turns a steer into floor writes.
 *
 * Three things it says out loud, each because leaving it unsaid misleads:
 *
 *   HOW MANY SUGGESTIONS WERE DROPPED. The route counts them precisely; swallowing the
 *   count is how a user comes to believe they vetoed something never proposed to them.
 *
 *   THAT THE STREAM IS STILL RUNNING. Pieces already in flight are paid for and the loop
 *   is not held — a piece that lands from the old floor while this is open is correct, and
 *   the next draw after a confirmed write picks the new floor up on its own.
 *
 *   WHAT DID NOT LAND. A confirm that fails part-way keeps what landed and names the rest.
 *
 * It renders no provenance for an addition: a confirmed addition is stored through the
 * floor-fragments route, which files it as a manual fragment, so a "proposed by a steer"
 * label here would claim something the floor does not carry.
 */
export function ConsentSheet({
  proposal, vetoed, phase, outcome, applying, onVeto, onConfirm, onClose,
}: {
  proposal: MuseSteerProposal;
  vetoed: ReadonlySet<string>;
  phase: SheetPhase;
  outcome: string | null;
  applying: boolean;
  onVeto: (key: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const pills = proposalPills(proposal);
  const dropped = droppedNote(proposal.dropped);
  const surviving = writesForConfirm(proposal, vetoed, 'confirmed').length;
  return (
    <div className="muse-sheet muse-consent" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="muse-sheet-card" onClick={(e) => e.stopPropagation()}>
        <div className="muse-sheet-head">
          <span className="gc-l">proposed changes</span>
          <span className="gt-sub mono">
            {phase === 'confirmed'
              ? 'applied'
              : 'tap a pill to reject it · nothing moves until you confirm'}
          </span>
          <button type="button" className="btn ghost sm muse-sheet-close" onClick={onClose}>Close</button>
        </div>

        {pills.length === 0 ? (
          <div className="gt-sub mono">this steer proposed no changes to your floor.</div>
        ) : (
          <div className="pref-chips muse-consent-pills">
            {pills.map((pill) => (
              <ConsentPill
                key={`${pill.kind}:${pill.key}`}
                pill={pill}
                vetoed={vetoed.has(pill.key)}
                disabled={phase === 'confirmed' || applying}
                onVeto={onVeto}
              />
            ))}
          </div>
        )}

        {dropped && <div className="gt-sub mono muse-consent-dropped">{dropped}</div>}

        {phase === 'confirmed' ? (
          <div className="gt-sub mono muse-consent-outcome">{outcome}</div>
        ) : (
          <>
            <div className="muse-consent-foot">
              <button type="button" className="btn ghost sm" disabled={applying} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn accent sm" disabled={applying} onClick={onConfirm}>
                {applying ? 'applying…' : `Confirm ${surviving} ${surviving === 1 ? 'change' : 'changes'}`}
              </button>
            </div>
            <div className="gt-sub mono">
              Cancel writes nothing. An elimination turns a fragment off and leaves it on the cutting
              floor, where tapping it brings it back. The stream keeps running while this is open —
              pieces already on their way were drawn from the floor as it stands.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One proposed change. A vetoed pill is struck through and stays visible: "what did I say
 *  no to" has to be answerable without closing the sheet, and a veto is reversible until
 *  the confirm. */
function ConsentPill({
  pill, vetoed, disabled, onVeto,
}: {
  pill: SteerPill;
  vetoed: boolean;
  disabled: boolean;
  onVeto: (key: string) => void;
}) {
  return (
    <button
      type="button"
      className={`fchip muse-consent-pill ${pill.kind}${vetoed ? ' vetoed' : ''}`}
      disabled={disabled}
      title={vetoed
        ? 'rejected — tap to put it back in'
        : (pill.kind === 'elimination'
          ? 'turns this fragment off — tap to reject the change'
          : 'puts this fragment on the floor — tap to reject the change')}
      onClick={() => onVeto(pill.key)}
    >
      <span style={{ background: categoryColor(pill.category), width: 8, height: 8, borderRadius: 2, display: 'inline-block', marginRight: 6 }} />
      <span className="muse-consent-verb">{pill.kind === 'elimination' ? 'off' : 'add'}</span>
      {' '}{pill.text}
    </button>
  );
}
