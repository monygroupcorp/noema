import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';
import { api, type Run, type RunOrder } from '../lib/api';

// Training run monitor (train-run-spec.md, render noema-train-run.png) — "watch it learn".
//
// The route param is a RUN id: Derive lands here with the id of the training run it started, and
// the screen polls `GET /v1/runs/:id` until that run is terminal. It renders what the run itself
// reports — status, when it started, what it cost, and its outputs on completion — and nothing
// it does not: a per-step loss curve and checkpoint previews are not part of a run's shape, so
// there are no panels for them. A half-real monitor is indistinguishable from a real one at a
// glance, which is worse than one that shows only what it can see.

const POLL_MS = 4000;

// A training run is one ATTEMPT at a standing order. When the order is still live — an attempt
// running, or another one scheduled — this screen follows the order, not the attempt: a failed
// attempt inside a live order is not a failure the user has to do anything about, so it is not
// worded as one.
function whenLabel(iso: string | undefined, nowMs: number): string {
  if (!iso) return 'shortly';
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'shortly';
  const mins = Math.round((at - nowMs) / 60000);
  if (mins <= 1) return 'in a moment';
  if (mins < 60) return `in about ${mins} minutes`;
  const hours = Math.round(mins / 60);
  return hours <= 1 ? 'within the hour' : `in about ${hours} hours`;
}

