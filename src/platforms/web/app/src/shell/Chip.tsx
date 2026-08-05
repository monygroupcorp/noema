import { Ic } from '../lib/icons';
import { chipKind, type Ident } from '../lib/idents';

// identity chip — the WHO (funding axis) only: named = letter avatar · bearer = venetian-mask.
// Execution privacy (sealed / local) is a separate signal now, not baked into the avatar.
export function Chip({ d }: { d: Ident }) {
  if (chipKind(d) === 'named')
    return <span className="chip named" style={{ background: d.chipColor }}>{d.glyph}</span>;
  return (
    <span className="chip masked">
      <Ic name="venetian-mask" />
    </span>
  );
}
