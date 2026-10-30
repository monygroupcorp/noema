import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { useProject } from '../state/project';
import { useIdentity } from '../state/identity';
import { counts, type Project } from '../lib/projects';
import { api, type ActivityRow, type EarningKind, type EarningsView } from '../lib/api';
import { activityDoorHref, activityRowLabel, partitionHomeActivity } from '../lib/muse';
import { Ic } from '../lib/icons';

// Home / dashboard (dashboard-spec.md, render noema-dashboard.png). Leads with the brand's
// one question answered — "What NOEMA can see: the meter, nothing more." — then the AWAITING
// YOU / RUNNING NOW activity bands (the return surface, DESIGN.md D-64), then projects. The
// instrument band is the one framed element (.noema-frame, corner ticks earned).
//
// noema-327 (crit V1): the old "recent" band read the client-local chat-title list, which
// is never real activity. It's replaced here by two bands off the real `GET /v1/me/activity`
// read (noema-325) — no second section kept below the fold, one real read is less new
// structure than two parallel "recent" ideas.

// Icon per activity kind — matches the nouns `activityRowLabel` already uses.
const ACTIVITY_ICON: Record<ActivityRow['kind'], string> = {
  training: 'graduation-cap',
  caption: 'file-text',
  decompose: 'workflow',
  generation: 'sparkles',
};

// The earner-facing name of each royalty/hosting stream, for the tile's sub-line. Keyed by
// the API's own `kind` so a stream the backend adds names itself as soon as it pays.
const EARNING_LABEL: Record<EarningKind, string> = {
  'spell-royalty': 'spell royalties',
  'model-royalty': 'model royalties',
  'host-cut': 'host cut',
  'host-bonus': 'host bonus',
  referral: 'referrals',
};

// An empty activity band is one plain line, not a dashed box (DESIGN.md D-60, D-64).
const BAND_EMPTY = { color: 'var(--faint)', fontSize: 'var(--fs-s)' } as const;

// The royalties tile's figure. Before the read lands it holds its place with a dash (D-61);
// once the read has landed, a lifetime of nothing is not printed as a large 0 (DESIGN.md D-58,
// P-1c) — the tile is then carried by its foot line alone, which says what would fill it.
export function royaltyFigure(e: EarningsView | null): string | null {
  if (!e) return '—';
  const n = Number(e.lifetime.impetus);
  return n > 0 ? n.toLocaleString() : null;
}

// What the royalties tile says under the number. Before the read lands there is nothing to
// claim, so it says nothing. Once it has, the streams that actually paid are named; an
// account that has earned nothing yet is told what would pay it, not promised a future.
export function royaltyFoot(e: EarningsView | null): string {
  if (!e) return '';
  const paid = e.streams.filter((s) => s.impetus !== '0');
  if (!paid.length) return 'publish a flow or a model — every run that uses it pays you';
  return `${paid.map((s) => EARNING_LABEL[s.kind]).join(' · ')} — credited to your balance`;
}

// The TEE roadmap line is not mode-gated (rth ruling, noema-344): every viewer — guest,
// signed-in, or ZK-private — sees it, not only accounts already running in TEE mode.
export function computeRow(exec: string): { glyph: string; text: string; roadmap?: string } {
  if (exec === 'tee') return { glyph: 'ring', text: 'hardware-sealed compute (TEE) is on the roadmap.' };
  return { glyph: 'lit', text: 'shared — running on our compute', roadmap: 'hardware-sealed compute (TEE) is on the roadmap.' };
}

// the project holdings row (spec): chats · canvases · datasets · models · collections · favorites.
// Holdings are real now: datasets/models/collections read the project's filed id-reference
// lengths, not a hardcoded 0. Chats/canvases/favorites stay client-local overlay (no backend
// store yet). Only the non-zero holdings are returned (DESIGN.md D-58: a row of glyphs all
// reading 0 is noise); a project with nothing in it gets EMPTY_HOLDINGS as its one line.
export const EMPTY_HOLDINGS = 'nothing in it yet';
export function holdings(p: Project): { ico: string; n: number }[] {
  const c = counts(p);
  return [
    { ico: 'message-square', n: c.chats },
    { ico: 'workflow', n: c.canvases },
    { ico: 'database', n: c.datasets },
    { ico: 'box', n: c.models },
    { ico: 'hexagon', n: c.collections },
    { ico: 'star', n: c.cards },
  ].filter((h) => h.n > 0);
}