function elapsed(from: string | undefined, nowMs: number): string | null {
  if (!from) return null;
  const start = Date.parse(from);
  if (Number.isNaN(start)) return null;
  const s = Math.max(0, Math.round((nowMs - start) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

// The order-state notice for this screen. 'attempting' (an attempt is currently running) and
// 'scheduled' (between attempts, the next one armed) are distinct order states with distinct
// copy: an attempt in flight is progress, not a failure, so it never carries the between-attempts
// retry language. Any other order/run state falls through to 'other', whose chip mirrors the
// run's own status exactly as before.
export interface TrainRunNotice {
  mode: 'attempting' | 'scheduled' | 'other';
  chip: string;
  copy: string | null;
}

export function trainRunNotice(order: RunOrder | undefined, run: Run): TrainRunNotice {
  if (order?.state === 'attempting') {
    return { mode: 'attempting', chip: 'getting a machine', copy: 'getting a machine\u2026' };
  }
  if (order?.state === 'scheduled') {
    const until = order.until ? new Date(order.until).toLocaleString() : 'later today';
    return {
      mode: 'scheduled',
      chip: 'scheduled',
      copy: `No machine this attempt. Retries run hourly until ${until}. Attempts that don't start aren't charged. The finished training lands on your shelf.`,
    };
  }
  const failed = run.status === 'failed';
  const done = run.status === 'complete';
  return { mode: 'other', chip: failed ? 'failed' : done ? 'finished' : run.status, copy: null };
}

export function TrainRun() {
  const { id } = useParams();
  const [run, setRun] = useState<Run | null | undefined>(undefined);   // undefined = loading, null = not found
  const [now, setNow] = useState(Date.now());
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    if (!id) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      api.getRun(id).then(({ run: r }) => {
        if (!live) return;
        setRun(r);
        // A live ORDER keeps this page polling even though this attempt is terminal — the
        // next attempt's outcome is what the user is waiting for.
        const ordered = r.order?.state === 'scheduled' || r.order?.state === 'attempting';
        if (ordered || (r.status !== 'complete' && r.status !== 'failed')) timer = setTimeout(tick, POLL_MS);
      }).catch(() => {
        if (!live) return;
        setRun((prev) => (prev === undefined ? null : prev));
        timer = setTimeout(tick, POLL_MS);
      });
    };
    tick();
    return () => { live = false; clearTimeout(timer); };
  }, [id]);

  // Re-render the elapsed line once a second while the run is live.
  useEffect(() => {
    if (!run || run.status === 'complete' || run.status === 'failed') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run]);

  if (run === undefined) {
    return <AppShell title="Training run"><div className="page"><div className="pw wide"><div className="sub mono">loading…</div></div></div></AppShell>;
  }
  if (!run) {
    return (
      <AppShell title="Training run">
        <div className="page"><div className="pw wide"><div className="sub mono">run not found. <Link to="/datasets">back to datasets</Link></div></div></div>
      </AppShell>
    );
  }

  const order = run.order;
  const notice = trainRunNotice(order, run);
  // "Waiting" = the request is still alive, whatever this one attempt did. It suppresses the
  // failure wording entirely: nothing has been charged and nothing is asked of the user.
  const waiting = notice.mode === 'scheduled' || notice.mode === 'attempting';
  const dayExhausted = order?.state === 'stopped' && order.reason === 'exhausted';
  const done = run.status === 'complete';
  const failed = run.status === 'failed' && !waiting;
  // True only while the run itself is actually progressing on a machine — excludes the
  // pre-machine/between-attempts states (315's copy already covers those), and every terminal
  // state, so this never sits next to failure, apology, or cancellation copy.
  const activelyTraining = !done && !failed && !waiting && !dayExhausted && order?.state !== 'cancelled';

  const cancelOrder = () => {
    if (!id || cancelling) return;
    setCancelling(true);
    api.revokeRunOrder(id)
      .then(({ order: o }) => setRun((prev) => (prev ? { ...prev, ...(o ? { order: o } : {}) } : prev)))
      .catch(() => { /* the order stands; the next poll re-reads its real state */ })
      .finally(() => setCancelling(false));
  };
  const loraId = typeof run.exitus?.loraId === 'string' ? (run.exitus.loraId as string) : null;
  const lastStep = typeof run.exitus?.steps === 'number' ? (run.exitus.steps as number) : null;
  const since = elapsed(run.createdAt, now);

  const crumb = (
    <span className="ph-crumb"><Link to="/datasets">datasets</Link> <span className="sep">/</span> train <span className="sep">/</span> <b>run</b></span>
  );

  return (
    <AppShell title={crumb}>
      <div className="page"><div className="pw wide">
        <div className="pagehead tr-head">
          <div>
            <h1>Training run</h1>
            <div className="sub mono">run {run.id.slice(0, 8)} · {run.modusId}</div>
          </div>
          <div className="right">
            <span className="tr-status">
              <span className={`rdot ${failed || dayExhausted ? 'amber' : 'good'}`} />{' '}
              {notice.chip}
            </span>
            {activelyTraining && (
              <div className="sub mono">safe to close this page — training continues on the machine.</div>
            )}
          </div>
        </div>

        {/* the meter — only what the run reports */}
        <div className="tr-bottom">
          <div className="tr-meter">
            <div className="tr-meter-l"><span className="hemi2 lit" /> what we see — the meter</div>
            <div className="tr-mrow"><span className="k mono">status</span><span className="v mono"><b className="accent">{run.status}</b></span></div>
            {since && <div className="tr-mrow"><span className="k mono">{done || failed ? 'started' : 'running for'}</span><span className="v mono">{done || failed ? new Date(run.createdAt as string).toLocaleString() : since}</span></div>}
            {lastStep !== null && <div className="tr-mrow"><span className="k mono">last step</span><span className="v mono">{lastStep}</span></div>}
            {run.cost && <div className="tr-mrow"><span className="k mono">charged</span><span className="v mono">{run.cost}</span></div>}
            {loraId && <div className="tr-mrow"><span className="k mono">trained model</span><span className="v mono">{loraId}</span></div>}
            {/* The attempt's status and the REQUEST's status are different facts, so both are
                shown rather than one standing in for the other. */}
            {order && <div className="tr-mrow"><span className="k mono">request</span><span className="v mono">{order.state}{order.reason ? ` (${order.reason})` : ''}</span></div>}
            {order && waiting && <div className="tr-mrow"><span className="k mono">attempts left</span><span className="v mono">{order.attemptsRemaining}</span></div>}
          </div>
        </div>

        {notice.mode === 'attempting' && (
          <p className="tr-note">{notice.copy}</p>
        )}
        {notice.mode === 'scheduled' && (
          <div className="tr-note">
            <p>{notice.copy}</p>
            <p className="sub mono">
              attempt {order?.attempts} · next {whenLabel(order?.nextAttemptAt, now)}
              {order?.until ? ` · until ${new Date(order.until).toLocaleString()}` : ''}
              {' · '}
              <button type="button" className="btn ghost" onClick={cancelOrder} disabled={cancelling}>
                {cancelling ? 'cancelling…' : 'Cancel this training'}
              </button>
            </p>
          </div>
        )}
        {dayExhausted && (
          <p className="tr-note">
            We tried your training for a full day and our provider never came through. We&rsquo;re sorry —
            nothing was charged. Your request is saved; one tap re-schedules it.
          </p>
        )}
        {order?.state === 'cancelled' && (
          <p className="tr-note">You cancelled this training. Nothing further will be attempted, and nothing was charged.</p>
        )}
        {failed && !dayExhausted && (
          <p className="tr-note">This run stopped: {run.failure?.message ?? 'no reason reported'}. Nothing was added to your shelf.</p>
        )}
        {done && (
          <p className="tr-note">Training finished — the model is on <Link to="/models" className="accent">your shelf</Link>.</p>
        )}
        {activelyTraining && (
          <p className="tr-note">Training is under way on our compute. This page follows the run and updates itself; you can leave and come back to the same address.</p>
        )}

        <div className="tr-foot">
          <div className="tr-foot-note">
            <span className="hemi2 lit" /> training on our compute — we can see the work. &nbsp;↳ lands on <Link to="/models" className="accent">your model shelf</Link> when it finishes
          </div>
          <div className="tr-actions">
            <Link className="btn ghost" to="/models"><Ic name="box" /> View your shelf →</Link>
          </div>
        </div>
        <div className="sub mono" style={{ marginTop: 'var(--s3)', color: 'var(--faint)', fontSize: 'var(--fs-xs)' }}>
          <span className="hemi2 dashed" /> A run reports its status and its outputs; per-step loss and intermediate checkpoints are not part of that report, so they are not shown here.
        </div>
      </div></div>
    </AppShell>
  );
}
