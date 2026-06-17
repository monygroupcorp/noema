import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Ic } from '../lib/icons';
import './onboard.css';

const TIERS = [
  { id: 'anon', ico: 'venetian-mask', t: 'Just start', s: 'Anonymous. A bearer purse, no signup. We see the work, never who you are.' },
  { id: 'identified', ico: 'user-round', t: 'Sign in', s: 'Identified. We keep your work and your galaxy across devices.' },
  { id: 'tee', ico: 'eye-off', t: 'Go private', s: 'Sealed compute over your own tunnel. We see nothing but the meter.' },
];

export function Onboard() {
  const [pick, setPick] = useState('anon');
  return (
    <div className="onboard-root">
      <div className="ocard">
        <div className="logo" />
        <h1>Welcome to noema</h1>
        <p>Make anything — images, video, 3D, sound. Start however you like. You can stay anonymous, or go fully private; you choose what we can see.</p>
        <div className="tierpick">
          {TIERS.map((o) => (
            <div key={o.id} className={`tieropt${pick === o.id ? ' on' : ''}`} onClick={() => setPick(o.id)}>
              <div className="tchip"><Ic name={o.ico} /></div>
              <div className="tmain"><div className="t">{o.t}</div><div className="s">{o.s}</div></div>
            </div>
          ))}
        </div>
        <Link className="btn block" to="/">Continue →</Link>
        <div className="foot">you can add more identities anytime — each its own world</div>
      </div>
    </div>
  );
}
