import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ic } from '../lib/icons';
import { setTermsAsker, type TermsRequest } from '../lib/termsGate';
import './report-modal.css';

// TermsGate — the dialog a run under upstream licence terms (MiniMax H3) waits on. Mounted once
// in the app frame; `api.createRun` asks it through lib/termsGate when the server refuses a run
// with `terms.required`. Accepting is a deliberate act: the box must be ticked, and the terms
// and the licence they flow down from are one tap away. Declining sends the refusal back to the
// screen that started the run.

export function TermsGate() {
  const [req, setReq] = useState<TermsRequest | null>(null);
  const [agreed, setAgreed] = useState(false);
  const answer = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => setTermsAsker((r) => new Promise<boolean>((resolve) => {
    answer.current?.(false);
    answer.current = resolve;
    setAgreed(false);
    setReq(r);
  })), []);

  function settle(ok: boolean) {
    answer.current?.(ok);
    answer.current = null;
    setReq(null);
  }

  if (!req) return null;
  return createPortal(
    <div className="report-overlay" onClick={() => settle(false)}>
      <div className="report-modal" role="dialog" aria-label={req.nomen} onClick={(e) => e.stopPropagation()}>
        <div className="report-head">
          <b>{req.nomen}</b>
          <span className="report-close" onClick={() => settle(false)}><Ic name="x" /></span>
        </div>
        <div className="report-body">
          <div className="report-status">
            This flow runs under the {req.nomen}. Its licence requires you to accept them before your first
            run, and the run is held until you do. Nothing has been charged.
          </div>
          <div className="report-status">
            <a href={req.href} target="_blank" rel="noreferrer">Read the terms ▸</a>
            {' · '}
            <a href={req.licenseHref} target="_blank" rel="noreferrer">MiniMax's licence ▸</a>
          </div>
          <label className="report-status">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />{' '}
            I have read and accept the {req.nomen}.
          </label>
          <div className="report-actions">
            <button className="report-cancel" onClick={() => settle(false)}>Cancel</button>
            <button className="report-submit" disabled={!agreed} onClick={() => settle(true)}>Accept and run</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
