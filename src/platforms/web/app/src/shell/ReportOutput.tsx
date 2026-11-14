import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Ic } from '../lib/icons';
import { api } from '../lib/api';
import './report-modal.css';

// ReportOutput — "Report this output" on a finished run: the abuse report licence terms such as
// MiniMax H3's require us to take. It names the run and nothing else about anyone; the server
// reads who ran it and which terms governed it from the run itself. Distinct from the global
// ReportModal, which files bugs and feedback about the app rather than about an output.

type Phase = 'idle' | 'submitting' | 'success' | 'error';

export function ReportOutput({ runId }: { runId: string }) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setDescription('');
    setPhase('idle');
    setError(null);
  }

  async function submit() {
    if (!description.trim() || phase === 'submitting') return;
    setPhase('submitting');
    setError(null);
    try {
      await api.submitReport('abuse', description.trim(), {
        route: window.location.pathname,
        runId,
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
      <button type="button" className="btn-ghost" onClick={() => setOpen(true)}>
        <Ic name="flag" /> Report this output
      </button>
      {open && createPortal(
        <div className="report-overlay" onClick={close}>
          <div className="report-modal" role="dialog" aria-label="Report this output" onClick={(e) => e.stopPropagation()}>
            <div className="report-head">
              <b>Report this output</b>
              <span className="report-close" onClick={close}><Ic name="x" /></span>
            </div>
            {phase === 'success' ? (
              <div className="report-body">
                <div className="report-status ok">Thanks — we review every report, and act on the ones that break the terms.</div>
                <button className="report-submit" onClick={close}>Close</button>
              </div>
            ) : (
              <div className="report-body">
                <div className="report-status">
                  Tell us what in this output breaks the <a href="/legal/terms" target="_blank" rel="noreferrer">terms</a>.
                </div>
                <textarea
                  className="report-desc"
                  placeholder="what in this output breaks the terms?"
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
                    {phase === 'submitting' ? 'Submitting…' : 'Report'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
