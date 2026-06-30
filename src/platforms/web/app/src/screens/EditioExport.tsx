import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { COLLECTIONS } from '../lib/collections';

// Export & publish (editio-export-spec.md, renders noema-editio-export.png + ...-noesis.png).
// Publishing is a CHOICE OF DESTINATION, not a funnel to NOESIS — the chat-routing device
// applied to where the collection goes, mapped onto the hemisphere spectrum (private→public).
// Sovereign download is the default; consequences are ADAPTIVE — no warnings/consent on the
// private download, full egress + doxx + consent gate only on the public-crossing destinations.

type Dest = 'you' | 'hosting' | 'noesis';
interface Option {
  key: Dest; glyph: string; title: React.ReactNode; tag: string; tagClass: string; desc: string; sub: string;
}
const OPTIONS: Option[] = [
  { key: 'you', glyph: 'dashed', title: 'Export to you', tag: '↓ stays yours', tagClass: 'good',
    desc: 'Download every piece + metadata as a zip. NOEMA keeps nothing — mint or host it anywhere you like.', sub: '~2.4 GB · 1,889 PNG + metadata.json + collection manifest' },
  { key: 'hosting', glyph: 'ring', title: 'Publish to hosting', tag: '⇧ noema holds the files', tagClass: 'slate',
    desc: 'NOEMA hosts the assets and returns URI values for every piece — point any contract, anywhere, at them.', sub: 'returns base URI + per-token metadata URIs · you mint elsewhere' },
  { key: 'noesis', glyph: 'lit', title: <>Publish to <span className="noesis-wm">NOESIS</span></>, tag: '↗ leaves noema → noesis', tagClass: 'egress',
    desc: 'The easy path — NOESIS mints the contract and lists the collection on-chain. Public & permanent.', sub: 'gacha · ERC-721 · 5% royalty · review on NOESIS before it goes live' },
];

export function EditioExport() {
  const { id } = useParams();
  const c = COLLECTIONS.find((x) => x.id === id) ?? COLLECTIONS[0];
  const [dest, setDest] = useState<Dest>('you');
  const [consent, setConsent] = useState(false);
  const crossing = dest !== 'you';

  const crumb = <span className="ph-crumb"><Link to="/collections">{c.name}</Link> <span className="sep">/</span> <b>export &amp; publish</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw">
        <div className="pagehead">
          <div><h1>Export &amp; publish</h1><div className="sub">your collection — your choice of where it goes</div></div>
          <div className="right"><span className="badge">supply locked</span></div>
        </div>

        {/* supply facts */}
        <div className="ex-facts">
          <Fact n={`${c.supply.toLocaleString()} ✓`} l="pieces locked" />
          <Fact n={c.rarityDelta} l="of rarity target" />
          <Fact n={`${c.traits} traits`} l="category·title·value·rarity" />
          <Fact n="PNG + JSON" l="per piece" />
        </div>

        {/* destination picker */}
        <div className="ex-dest-head">
          <span className="noema-kicker">destination</span>
          <span className="ex-legend mono">private <span className="hemi2 dashed" /> — <span className="hemi2 ring" /> — <span className="hemi2 lit" /> public</span>
        </div>
        <div className="ex-options">
          {OPTIONS.map((o) => (
            <button key={o.key} className={`ex-opt${dest === o.key ? ' on' : ''}`} onClick={() => { setDest(o.key); setConsent(false); }}>
              <span className={`radio${dest === o.key ? ' on' : ''}`} />
              <span className={`hemi2 ${o.glyph} ex-hemi`} />
              <span className="ex-opt-main">
                <span className="ex-opt-h"><b>{o.title}</b><span className={`ex-tag ${o.tagClass}`}>{o.tag}</span></span>
                <span className="ex-opt-d">{o.desc}</span>
                <span className="ex-opt-s mono">{o.sub}</span>
              </span>
            </button>
          ))}
        </div>

        {/* adaptive consequences */}
        {!crossing ? (
          <div className="ex-note good"><span className="hemi2 dashed" /> <b>Stays yours.</b> The download is the whole collection — NOEMA keeps no copy. Nothing is published; mint or host it wherever you choose, whenever you choose.</div>
        ) : (
          <>
            <div className="ex-note egress">↗ <b>This crosses to public.</b> Pieces + metadata are published {dest === 'noesis' ? 'on-chain via NOESIS' : 'to NOEMA hosting'} — after this, NOEMA can no longer keep them private. They are public, forever.</div>
            {dest === 'noesis' && (
              <div className="ex-note amber">⚠ Minting from <b>0x9c…2f</b> will publicly link this collection to your identity. To stay anonymous, mint from a <span className="lnk">shielded wallet</span>.</div>
            )}
          </>
        )}

        {/* footer */}
        <div className="ex-foot">
          {!crossing ? (
            <>
              <div className="ex-foot-note mono">nothing leaves NOEMA · no public step on this path</div>
              <button className="btn good lg">Download collection ↓ <span className="ex-btn-sub">~2.4 GB · stays on your machine</span></button>
            </>
          ) : (
            <>
              <label className="ex-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I understand this is public &amp; permanent</label>
              <button className="btn accent lg" disabled={!consent}>
                {dest === 'noesis' ? 'Mint to NOESIS →' : 'Publish to hosting →'} <span className="ex-btn-sub">this cannot be undone</span>
              </button>
            </>
          )}
        </div>
      </div></div>
    </AppShell>
  );
}

function Fact({ n, l }: { n: string; l: string }) {
  return <div className="ex-fact"><div className="ex-fn">{n}</div><div className="ex-fl mono">{l}</div></div>;
}
