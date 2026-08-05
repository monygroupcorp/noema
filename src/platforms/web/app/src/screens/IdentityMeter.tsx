// Identity-axis hemisphere + meter pill — shared by Funding.tsx (the funding surface rows)
// and BuyCreditsModal (the wallet-rail checkout header). Lifted out of Funding.tsx per the
// buy-credits-modal design handoff's "Exists today: use as-is, lift into a shared module"
// note, so the two surfaces render one glyph, not two copies of it.
//
// Reads WHO we learn you are on a given rail — not what we see of the work:
//   nothing* = dashed ring (slate) · a pseudonym = plain ring (slate) · you = lit (gold).
export type Sees = 'nothing' | 'pseudonym' | 'you';

export function Hemisphere({ sees }: { sees: Sees }) {
  const lit = sees === 'you';
  const stroke = lit ? '#d9be8f' : '#7d8aa6';
  return (
    <svg className="fund-hemi" viewBox="0 0 24 24" aria-hidden="true">
      {lit && <path d="M12,2 A10 10 0 0 0 12,22 Z" fill="#d9be8f" />}
      <circle cx="12" cy="12" r="10" fill="none" stroke={stroke} strokeWidth="1.4"
        strokeDasharray={sees === 'nothing' ? '2.4 2.4' : undefined} />
    </svg>
  );
}

export function Meter({ sees, label }: { sees: Sees; label: string }) {
  return (
    <div className={`fund-meter sees-${sees}`}>
      <Hemisphere sees={sees} />
      <span className="fm-val">sees: {label}</span>
    </div>
  );
}
