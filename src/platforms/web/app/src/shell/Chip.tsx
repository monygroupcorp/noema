import { Ic } from '../lib/icons';
import type { Ident } from '../lib/idents';

// identity chip: named = letter avatar · anon = venetian-mask · tee = eye-off (blindness, not a shield)
export function Chip({ d }: { d: Ident }) {
  if (d.chipCls === 'named')
    return <span className="chip named" style={{ background: d.chipColor }}>{d.glyph}</span>;
  const name = d.chipCls === 'masked' ? 'venetian-mask' : 'eye-off';
  return (
    <span className={`chip ${d.chipCls}`}>
      <Ic name={name} />
    </span>
  );
}