export function Dashboard() {
  const { projects } = useProject();
  const { ident, execution } = useIdentity();
  const [credits, setCredits] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [earnings, setEarnings] = useState<EarningsView | null>(null);

  useEffect(() => {
    let live = true;
    api.meStatus().then((s) => { if (live && s?.balanceImpetus != null) setCredits(Number(s.balanceImpetus).toLocaleString()); }).catch(() => {});
    // The royalties tile: what this account has been paid for its own published work. One row
    // is page enough — the tile reads `lifetime`, which covers the whole history whatever the
    // page size; the payments themselves are the API's, at GET /v1/me/earnings.
    api.meEarnings({ limit: 1 }).then((e) => { if (live) setEarnings(e); }).catch(() => {});
    return () => { live = false; };
  }, []);
  useEffect(() => {
    let live = true;
    api.listActivity().then((p) => { if (live) setActivity(p.activity); }).catch(() => {});
    return () => { live = false; };
  }, []);
  const cr = credits ?? (ident.bal.match(/(\d[\d,]*)\s*credits?/)?.[1] ?? '—');
  const comp = computeRow(execution);
  const { awaiting, running } = partitionHomeActivity(activity);

  return (
    <AppShell title="Home">
      <div className="page"><div className="pw wide">

        {/* instrument band — the one framed element */}
        <div className="noema-frame instband">
          <div className="ib-line">What NOEMA can see: <span className="accent">the meter, nothing more.</span></div>
          <div className="ib-grid">
            <div className="ib-cell">
              <div className="ib-l">active compute · what we see</div>
              <div className="ib-compute"><span className={`hemi2 ${comp.glyph}`} /> {comp.text}</div>
              {comp.roadmap && <div className="ib-sub">{comp.roadmap}</div>}
            </div>
            <div className="ib-cell">
              <div className="ib-l">credits</div>
              <div className="ib-n gold"><span className="gem">◈</span> {cr}</div>
              <div className="ib-sub"><Link to="/funding">Fund from a wallet ▸</Link></div>
            </div>
            <div className="ib-cell">
              <div className="ib-l">royalties · lifetime</div>
              {royaltyFigure(earnings) !== null && (
                <div className="ib-n gold"><span className="gem">◈</span> {royaltyFigure(earnings)}</div>
              )}
              <div className="ib-sub">{royaltyFoot(earnings)}</div>
            </div>
          </div>
        </div>

        {/* No start button of its own: the topbar's "Start" is the screen's one way to begin
            (DESIGN.md D-50), and a second button here was the same action twice (P-1d). An empty
            band below still carries the action that fills it (D-60). */}
        {/* The return surface, first (DESIGN.md D-64): what finished while you were gone,
            then what is still running, above the fold. A band with nothing in it is one line
            that says what lands there and carries the action that fills it (D-60) — not a
            box — so the projects below rise into the fold for a visitor with nothing yet. */}
        <div className="sectionhead">AWAITING YOU</div>
        <div className="dbrecent">
          {awaiting.length === 0 ? (
            <div className="sub" style={BAND_EMPTY}>Nothing finished yet — a completed run lands here. <Link to="/catalog">Start one from the catalogue ▸</Link></div>
          ) : awaiting.map((r) => {
            const href = activityDoorHref(r);
            const row = (
              <>
                <Ic name={ACTIVITY_ICON[r.kind]} />
                <span className="rk">{activityRowLabel(r)}</span>
                <span className="rp mono">{r.settledAt ?? r.createdAt ?? ''}</span>
              </>
            );
            if (!href) return <div className="dbrec-row" key={r.actumId}>{row}</div>;
            return href.startsWith('/') ? (
              <Link className="dbrec-row" key={r.actumId} to={href}>{row}</Link>
            ) : (
              <a className="dbrec-row" key={r.actumId} href={href} target="_blank" rel="noreferrer">{row}</a>
            );
          })}
        </div>

        {/* RUNNING NOW — in-flight rows */}
        <div className="sectionhead">RUNNING NOW</div>
        <div className="dbrecent">
          {running.length === 0 ? (
            <div className="sub" style={BAND_EMPTY}>Nothing running — <Link to="/catalog">start something ▸</Link></div>
          ) : running.map((r) => (
            <div className="dbrec-row" key={r.actumId}>
              <Ic name={ACTIVITY_ICON[r.kind]} />
              <span className="rk">{activityRowLabel(r)}</span>
              <span className="rp mono">running…</span>
            </div>
          ))}
        </div>

        {/* your projects */}
        <div className="sectionhead db-head">your projects · {projects.length}<Link className="db-all" to="/projects">all projects ▸</Link></div>
        <div className="dbprojgrid">
          {projects.map((p) => (
            <Link key={p.id} className="dbproj" to={`/projects/${p.id}`}>
              <div className="dbproj-mosaic"><span style={{ background: p.color }} /><span /><span /><span /></div>
              <div className="dbproj-body">
                <b>{p.name}</b>
                <div className="dbproj-holdings mono">
                  {holdings(p).length
                    ? holdings(p).map((h) => <span key={h.ico} className="hc"><Ic name={h.ico} />{h.n}</span>)
                    : <span className="hc">{EMPTY_HOLDINGS}</span>}
                </div>
              </div>
              <div className="dbproj-foot"><span className="upd mono">{p.updated}</span></div>
            </Link>
          ))}
          <Link className="dbproj new" to="/projects?new=1"><Ic name="plus" /><span>new project</span></Link>
        </div>

      </div></div>
    </AppShell>
  );
}
