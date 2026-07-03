import { useState, useEffect } from 'react';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type Team } from '../lib/api';
import { useSession } from '../state/session';

// Teams (Sodalitas) — a fellowship of Animae that co-owns work. Full CRUD over /v1/teams:
// create (you're the founder + first member), list your teams, add/remove members. Members
// are Anima ids (the honest primitive — there's no directory/handle lookup server-side yet).
// Identified accounts only: the endpoints 401 for the anon-commitment path.
export function Teams() {
  const { session, ready } = useSession();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [nomen, setNomen] = useState('');
  const [creating, setCreating] = useState(false);
  // Per-team "add member" draft, keyed by team id.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    api.listTeams()
      .then((r) => { if (live) setTeams(r.teams); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [ready, session?.animaId]);

  async function create() {
    if (!nomen.trim()) return;
    setCreating(true); setErr(null);
    try {
      const { team } = await api.createTeam({ nomen: nomen.trim() });
      setTeams((cur) => [team, ...(cur ?? [])]);
      setNomen('');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setCreating(false); }
  }

  async function addMember(id: string) {
    const animaId = (draft[id] ?? '').trim();
    if (!animaId) return;
    setBusy(id); setErr(null);
    try {
      const { team } = await api.addTeamMember(id, animaId);
      setTeams((cur) => (cur ?? []).map((t) => (t.id === id ? team : t)));
      setDraft((d) => ({ ...d, [id]: '' }));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  async function removeMember(id: string, animaId: string) {
    setBusy(id); setErr(null);
    try {
      const { team } = await api.removeTeamMember(id, animaId);
      setTeams((cur) => (cur ?? []).map((t) => (t.id === id ? team : t)));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  return (
    <AppShell crumb="teams">
      <div className="page"><div className="pw">
        <div className="pagehead"><div>
          <h1>Teams</h1>
          <div className="sub">A fellowship of accounts that co-owns work. Create one — you’re the founder — and add members by their account id.</div>
        </div></div>

        {!session && ready && (
          <div className="warn">Teams need an identified account. <a href="/onboard">Sign in</a> to create and manage them.</div>
        )}

        <div className="sectionhead">New team</div>
        <div style={{ display: 'flex', gap: 'var(--s3)', marginBottom: 'var(--s5)', flexWrap: 'wrap' }}>
          <input className="inp" style={{ flex: '1 1 260px' }} placeholder="team name" value={nomen} onChange={(e) => setNomen(e.target.value)} disabled={!session} />
          <button className="btn accent" onClick={create} disabled={creating || !session || !nomen.trim()}>
            <Ic name="users" /> {creating ? 'Creating…' : 'Create team'}
          </button>
        </div>

        {err && <div className="warn">{err}</div>}

        <div className="sectionhead">Your teams</div>
        {!teams && !err && <div className="empty"><div className="t">Loading…</div></div>}
        {teams && teams.length === 0 && <div className="empty"><div className="t">No teams yet</div><div className="s">Create one above to co-own collections and models.</div></div>}

        {teams && teams.map((t) => (
          <div key={t.id} className="noema-frame" style={{ padding: 'var(--s4)', marginBottom: 'var(--s4)' }}>
            <div className="li-main" style={{ marginBottom: 'var(--s3)' }}>
              <div className="t"><b>{t.nomen}</b> <span className="badge">{t.members.length} member{t.members.length === 1 ? '' : 's'}</span></div>
              <div className="s mono">created {new Date(t.createdAt).toLocaleDateString()}</div>
            </div>
            <div className="list">
              {t.members.map((m) => {
                const isFounder = m === t.founder;
                const isMe = m === session?.animaId;
                return (
                  <div className="lrow" key={m}>
                    <div className="li-main">
                      <div className="t mono">{m}{isMe && ' · you'}</div>
                      <div className="s">{isFounder ? 'founder' : 'member'}</div>
                    </div>
                    <div className="li-right">
                      {isFounder
                        ? <span className="badge accent">founder</span>
                        : <button className="btn ghost" onClick={() => removeMember(t.id, m)} disabled={busy === t.id}><Ic name="x" /> remove</button>}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 'var(--s3)', marginTop: 'var(--s3)', flexWrap: 'wrap' }}>
              <input
                className="inp mono"
                style={{ flex: '1 1 260px' }}
                placeholder="add member by account id"
                value={draft[t.id] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [t.id]: e.target.value }))}
              />
              <button className="btn ghost" onClick={() => addMember(t.id)} disabled={busy === t.id || !(draft[t.id] ?? '').trim()}>
                <Ic name="user-plus" /> add
              </button>
            </div>
          </div>
        ))}
      </div></div>
    </AppShell>
  );
}
