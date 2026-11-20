import { type Fragment } from '../../lib/api';
import { categoryColor, isLocked, type LockSet } from '../../lib/muse';

/** A roll's fragments, each one a lock toggle. Locking IS the dialing-in: a pinned
 *  fragment survives every subsequent vary and everything else re-samples, so a
 *  setting and a palette that are working can be held while pose and props keep
 *  pulling. A lock is per CATEGORY, so pinning a second fragment of a category
 *  replaces the first rather than putting two of it in one prompt. */
export function RollFragments({ fragments, locks, lock }: {
  fragments: readonly Fragment[];
  locks: LockSet;
  lock: (fragment: Fragment) => void;
}) {
  return (
    <div className="muse-roll-frags mono">
      {fragments.map((f, j) => {
        const on = isLocked(locks, f);
        return (
          <button
            key={`${f.category}-${j}`}
            type="button"
            className={`muse-roll-frag${on ? ' locked' : ''}`}
            style={{ borderColor: categoryColor(f.category) }}
            aria-pressed={on}
            title={on
              ? `[${f.category}] is locked — it survives every vary. Click to unlock.`
              : `lock [${f.category}] so the next vary keeps it`}
            onClick={() => lock(f)}
          >
            [{f.category}] {f.text}{f.trigger ? ` <- ${f.trigger}` : ''}
          </button>
        );
      })}
    </div>
  );
}
