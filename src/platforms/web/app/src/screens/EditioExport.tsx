import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { api, type Collection } from '../lib/api';
import { publishNote, publishOutcome, type Editio, type PublishRequest } from '../lib/editio';

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
  | { s: 'held'; msg: string }
  | { s: 'rejected'; msg: string }
  | { s: 'err'; msg: string };

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Where one edition leaves this screen's job. Pure, so the hosting path's terminal states are
// checked without mounting the screen.
//
// Hosting publishes at visibility 'marketplace', which is a moderated public surface, so the
// gate can HOLD it — and a hold never settles on its own; only a reviewer clears it. The poll
// below used to end on published / rejected / failed alone, so a held publication left the
// button reading "Publishing…" and re-polled every 2.5s forever: the publisher was never told
// their collection was waiting on a person, and had nothing to wait for on this screen. A hold
// is terminal HERE for that reason — the outcome arrives on the shelf's review state, not from
// another poll.
//
// Returns null while the publication is genuinely still settling (keep polling).
export function exportJobFor(e: Editio, kind: Kind): Job | null {
  if (e.status === 'published' && e.externalRef) return { s: 'ready', url: e.externalRef, kind, editionId: e.id };
  const outcome = publishOutcome(e);
  if (outcome === 'refused') return { s: 'rejected', msg: publishNote(e) };
  if (outcome === 'held') return { s: 'held', msg: publishNote(e) };
  if (outcome === 'failed') return { s: 'err', msg: 'The publish failed. Approve some pieces in curation, then try again.' };
  return null;
}

/** The destination a hosting publication is filed under (`run` below, and the server's
 *  GalleryAdapter). "Export to you" is `archive`, and the two must not be read for each
 *  other — the screen keeps one job per destination for exactly that reason. */
const HOSTING_DESTINATION = 'gallery';

/**
 * What this collection's hosting publication already IS, from the server's own record. Pure.
 *
 * `exportJobFor` makes an outcome terminal for the poll that is already running, which is
 * only half of it: the poll runs in the session that pressed the button. This screen mounts
 * at `{s:'idle'}` and fetched only the collection, so reopening it dropped everything the
 * publisher had been told and offered "Publish to hosting" again — the same bug the shelf
 * had for models, where a card read as unpublished and the button filed a second edition
 * behind the first.
 *
 * Seeding from the review queue (`GET /v1/editiones/review`) recovered a HOLD, and only a
 * hold, because that queue is the `reviewOutcome:'pending'` set. Every TERMINAL outcome was
 * left in the closed tab:
 *
 *   • a REFUSAL — which is the DEFAULT posture's answer, not an edge case: the gate is
 *     fail-closed until a scanner is configured, so a public publish is refused rather than
 *     held. The reason the server persisted for the publisher was shown once and then never
 *     again, and the consent box and publish control came back to invite a republish that
 *     cannot succeed.
 *   • a publication already LIVE — read as one nobody had put forth, so the baseURI the
 *     publisher came for was gone and pressing Publish filed a second edition of a
 *     collection that was already hosted.
 *
 * So this reads the caller's own publications of this collection instead
 * (`GET /v1/editiones?artifact=collectio:<id>`), newest first, and takes the newest one
 * filed at the hosting destination.
 *
 * Two outcomes deliberately seed NOTHING, because for both of them the publish control is
 * the right thing to be looking at: an adapter `failed` (the screen's own copy for it says
 * to try again, and the button is that retry — a stale error is not news on mount), and a
 * `retracted` publication (unpublishing in order to publish again is the whole point).
 */
export function hostingJobFor(editions: Editio[]): Job | null {
  const e = editions.find((x) => x.destination === HOSTING_DESTINATION);
  if (!e) return null;
  const settled = exportJobFor(e, 'hosting');
  if (settled) return settled.s === 'err' ? null : settled;
  // Not settled: a publication an earlier session left in flight. Hand it to the poll
  // rather than drop it — `exportJobFor` also returns null for a retraction, which must
  // not be polled for a settle that already happened.
  return publishOutcome(e) === 'withdrawn' ? null : { s: 'busy', editionId: e.id, kind: 'hosting' };
}

