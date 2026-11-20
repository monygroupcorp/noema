import { useLayoutEffect, useRef, useState } from 'react';
import { streamColumns } from '../../lib/muse';

/** The stream grid's column count and its freeze test, both read off the grid element
 *  on scroll and resize and re-read whenever the number of tiles changes. */
export function useStreamGrid(pieceCount: number) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [columns, setColumns] = useState(streamColumns(0));
  // The freeze test, read at fire time rather than at render time: a piece may arrive
  // from a run that finished while the user was scrolled deep into the grid.
  const frozenRef = useRef(false);
  const [frozen, setFrozen] = useState(false);

  // Frozen = the head of the grid has scrolled off the top of the viewport, i.e. the
  // user is looking at older tiles. Inserting at the top then would move the tile under
  // their thumb, and every tile gesture here is a steer (V8b).
  useLayoutEffect(() => {
    const read = () => {
      const el = gridRef.current;
      if (el) setColumns(streamColumns(el.clientWidth));
      const away = !!el && el.getBoundingClientRect().top < 0;
      frozenRef.current = away;
      setFrozen(away);
    };
    read();
    window.addEventListener('scroll', read, { passive: true });
    window.addEventListener('resize', read);
    return () => {
      window.removeEventListener('scroll', read);
      window.removeEventListener('resize', read);
    };
  }, [pieceCount]);

  return { gridRef, columns, frozenRef, frozen };
}
