import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { api, type Collection } from '../lib/api';
import { publishNote, publishOutcome, type PublishRequest } from '../lib/editio';

// Export & publish (editio-export-spec.md). Publishing is a CHOICE OF DESTINATION across
// the private→public hemisphere spectrum.
//   • you (download)  — archive ZIP, private/custody-ours → skips moderation, works today.
//   • hosting          — GalleryAdapter: public ERC-721 tokenURIs, a TEMPORARY bridge NOESIS
//                        leans on. Public surface → moderation gate (fail-closed until CSAM;
//                        works on staging's permissive gate). Strongly warned as non-permanent.
//   • NOESIS mint      — our launchpad (deploying separately); disabled here for now.

type Dest = 'you' | 'hosting' | 'noesis';
type Kind = 'download' | 'hosting';
type Job =
  | { s: 'idle' }
  | { s: 'busy'; editionId: string; kind: Kind }
  | { s: 'ready'; url: string; kind: Kind; editionId: string }
  | { s: 'rejected'; msg: string }
  | { s: 'err'; msg: string };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Option {
  key: Dest; glyph: string; title: React.ReactNode; tag: string; tagClass: string; desc: string; sub: string;
}
const OPTIONS: Option[] = [
  { key: 'you', glyph: 'dashed', title: 'Export to you', tag: '↓ stays yours', tagClass: 'good',
    desc: 'Bundle every approved piece + its metadata into a ZIP, hosted for you to download. NOEMA keeps nothing public — mint or host it anywhere you like.', sub: 'images/ + metadata/ + manifest.json · content-addressed provenance' },
  { key: 'hosting', glyph: 'ring', title: 'Publish to hosting', tag: '⇧ a temporary bridge', tagClass: 'slate',
    desc: 'NOEMA hosts your pieces as public ERC-721 tokenURIs — point any contract’s baseURI at them and mint anywhere. A launch bridge, not permanent storage.', sub: 'public base URI + per-token metadata · migrate to Arweave/IPFS before you rely on it' },
  { key: 'noesis', glyph: 'lit', title: <>Publish to <span className="noesis-wm">NOESIS</span></>, tag: '↗ our launchpad', tagClass: 'egress',
    desc: 'The easy path — NOESIS mints the contract and lists the collection on-chain. Public & permanent.', sub: 'gacha · ERC-721 · coming with the NOESIS launchpad' },
];

