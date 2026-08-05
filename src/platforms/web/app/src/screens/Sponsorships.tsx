import { useState, useEffect } from 'react';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type Sponsorship, type SubsidyCadence } from '../lib/api';
import { useSession } from '../state/session';

// Sponsorships (Sponsio, ADR-0011 §2) — a standing, capped top-up pledge: keep a
// beneficiary account topped up on a cadence, drawn from your pool. Create / list /
// pause / resume over /v1/sponsorships. Identified accounts only (401 for anon).
const CADENCES: SubsidyCadence[] = ['weekly', 'biweekly', 'monthly'];
const fmt = (v?: string) => (v == null ? '—' : Number(v).toLocaleString());

export function Sponsorships() {
  const { session, ready } = useSession();
  const [list, setList] = useState<Sponsorship[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Create form.
  const [beneficiary, setBeneficiary] = useState('');
  const [grant, setGrant] = useState('');
  const [cadence, setCadence] = useState<SubsidyCadence>('monthly');
  const [balanceCap, setBalanceCap] = useState('');
  const [capTotal, setCapTotal] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!session) { setList([]); return; }  // gated — the sign-in prompt covers it, skip the 403
    let live = true;
    api.listSponsorships()
      .then((r) => { if (live) setList(r.sponsorships); })
      .catch((e) => { if (live) setErr(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [ready, session?.animaId]);

  async function create() {
    if (!beneficiary.trim() || !grant.trim()) return;
    setCreating(true); setErr(null);
    try {
      const { sponsorship } = await api.createSponsorship({
        beneficiaryAnimaId: beneficiary.trim(),
        grant: grant.trim(),
        cadence,
        ...(balanceCap.trim() ? { balanceCap: balanceCap.trim() } : {}),
        ...(capTotal.trim() ? { capTotal: capTotal.trim() } : {}),
      });
      setList((cur) => [sponsorship, ...(cur ?? [])]);
      setBeneficiary(''); setGrant(''); setBalanceCap(''); setCapTotal('');
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setCreating(false); }
  }

  async function toggle(s: Sponsorship) {
    setBusy(s.id); setErr(null);
    try {
      const { sponsorship } = s.status === 'active' ? await api.pauseSponsorship(s.id) : await api.resumeSponsorship(s.id);
      setList((cur) => (cur ?? []).map((x) => (x.id === s.id ? sponsorship : x)));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  }

  return (
    <AppShell crumb="sponsorships">
      <div className="page"><div className="pw">
        <div className="pagehead"><div>
          <h1>Sponsorships</h1>
          <div className="sub">Keep another account topped up on a cadence, drawn from your balance. Pause or resume any time; caps keep it bounded.</div>
        </div></div>

        {!session && ready && (
          <div className="warn">Sponsorships need an identified account with a fundable pool. <a href="/onboard">Sign in</a> to pledge.</div>
        )}

        <div className="sectionhead">New pledge</div>
        <div className="noema-frame" style={{ padding: 'var(--s4)', marginBottom: 'var(--s5)', display: 'flex', flexDirection: 'column', gap: 'var(--s3)' }}>
          <input className="inp mono" placeholder="beneficiary account id" value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} disabled={!session} />
          <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
            <input className="inp mono" style={{ flex: '1 1 160px' }} type="number" min="1" placeholder="grant (points / cycle)" value={grant} onChange={(e) => setGrant(e.target.value)} disabled={!session} />
            <select className="inp mono" style={{ maxWidth: 140 }} value={cadence} onChange={(e) => setCadence(e.target.value as SubsidyCadence)} disabled={!session}>
              {CADENCES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 'var(--s3)', flexWrap: 'wrap' }}>
            <input className="inp mono" style={{ flex: '1 1 160px' }} type="number" min="0" placeholder="balance cap (optional)" value={balanceCap} onChange={(e) => setBalanceCap(e.target.value)} disabled={!session} />
            <input className="inp mono" style={{ flex: '1 1 160px' }} type="number" min="0" placeholder="lifetime cap (optional)" value={capTotal} onChange={(e) => setCapTotal(e.target.value)} disabled={!session} />
          </div>
          <div>
            <button className="btn accent" onClick={create} disabled={creating || !session || !beneficiary.trim() || !grant.trim()}>
              <Ic name="hand-coins" /> {creating ? 'Creating…' : 'Create pledge'}
            </button>
          </div>
        </div>

        {err && <div className="warn">{err}</div>}

        <div className="sectionhead">Your pledges</div>
        {!list && !err && <div className="empty"><div className="t">Loading…</div></div>}
        {list && list.length === 0 && <div className="empty"><div className="t">No pledges yet</div><div className="s">Create one above to keep an account topped up.</div></div>}

        {list && list.length > 0 && (
          <div className="list">
            {list.map((s) => (
              <div className="lrow" key={s.id}>
                <div className="li-main">
                  <div className="t mono">→ {s.beneficiarius.animaId}</div>
                  <div className="s">
                    {fmt(s.subsidia.grant)} pts · {s.subsidia.cadence}
                    {s.subsidia.balanceCap && <> · cap {fmt(s.subsidia.balanceCap)}</>}
                    {' · '}dripped {fmt(s.drippedTotal)}{s.capTotal && <> / {fmt(s.capTotal)}</>}
                  </div>
                </div>
                <div className="li-right" style={{ display: 'flex', gap: 'var(--s3)', alignItems: 'center' }}>
                  <span className={`badge${s.status === 'active' ? ' accent' : ''}`}>{s.status}</span>
                  {s.status !== 'exhausted' && (
                    <button className="btn ghost" onClick={() => toggle(s)} disabled={busy === s.id}>
                      <Ic name={s.status === 'active' ? 'pause' : 'play'} /> {s.status === 'active' ? 'pause' : 'resume'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div></div>
    </AppShell>
  );
}
