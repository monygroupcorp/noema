import { useState } from 'react';
import { Ic } from '../lib/icons';

// Chat collapses into this on every screen except full chat (utilitarian co-pilot).
export function Concierge({ hasContext }: { hasContext: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`concierge${hasContext ? ' has-context' : ''}${open ? ' open' : ''}`}>
      <div className="cpanel">
        <div className="chead">
          <span className="orb" /><b>Concierge</b>
          <span className="x" onClick={() => setOpen(false)}><Ic name="x" /></span>
        </div>
        <div className="cbody">Tell me what to make or change. I’ll pick the tool and run it.</div>
        <div className="cinput">
          <input placeholder="make · adjust · explain…" />
          <button><Ic name="arrow-up" /></button>
        </div>
      </div>
      <div className="cbtn" onClick={() => setOpen((o) => !o)}>
        <span className="orb" />
        <span className="lab">Concierge<small>make · adjust · explain</small></span>
      </div>
    </div>
  );
}
