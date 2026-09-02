import { Wordmark } from '../ui/Wordmark';
import './landing-wordmark.css';

/**
 * The marketing surface's lockup.
 *
 * `ui/Wordmark.tsx` is vendored from the design module and says in its own header not to
 * hand-edit its design intent, so this does not touch it: it renders the canonical hemisphere
 * as the `symbol` variant and sets the word beside it. The mark stays the mark; only the
 * typesetting of the name is the page's to choose.
 *
 * `mono` is the shipped lockup — Martian Mono, uppercase, letterspaced: the engineered register.
 * `serif` sets the name in the page's own display face, so the wordmark and the voice under it
 * are one argument rather than two.
 */
export function LandingWordmark({ face = 'serif', height = 26 }: { face?: 'mono' | 'serif'; height?: number }) {
  if (face === 'mono') return <Wordmark height={height - 4} />;
  return (
    <span className="lp-lw" style={{ '--lw-h': `${height}px` } as React.CSSProperties}>
      <Wordmark variant="symbol" height={height} aria-hidden="true" />
      <span className="lp-lw-name">noema</span>
    </span>
  );
}