export function EditioExport() {
  const { id } = useParams();
  const [c, setC] = useState<Collection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dest, setDest] = useState<Dest>('you');
  const [consent, setConsent] = useState(false);
  const [job, setJob] = useState<Job>({ s: 'idle' });

  useEffect(() => {
    if (!id) return;
    let live = true;
    api.getCollection(id).then((r) => { if (live) setC(r.collection); }).catch((e) => { if (live) setErr(msg(e)); });
    return () => { live = false; };
  }, [id]);

  // Poll a pending publication until it settles (ZIP built + hosted, or gate-rejected).
  useEffect(() => {
    if (job.s !== 'busy' || !job.editionId) return;
    const kind = job.kind;
    let live = true;
    let t: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const { edition } = await api.getEdition((job as { editionId: string }).editionId);
        if (!live) return;
        if (edition.status === 'published' && edition.externalRef) { setJob({ s: 'ready', url: edition.externalRef, kind, editionId: edition.id }); return; }
        if (edition.status === 'rejected') { setJob({ s: 'rejected', msg: publishNote(edition) }); return; }
        if (edition.status === 'failed') { setJob({ s: 'err', msg: 'The publish failed. Approve some pieces in curation, then try again.' }); return; }
        t = setTimeout(tick, 2500);
      } catch (e) { if (live) setJob({ s: 'err', msg: msg(e) }); }
    };
    t = setTimeout(tick, 2500);
    return () => { live = false; clearTimeout(t); };
  }, [job]);

  if (err) return <AppShell title="Export & publish"><div className="page"><div className="pw"><div className="warn">Couldn’t load this collection: {err}</div></div></div></AppShell>;
  if (!c) return <AppShell title="Export & publish"><div className="page"><div className="pw"><div className="empty"><div className="t">Loading…</div></div></div></div></AppShell>;

  const noPieces = c.completed === 0;
  const blocked: Record<Dest, string> = {
    you: noPieces ? 'No approved pieces yet — approve some in curation first.' : '',
    hosting: noPieces ? 'No approved pieces yet — approve some in curation first.' : '',
    noesis: 'Minting arrives with the NOESIS launchpad — not yet available here.',
  };
  const crossing = dest !== 'you';

  async function run(kind: Kind) {
    if (!c) return;
    const artifact = { kind: 'collectio' as const, id: c.id };
    const body: PublishRequest = kind === 'download'
      ? { artifact, destination: 'archive', visibility: 'private', custody: 'ours' }
      : { artifact, destination: 'gallery', visibility: 'marketplace', custody: 'ours' };
    setJob({ s: 'busy', editionId: '', kind });
    try {
      const { edition } = await api.publish(body);
      if (edition.status === 'published' && edition.externalRef) setJob({ s: 'ready', url: edition.externalRef, kind, editionId: edition.id });
      else if (publishOutcome(edition) === 'refused') setJob({ s: 'rejected', msg: publishNote(edition) });
      else setJob({ s: 'busy', editionId: edition.id, kind });
    } catch (e) { setJob({ s: 'err', msg: msg(e) }); }
  }

  const crumb = <span className="ph-crumb"><Link to="/collections">{c.nomen || 'collection'}</Link> <span className="sep">/</span> <b>export &amp; publish</b></span>;

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw">
        <div className="pagehead">
          <div><h1>Export &amp; publish</h1><div className="sub">your collection — your choice of where it goes</div></div>
          <div className="right"><span className="badge">{c.status === 'complete' ? 'supply locked' : 'still generating'}</span></div>
        </div>

        <div className="ex-facts">
          <Fact n={`${c.completed.toLocaleString()} ✓`} l="pieces approved" />
          <Fact n={`${c.completed.toLocaleString()} / ${c.total.toLocaleString()}`} l="of target" />
          <Fact n={c.rejected ? `${c.rejected.toLocaleString()}` : '0'} l="rejected" />
          <Fact n={`${c.provenanceHash.slice(7, 15)}…`} l="provenance" />
        </div>

        <div className="ex-dest-head">
          <span className="ex-legend mono">private <span className="hemi2 dashed" /> — <span className="hemi2 ring" /> — <span className="hemi2 lit" /> public</span>
        </div>
        <div className="ex-options">
          {OPTIONS.map((o) => {
            const off = blocked[o.key] !== '';
            return (
              <button key={o.key} className={`ex-opt${dest === o.key ? ' on' : ''}${off ? ' off' : ''}`} disabled={off}
                onClick={() => { setDest(o.key); setConsent(false); setJob({ s: 'idle' }); }}>
                <span className={`radio${dest === o.key ? ' on' : ''}`} />
                <span className={`hemi2 ${o.glyph} ex-hemi`} />
                <span className="ex-opt-main">
                  <span className="ex-opt-h"><b>{o.title}</b><span className={`ex-tag ${o.tagClass}`}>{o.tag}</span></span>
                  <span className="ex-opt-d">{o.desc}</span>
                  <span className="ex-opt-s mono">{off ? blocked[o.key] : o.sub}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* adaptive consequences */}
        {dest === 'you' ? (
          <div className="ex-note good"><span className="hemi2 dashed" /> <b>Stays yours.</b> The download is your whole approved supply + metadata — a private, our-hosted ZIP. Nothing is published; mint or host it wherever you choose.</div>
        ) : dest === 'hosting' ? (
          <div className="ex-note egress">↗ <b>This crosses to public.</b> NOEMA hosts your pieces as public tokenURIs so you can mint on your own contract. <b>This is a bridge, not permanent storage</b> — NOEMA is an AI-generation platform and does not guarantee indefinite hosting. Migrate to Arweave/IPFS before you rely on these URIs long-term.</div>
        ) : (
          <div className="ex-note egress">↗ <b>{blocked.noesis}</b></div>
        )}

        {/* footer — action per destination */}
        <div className="ex-foot">
          {dest === 'you' ? (
            <>
              <div className="ex-foot-note mono">nothing leaves NOEMA as public · a private download link</div>
              {job.s === 'ready' && job.kind === 'download'
                ? <a className="btn good lg" href={job.url} download>Download collection ↓ <span className="ex-btn-sub">your ZIP is ready</span></a>
                : job.s === 'busy' && job.kind === 'download'
                ? <button className="btn good lg" disabled>Preparing… <span className="ex-btn-sub">bundling {c.completed.toLocaleString()} pieces</span></button>
                : <button className="btn good lg" disabled={blocked.you !== ''} onClick={() => run('download')}>Prepare download ↓ <span className="ex-btn-sub">{blocked.you || 'bundle every approved piece + metadata'}</span></button>}
            </>
          ) : dest === 'hosting' ? (
            <>
              {job.s === 'ready' && job.kind === 'hosting' ? (
                <div className="ex-hosted">
                  <div className="ex-foot-note mono">✓ hosted — set your contract’s <b>baseURI</b> to:</div>
                  <code className="ex-baseuri">{job.url}/</code>
                  <div className="ex-foot-note mono" style={{ marginTop: 6 }}>tokenURI resolves at <code>{job.url}/&lt;tokenId&gt;.json</code> · <span className="lnk">migrate to Arweave →</span> (coming soon) before you rely on it</div>
                  <button className="btn ghost" style={{ marginTop: 8 }}
                    onClick={() => { void api.retract(job.editionId).then(() => setJob({ s: 'idle' })).catch((e) => setJob({ s: 'err', msg: msg(e) })); }}>
                    Retract hosting <span className="ex-btn-sub">unpublish — the URIs stop resolving</span>
                  </button>
                </div>
              ) : job.s === 'rejected' ? (
                <div className="warn">This collection wasn’t published to hosting — {job.msg} Publishing again won’t change the outcome; your export-to-you download is unaffected.</div>
              ) : (
                <>
                  <label className="ex-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I understand this is a public, temporary bridge — I’ll migrate to permanent storage</label>
                  <button className="btn accent lg" disabled={!consent || blocked.hosting !== '' || (job.s === 'busy')} onClick={() => run('hosting')}>
                    {job.s === 'busy' ? 'Publishing…' : 'Publish to hosting →'} <span className="ex-btn-sub">public tokenURIs</span>
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <div className="ex-foot-note mono">NOESIS is our launchpad · deploying separately</div>
              <button className="btn accent lg" disabled>Mint to NOESIS → <span className="ex-btn-sub">coming soon</span></button>
            </>
          )}
          {job.s === 'err' && <div className="warn" style={{ marginTop: 8 }}>{job.msg}</div>}
        </div>
      </div></div>
    </AppShell>
  );
}

function Fact({ n, l }: { n: string; l: string }) {
  return <div className="ex-fact"><div className="ex-fn">{n}</div><div className="ex-fl mono">{l}</div></div>;
}
