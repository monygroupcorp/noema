import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Ic } from '../lib/icons';
import { api, type QuerelaKind } from '../lib/api';
import './report-modal.css';

// ReportModal — the global "report an issue" affordance (plans/noema-101.md). Mounted once
// in AppShell so it's reachable from every app screen, including Chat/Run. Low-friction and
// functional-not-polished by design (Decision record) — the visual de-AI-tell pass is a
// separately-backlogged item.

const PROMPTS: Record<QuerelaKind, string> = {
  bug: "what went wrong?",
  feature: "what would you like to see?",
  feedback: "what's on your mind?",
};

// Only /train/run/:id carries an actual run id in the URL today (App.tsx route table) — no
// route carries an actum id yet, so `actumId` stays unset. Extracted via a plain path match
// (not useParams) so this works regardless of where in the tree ReportModal is rendered.
function runIdFromPath(pathname: string): string | undefined {
  return pathname.match(/^\/train\/run\/([^/]+)/)?.[1];
}

type Phase = 'idle' | 'submitting' | 'success' | 'error';

export function ReportModal() {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<QuerelaKind>('bug');
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setKind('bug');
    setDescription('');
    setPhase('idle');
    setError(null);
  }
  function close() {
    setOpen(false);
    reset();
  }

  async function submit() {
    if (!description.trim() || phase === 'submitting') return;
    setPhase('submitting');
    setError(null);
    try {
      await api.submitReport(kind, description.trim(), {
        route: location.pathname,
        runId: runIdFromPath(location.pathname),
        userAgent: navigator.userAgent,
      });
      setPhase('success');
    } catch (err) {
      setPhase('error');
      setError(err instanceof Error ? err.message : 'Could not submit — try again.');
    }
  }

  return (
    <>
      <button className="report-trigger" title="Report an issue" onClick={() => setOpen(true)}>
        <Ic name="flag" />
      </button>

      {open && (
        <div className="report-overlay" onClick={close}>
          <div className="report-modal" onClick={(e) => e.stopPropagation()}>
            <div className="report-head">
              <b>Report an issue</b>
              <span className="report-close" onClick={close}><Ic name="x" /></span>
            </div>

            {phase === 'success' ? (
              <div className="report-body">
                <div className="report-status ok">Thanks — your report was submitted.</div>
                <button className="report-submit" onClick={close}>Close</button>
              </div>
            ) : (
              <div className="report-body">
                <div className="report-kinds">
                  {(['bug', 'feature', 'feedback'] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`report-kind${kind === k ? ' active' : ''}`}
                      onClick={() => setKind(k)}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <textarea
                  className="report-desc"
                  placeholder={PROMPTS[kind]}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                  autoFocus
                />
                {phase === 'error' && <div className="report-status err">{error}</div>}
                <div className="report-actions">
                  <button className="report-cancel" onClick={close}>Cancel</button>
                  <button
                    className="report-submit"
                    onClick={submit}
                    disabled={!description.trim() || phase === 'submitting'}
                  >
                    {phase === 'submitting' ? 'Submitting…' : 'Submit'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