/**
 * One job per destination that can have one.
 *
 * "Export to you" and "Publish to hosting" are two independent publications — a private ZIP
 * and a public hosting run — and the screen kept ONE slot for both, which meant whichever
 * moved last erased the other. The destination switch was taught not to clear that slot, but
 * `run()` still overwrote it, so the seeded hold this screen exists to show did not survive
 * the one thing a held publisher is explicitly invited to do instead: switch to "Export to
 * you", press Prepare download, and come back. The hold was gone, the consent box and
 * "Publish to hosting" were back, and pressing it filed a second edition behind the one a
 * reviewer was still holding. A hold is the server's record about the HOSTING publication;
 * nothing the download path does may discard it, and the reverse holds too — publishing to
 * hosting used to abandon the poll watching a ZIP that was still being bundled.
 *
 * Keyed by kind, that is structural rather than remembered, and a destination switch has
 * nothing left to decide: the footer reads its own destination's job, so an error stays with
 * the attempt that produced it instead of being rendered — and cleared — under all three.
 */
export type Jobs = Record<Kind, Job>;
export const IDLE_JOBS: Jobs = { download: { s: 'idle' }, hosting: { s: 'idle' } };

/** One destination's job replaced, every other destination's left standing. Pure. */
export function putJob(all: Jobs, kind: Kind, j: Job): Jobs {
  return { ...all, [kind]: j };
}

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

/**
 * Watch one destination's pending publication until it settles.
 *
 * Keyed on the edition id rather than on the job object: a settle writes the job table, and
 * an effect that depends on the table restarts the OTHER destination's poll every time.
 */
function usePublishPoll(kind: Kind, job: Job, setJobs: React.Dispatch<React.SetStateAction<Jobs>>) {
  const editionId = job.s === 'busy' ? job.editionId : '';
  useEffect(() => {
    if (!editionId) return;
    let live = true;
    let t: ReturnType<typeof setTimeout>;
    const put = (j: Job) => setJobs((all) => putJob(all, kind, j));
    const tick = async () => {
      try {
        const { edition } = await api.getEdition(editionId);
        if (!live) return;
        const settled = exportJobFor(edition, kind);
        if (settled) { put(settled); return; }
        t = setTimeout(tick, 2500);
      } catch (e) { if (live) put({ s: 'err', msg: msg(e) }); }
    };
    t = setTimeout(tick, 2500);
    return () => { live = false; clearTimeout(t); };
  }, [editionId, kind, setJobs]);
}

