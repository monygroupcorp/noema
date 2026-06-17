import { useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';

const PHRASE = ['harbor', 'ember', 'quartz', 'meadow', 'cipher', 'lantern', 'tundra', 'violet', 'anchor', 'pollen', 'cobalt', 'marrow'];

function Secret({ k, value, secret }: { k: string; value: string; secret?: boolean }) {
  const [shown, setShown] = useState(!secret);
  return (
    <div className="secret">
      <span className="k">{k}</span>
      {shown
        ? <span className="val">{value}</span>
        : <span className="val hidden" onClick={() => setShown(true)} style={{ cursor: 'pointer' }}>•••• •••• tap to reveal</span>}
    </div>
  );
}

export function Vault() {
  const [revealed, setRevealed] = useState(false);

  const context = (
    <>
      <div className="csec">
        <div className="ctitle">What you hold vs what we store</div>
        <div className="meta-line"><span>you hold</span><span className="v">nullifier · secret · purse token</span></div>
        <div className="meta-line"><span>we store</span><span className="v">commitment · spent-nullifier</span></div>
        <div className="meta-line"><span>link between</span><span className="v">none</span></div>
      </div>
      <div className="csec">
        <div className="ctitle">Purse</div>
        <div className="meta-line"><span>balance</span><span className="v mono">38 credits</span></div>
      </div>
    </>
  );

  return (
    <AppShell crumb="vault" context={context}>
      <div className="page"><div className="pw">
        <div className="pagehead"><div>
          <h1>Vault</h1>
          <div className="sub">Anonymous credit. The secrets below exist only in this browser — there is no recovery.</div>
        </div></div>

        <div className="sectionhead">Purse</div>
        <div className="stats">
          <div className="stat"><div className="l">Credits</div><div className="n">38</div><div className="d">purse bearer token</div></div>
          <div className="stat"><div className="l">This note</div><div className="n">$1.20</div><div className="d">redeemable</div></div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--s2)', marginTop: 'var(--s4)' }}>
          <button className="btn"><Ic name="plus" /> Add funds</button>
          <button className="btn-ghost"><Ic name="arrow-up" /> Export purse token</button>
        </div>

        <div className="sectionhead">Secrets</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s2)' }}>
          <Secret k="commitment" value="0x8f3a2bd1…eac9994c021" />
          <Secret k="nullifier" value="0x4417c9e0…8a91d3f0aa" secret />
          <Secret k="secret" value="0xd02b7e55…6b0c1f2e9d" secret />
        </div>

        <div className="sectionhead">Recovery phrase</div>
        <div className="warn">Write these down and store them offline. We cannot recover them — possession is the only key.</div>
        <div className="phrase" style={{ filter: revealed ? 'none' : 'blur(6px)', marginTop: 'var(--s3)' }}>
          {PHRASE.map((w, i) => <span key={i}><i>{i + 1}</i>{w}</span>)}
        </div>
        {!revealed && (
          <button className="btn-ghost" style={{ marginTop: 'var(--s3)' }} onClick={() => setRevealed(true)}>
            <Ic name="eye" /> Reveal phrase
          </button>
        )}
      </div></div>
    </AppShell>
  );
}
