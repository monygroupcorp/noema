import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useIdentity } from '../state/identity';
import { PRIV } from '../lib/idents';
import { Ic } from '../lib/icons';
import { Chip } from './Chip';

// The single trust source: identity control (top-left) + an expandable proof popover.
export function IdentityControl() {
  const { ident } = useIdentity();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const btnRef = useRef<HTMLButtonElement>(null);
  const pv = PRIV[ident.tier];

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: Math.max(12, r.left), top: r.bottom + 8 });
    setOpen((o) => !o);
  }

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      const t = e.target as Element;
      if (!t.closest('#trustpop') && !t.closest('.mebtn')) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  const name = ident.tier === 'anon' ? 'anonymous' : ident.name;

  return (
    <div className="me">
      <button className="mebtn" ref={btnRef} onClick={toggle}>
        <Chip d={ident} />
        <span className="nm">{name}</span>
        <span className="trust-mini"><Ic name={pv[0]} /> {pv[1]}</span>
        <span className="cv"><Ic name="chevron-down" /></span>
      </button>
      {open && (
        <div id="trustpop" className="open" style={pos}>
          <div className="tp-head">
            <Chip d={ident} />
            <div>
              <div className="nm">{name}</div>
              <div className="role">{ident.role}</div>
            </div>
          </div>
          <div className="tp-sec">
            <div className="tp-l">noema can see</div>
            <div className="tp-can">{ident.can.length ? ident.can.join(' · ') : 'nothing'}</div>
            {ident.cant.length > 0 && <div className="tp-cant">hidden — {ident.cant.join(', ')}</div>}
          </div>
          <div className="tp-sec">
            <div className="tp-l">what actually reaches us</div>
            <div className="redact mono">
              {ident.redact.map((r, i) => (
                <div className="row" key={i}>
                  <span className="k">{r.k}</span>
                  <span className={`v ${r.block ? 'block' : ''}`}>{r.v}</span>
                </div>
              ))}
            </div>
          </div>
          {ident.tier === 'tee' && (
            <div className="tp-eph"><Ic name="eye-off" /> leaves no trace — nothing is kept</div>
          )}
          <Link className="tp-manage" to="/keyring" onClick={() => setOpen(false)}>Switch identity →</Link>
        </div>
      )}
    </div>
  );
}