export function EditioExport() {
  const { id } = useParams();
  const [c, setC] = useState<Collection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dest, setDest] = useState<Dest>('you');
  const [consent, setConsent] = useState(false);
  const [jobs, setJobs] = useState<Jobs>(IDLE_JOBS);
  // The publisher has picked a destination themselves, so the seed below must not move them.
  const chosen = useRef(false);

  useEffect(() => {
    if (!id) return;
    let live = true;
    api.getCollection(id).then((r) => { if (live) setC(r.collection); }).catch((e) => { if (live) setErr(msg(e)); });
    // What the server already has on this collection's hosting publication outlives the
    // session that filed it, so recover it on mount. Only ever promotes an idle screen: a
    // publish begun in THIS session owns the job and must not be clobbered by a snapshot
    // taken before it. A failure here leaves the screen as it was — the publication is
    // still listed in /feed while a reviewer holds it, and refusing to render the whole
    // page over a missing seed would be worse than the button coming back.
    api.listMyEditions({ kind: 'collectio', id })
      .then((q) => {
        if (!live) return;
        const job = hostingJobFor(q.editions);
        if (!job) return;
        setJobs((all) => (all.hosting.s === 'idle' ? putJob(all, 'hosting', job) : all));
        // Every word of this is rendered under the hosting footer, and the screen opens on
        // "Export to you" — so a recovered outcome sat behind a click on the one control it
        // exists to withhold, and the collection looked untouched until the publisher
        // pressed Publish. Open where the news is, for the two outcomes that ARE news: a
        // hold and a refusal are things the publisher has not been told. A publication
        // already live is not, and someone who came to bundle a ZIP should not be moved
        // off the destination they came for.
        if (!chosen.current && (job.s === 'held' || job.s === 'rejected')) setDest('hosting');
      })
      .catch(() => {});
    return () => { live = false; };
  }, [id]);

  // Poll each pending publication until it settles (ZIP built + hosted, or gate-rejected).
  // One per destination, because both can now be in flight at once.
  usePublishPoll('download', jobs.download, setJobs);
  usePublishPoll('hosting', jobs.hosting, setJobs);

  if (err) return <AppShell title="Export & publish"><div className="page"><div className="pw"><div className="warn">Couldn’t load this collection: {err}</div></div></div></AppShell>;
  if (!c) return <AppShell title="Export & publish"><div className="page"><div className="pw"><div className="empty"><div className="t">Loading…</div></div></div></div></AppShell>;

  const noPieces = c.completed === 0;
  const blocked: Record<Dest, string> = {
    you: noPieces ? 'No approved pieces yet — approve some in curation first.' : '',
    hosting: noPieces ? 'No approved pieces yet — approve some in curation first.' : '',
    noesis: 'Minting arrives with the NOESIS launchpad — not yet available here.',
  };
  const crossing = dest !== 'you';
  // Each destination's own job. A ZIP being bundled is a different edition from a hosting
  // publication and neither reads the other's state: a download in flight must not put
  // “Publishing…” on the hosting button, and must not hide the hold standing behind it.
  const dj = jobs.download;
  const hj = jobs.hosting;
  const hostingBusy = hj.s === 'busy';
  // The job the footer is currently showing — NOESIS has none, and renders no job line.
  const shown: Job | null = dest === 'you' ? dj : dest === 'hosting' ? hj : null;

  async function run(kind: Kind) {
    if (!c) return;
    const artifact = { kind: 'collectio' as const, id: c.id };
    const body: PublishRequest = kind === 'download'
      ? { artifact, destination: 'archive', visibility: 'private', custody: 'ours' }
      : { artifact, destination: 'gallery', visibility: 'marketplace', custody: 'ours' };
    const put = (j: Job) => setJobs((all) => putJob(all, kind, j));
    put({ s: 'busy', editionId: '', kind });
    try {
      const { edition } = await api.publish(body);
      put(exportJobFor(edition, kind) ?? { s: 'busy', editionId: edition.id, kind });
    } catch (e) { put({ s: 'err', msg: msg(e) }); }
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
                onClick={() => { chosen.current = true; setDest(o.key); setConsent(false); }}>
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
              {dj.s === 'ready'
                ? <a className="btn good lg" href={dj.url} download>Download collection ↓ <span className="ex-btn-sub">your ZIP is ready</span></a>
                : dj.s === 'busy'
                ? <button className="btn good lg" disabled>Preparing… <span className="ex-btn-sub">bundling {c.completed.toLocaleString()} pieces</span></button>
                : <button className="btn good lg" disabled={blocked.you !== ''} onClick={() => run('download')}>Prepare download ↓ <span className="ex-btn-sub">{blocked.you || 'bundle every approved piece + metadata'}</span></button>}
            </>
          ) : dest === 'hosting' ? (
            <>
              {hj.s === 'ready' ? (
                <div className="ex-hosted">
                  <div className="ex-foot-note mono">✓ hosted — set your contract’s <b>baseURI</b> to:</div>
                  <code className="ex-baseuri">{hj.url}/</code>
                  <div className="ex-foot-note mono" style={{ marginTop: 6 }}>tokenURI resolves at <code>{hj.url}/&lt;tokenId&gt;.json</code> · <span className="lnk">migrate to Arweave →</span> (coming soon) before you rely on it</div>
                  <button className="btn ghost" style={{ marginTop: 8 }}
                    onClick={() => { void api.retract(hj.editionId).then(() => setJobs((all) => putJob(all, 'hosting', { s: 'idle' }))).catch((e) => setJobs((all) => putJob(all, 'hosting', { s: 'err', msg: msg(e) }))); }}>
                    Retract hosting <span className="ex-btn-sub">unpublish — the URIs stop resolving</span>
                  </button>
                </div>
              ) : hj.s === 'held' ? (
                <div className="warn">This collection isn’t hosted yet — {hj.msg} Nothing more to do here; <Link to="/feed">track it in the feed</Link>, and your export-to-you download is unaffected.</div>
              ) : hj.s === 'rejected' ? (
                <div className="warn">This collection wasn’t published to hosting — {hj.msg} Publishing again won’t change the outcome; your export-to-you download is unaffected.</div>
              ) : (
                <>
                  <label className="ex-consent"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> I understand this is a public, temporary bridge — I’ll migrate to permanent storage</label>
                  <button className="btn accent lg" disabled={!consent || blocked.hosting !== '' || hostingBusy} onClick={() => run('hosting')}>
                    {hostingBusy ? 'Publishing…' : 'Publish to hosting →'} <span className="ex-btn-sub">public tokenURIs</span>
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
          {shown?.s === 'err' && <div className="warn" style={{ marginTop: 8 }}>{shown.msg}</div>}
        </div>
      </div></div>
    </AppShell>
  );
}

function Fact({ n, l }: { n: string; l: string }) {
  return <div className="ex-fact"><div className="ex-fn">{n}</div><div className="ex-fl mono">{l}</div></div>;
}
