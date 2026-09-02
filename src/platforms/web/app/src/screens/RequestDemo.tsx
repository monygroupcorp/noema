import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SiteFooter } from './SiteFooter';
import { entryPath } from '../lib/entry';
import { api } from '../lib/api';
import './landing.css'; // reuse .topnav / .btn chrome
import './doc.css';

// RequestDemo — the public "become a B2B partner" intake page. Mirrors Pricing.tsx exactly: no
// auth check, public route, shared marketing chrome. POSTs to /v1/partner-requests
// (partnerRequestRouter.ts), which is anon-capable — a logged-out visitor and a signed-in
// account both just work here. The backend opportunistically attaches the caller's animaId when
// a valid session is present (it tries identity resolution and swallows any failure); this form
// does nothing special for that — it calls api.requestPartnership(), which reuses the same
// authHeaders() every other identity-attach write in this app uses (bearer if signed in, else
// the anon commitment), same as ReportModal's submitReport.
//
// A platform admin reviews the resulting queue at /admin/partner-requests (AdminPartnerRequests.tsx).

type Phase = 'idle' | 'submitting' | 'success' | 'error';

export function RequestDemo() {
  const [nomen, setNomen] = useState('');
  const [org, setOrg] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [useCase, setUseCase] = useState('');
  const [notes, setNotes] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  const canSubmit = contactEmail.trim() !== '' && useCase.trim() !== '' && phase !== 'submitting';

  async function submit() {
    if (!canSubmit) return;
    setPhase('submitting');
    setError(null);
    try {
      await api.requestPartnership({
        contactEmail: contactEmail.trim(),
        useCase: useCase.trim(),
        ...(nomen.trim() ? { nomen: nomen.trim() } : {}),
        ...(org.trim() ? { org: org.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      setPhase('success');
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Could not submit — try again.');
    }
  }

  return (
    <div className="doc-page">
      <nav className="topnav">
        <Link to="/landing" className="brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="dot" />noema
        </Link>
        <div className="right">
          <Link className="btn-ghost" to="/features">Features</Link>
          <Link className="btn-ghost" to="/pricing">Pricing</Link>
          <Link className="btn" to={entryPath()}>Open app</Link>
        </div>
      </nav>

      <article className="prose">
        <h1>Request a demo / become a partner</h1>
        <p>
          Tell us a bit about what you want to build and we'll be in touch. This isn't a support
          form — for bugs or feedback on an existing account, use the report button inside the
          app instead.
        </p>

        {phase === 'success' ? (
          <div className="byo-row">
            <div className="byo-head"><span className="byo-prov">Thanks — we'll be in touch</span></div>
            <div className="byo-body" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 'var(--s2)' }}>
              <div className="sub">
                Your request was submitted. A member of the team will follow up at the email you gave us.
              </div>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => { e.preventDefault(); void submit(); }}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s3, 12px)', maxWidth: 480 }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="sub">Name (optional)</span>
              <input
                className="byo-input"
                type="text"
                placeholder="Jane Doe"
                value={nomen}
                onChange={(e) => setNomen(e.target.value)}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="sub">Organization (optional)</span>
              <input
                className="byo-input"
                type="text"
                placeholder="Acme Inc."
                value={org}
                onChange={(e) => setOrg(e.target.value)}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="sub">Contact email (required)</span>
              <input
                className="byo-input"
                type="email"
                required
                placeholder="you@example.com"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                autoComplete="email"
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="sub">How do you want to use noema? (required)</span>
              <textarea
                className="byo-input"
                required
                rows={4}
                placeholder="A short description of what you'd build or integrate."
                value={useCase}
                onChange={(e) => setUseCase(e.target.value)}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span className="sub">Notes (optional)</span>
              <textarea
                className="byo-input"
                rows={3}
                placeholder="Anything else we should know."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>

            {phase === 'error' && <div className="warn">{error}</div>}

            <button className="btn" type="submit" disabled={!canSubmit} style={{ alignSelf: 'flex-start' }}>
              {phase === 'submitting' ? 'Submitting…' : 'Submit request'}
            </button>
          </form>
        )}
      </article>
      <SiteFooter />
    </div>
  );
}
