import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../../shell/AppShell';
import { api, getSession, type MuseSessionView } from '../../lib/api';
import { doorPath } from '../../lib/entry';
import {
  filterSessionHistory,
  sessionHistory,
  sessionHref,
  sessionSearchEmptyNote,
  type SessionRow,
} from '../../lib/muse';
import { errText } from './errText';

// ── The session history (noema-274) ─────────────────────────────────────────
// `/datasets/:id/muse/sessions` — every session broken off this dataset, most recently
// worked first, with a search over the fragments each piece was drawn from. The dataset
// screen carries a count and the door; this is what the door opens onto.
//
// It lives in this file rather than in a screen of its own because it is the same
// surface as the muse screen seen from one step back: the row it opens is a session on
// `Muse` above, reached by the `?session=` name that screen already resolves, and the
// two share the rules in `lib/muse.ts` that decide order, readout and search.
//
// NOTHING HERE WRITES. The list is one read of `listMuseSessions`; the search runs over
// what that read already returned, so a keystroke fetches nothing. No run is fetched to
// draw a row either — a recorded piece carries its lineage, and the images are resolved
// only when a session is actually opened. Opening a row is a read of one session, so
// browsing the history cannot move which session a bare visit resumes.
export function MuseSessions() {
  const { id } = useParams();
  const [sessions, setSessions] = useState<MuseSessionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [name, setName] = useState<string | null>(null);

  // Muse sessions belong to an account, so there is nothing to ask for without one. Asking
  // anyway sent the anonymous commitment header at an owner-scoped route, which answers
  // auth.missing every time — a 401 the visitor could do nothing about, printed at them, and a
  // warn in the log for a question that was never answerable.
  const signedIn = getSession() !== null;

  useEffect(() => {
    if (!id) return;
    if (!signedIn) { setSessions([]); return; }
    let live = true;
    api.listMuseSessions(id)
      .then(({ sessions: list }) => { if (live) setSessions(list); })
      .catch((e) => { if (!live) return; setSessions([]); setError(errText(e)); });
    return () => { live = false; };
  }, [id, signedIn]);

  // The dataset's name, for the crumb only — the list above does not wait on it.
  // `getDatasetFull` covers a public dataset's own name too (noema-dataset-access-field).
  useEffect(() => {
    if (!id) return;
    let live = true;
    api.getDatasetFull(id)
      .then((d) => { if (live) setName(d?.name ?? null); })
      .catch(() => { /* the crumb falls back to the id */ });
    return () => { live = false; };
  }, [id]);

  const rows: SessionRow[] = useMemo(() => sessionHistory(sessions ?? []), [sessions]);
  const shown = useMemo(() => filterSessionHistory(rows, query), [rows, query]);
  const emptyNote = sessions === null ? null : sessionSearchEmptyNote(shown, query);

  const crumb = (
    <span className="ph-crumb">
      <Link to="/datasets">Datasets</Link> <span className="sep">/</span>{' '}
      <Link to={`/datasets/${id}`}>{name ?? id}</Link> <span className="sep">/</span> <b>Muse sessions</b>
    </span>
  );

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead">
          <div>
            <h1>Muse sessions</h1>
            <div className="sub">
              Every session broken off this dataset, most recently worked first. Opening one is a read —
              it does not change which session the muse resumes.
            </div>
          </div>
        </div>

        {/* The search appears once there are sessions to search (DESIGN.md P-1a); a field
            over nothing — no account, no sessions yet — answers no question. It stays while
            a query narrows the list to nothing, since then it is what the visitor is using. */}
        {rows.length > 0 && (
          <div className="muse-hist-search">
            <input
              className="cer-input"
              type="search"
              placeholder="Search the fragments these sessions were drawn from"
              aria-label="Search muse sessions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="gt-sub mono">{`${shown.length} of ${rows.length}`}</span>
          </div>
        )}

        {!signedIn && (
          <div className="empty">
            <div className="t">Sessions belong to an account</div>
            <div className="s">
              <Link to={doorPath(`/datasets/${id}/muse/sessions`)}>Sign in</Link> to see the sessions
              broken off this dataset. Anonymous work is not kept under a name, so there is nothing
              here to look up yet.
            </div>
          </div>
        )}
        {signedIn && error && <div className="sub mono">{error}</div>}
        {signedIn && sessions === null && <div className="sub">Loading…</div>}
        {signedIn && emptyNote && <div className="empty"><div className="t">{emptyNote}</div></div>}

        <ul className="muse-hist">
          {shown.map((row, i) => (
            <li key={row.id} className={`muse-hist-row${row.empty ? ' empty' : ''}`}>
              <div className="muse-hist-main">
                <span className="muse-hist-line">{row.line}</span>
                <span className="gt-sub mono">
                  worked {row.mutatum} · started {row.natum}
                  {i === 0 && query.trim() === '' ? ' · the muse resumes here' : ''}
                </span>
              </div>
              {row.lineage.length > 0 && (
                <div className="pref-chips muse-hist-lineage">
                  {row.lineage.slice(0, 8).map((text) => (
                    <span key={text} className="fchip on">{text}</span>
                  ))}
                  {row.lineage.length > 8 && (
                    <span className="gt-sub mono">+{row.lineage.length - 8} more</span>
                  )}
                </div>
              )}
              <Link className="btn ghost sm" to={sessionHref(id ?? '', row.id)}>Open →</Link>
            </li>
          ))}
        </ul>
      </div></div>
    </AppShell>
  );
}
