import { useEffect, useState } from 'react';
import { MUSE_NARROW_VIEWPORT } from '../../lib/muse';

/**
 * Whether the viewport is the phone one (noema-264).
 *
 * The picker's CHROME changes with the width — inline panel wide, pull-up sheet narrow —
 * so the script has to switch on the same query the stylesheet does, and has to switch
 * back when the viewport changes under it (a rotation, a resized window). The query
 * string itself lives beside the rule it belongs to, in `lib/muse.ts`.
 */
export function useNarrowViewport(): boolean {
  const query = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(MUSE_NARROW_VIEWPORT)
      : null;
  const [narrow, setNarrow] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mq = query();
    if (!mq) return;
    const onChange = () => setNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return narrow;
}
