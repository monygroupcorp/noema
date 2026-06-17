import { Fragment } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Ic } from '../lib/icons';

// The altitude "webring" — explicit level-stepping, beside the identity control.
const ALT = [
  { to: '/', label: 'chat' },
  { to: '/card', label: 'card' },
  { to: '/canvas', label: 'canvas' },
  { to: '/space', label: 'space' },
];

export function Webring() {
  const here = useLocation().pathname;
  const idx = Math.max(0, ALT.findIndex((a) => a.to === here));
  const prev = ALT[(idx - 1 + ALT.length) % ALT.length].to;
  const next = ALT[(idx + 1) % ALT.length].to;
  return (
    <div className="altitude">
      <Link className="alt-nav" to={prev} title="up a level"><Ic name="chevron-left" /></Link>
      <span className="alt-ring">
        {ALT.map((a, i) => (
          <Fragment key={a.to}>
            {i > 0 && <span className="alt-dot">·</span>}
            <Link className={`alt-step ${a.to === here ? 'on' : ''}`} to={a.to}>{a.label}</Link>
          </Fragment>
        ))}
      </span>
      <Link className="alt-nav" to={next} title="down a level"><Ic name="chevron-right" /></Link>
    </div>
  );
}
