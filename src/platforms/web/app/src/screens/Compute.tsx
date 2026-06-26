import { useState } from 'react';
import { AppShell } from '../shell/AppShell';
import { useIdentity } from '../state/identity';
import { EXECUTION_SHORT, EXECUTIONS, WORK_PRIV } from '../lib/idents';
import {
  GPU_TIERS, POLICY_PRESETS, loadPolicy, savePolicy, matchedPreset, type ComputePolicy,
} from '../lib/compute';
import { Ic } from '../lib/icons';

const CEILINGS: { label: string; v: number | null }[] = [
  { label: 'none', v: null }, { label: '$1/hr', v: 1 }, { label: '$2/hr', v: 2 },
];

export function Compute() {
  const { execution, setExecution } = useIdentity();
  const [policy, setPol] = useState<ComputePolicy>(loadPolicy);
  const matched = matchedPreset(policy);

  function update(p: ComputePolicy) { setPol(p); savePolicy(p); }
  const toggleTier = (id: string) => update({
    ...policy,
    allowed: policy.allowed.includes(id) ? policy.allowed.filter((x) => x !== id) : [...policy.allowed, id],
  });

  return (
    <AppShell crumb="compute">
      <div className="page"><div className="pw">
        <div className="pagehead"><div>
          <h1>Compute</h1>
          <div className="sub">How your runs get provisioned — the cost ↔ capacity trade-off, your default locus, and your own hardware.</div>
        </div></div>

        {/* provisioning policy — the standing GPU preference */}
        <div className="sectionhead">Provisioning policy</div>
        <div className="sub" style={{ marginBottom: 'var(--s3)' }}>When you host your own compute, this decides which GPU we reach for.</div>
        <div className="presets">
          {POLICY_PRESETS.map((pre) => (
            <button key={pre.id} className={`tieropt${matched === pre.id ? ' on' : ''}`} onClick={() => update({ ...pre.policy })}>
              <div className="tmain"><div className="t">{pre.t}</div><div className="s">{pre.s}</div></div>
            </button>
          ))}
        </div>

        <div className="card">
          <div className=" filt-l">Acceptable GPUs</div>
          <div className="gpulist">
            {GPU_TIERS.map((t) => {
              const on = policy.allowed.includes(t.id);
              const capped = policy.maxHourly != null && t.hourly > policy.maxHourly;
              return (
                <button key={t.id} className={`gpurow${on ? ' on' : ''}${capped ? ' capped' : ''}`} onClick={() => toggleTier(t.id)}>
                  <span className="ck">{on ? <Ic name="check" /> : null}</span>
                  <span className="gn">{t.name}</span>
                  <span className="gv mono">{t.vramGb} GB</span>
                  <span className="gp mono">${t.hourly.toFixed(2)}/hr</span>
                  {capped && <span className="badge">over ceiling</span>}
                </button>
              );
            })}
          </div>

          <div className="polrow">
            <span className="pl">When several fit</span>
            <div className="seg">
              {(['thrift', 'headroom'] as const).map((l) => (
                <button key={l} className={policy.lean === l ? 'on' : ''} onClick={() => update({ ...policy, lean: l })}>
                  {l === 'thrift' ? 'Thrift · cheapest' : 'Headroom · most capacity'}
                </button>
              ))}
            </div>
          </div>
          <div className="polrow">
            <span className="pl">Spend ceiling</span>
            <div className="seg">
              {CEILINGS.map((c) => (
                <button key={c.label} className={policy.maxHourly === c.v ? 'on' : ''} onClick={() => update({ ...policy, maxHourly: c.v })}>{c.label}</button>
              ))}
            </div>
          </div>
          <div className="polrow">
            <span className="pl">If preferred is busy</span>
            <div className="seg">
              {(['wait', 'fallback'] as const).map((b) => (
                <button key={b} className={policy.onBusy === b ? 'on' : ''} onClick={() => update({ ...policy, onBusy: b })}>
                  {b === 'wait' ? 'Wait for it' : 'Fall back to available'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* default execution locus */}
        <div className="sectionhead">Default execution</div>
        <div className="sub" style={{ marginBottom: 'var(--s3)' }}>Where new sessions run unless you switch them in the moment.</div>
        <div className="execmode wide">
          {EXECUTIONS.map((e) => (
            <button key={e} className={`em${execution === e ? ' on' : ''}`} onClick={() => setExecution(e)}>
              <Ic name={WORK_PRIV[e][0]} /> {EXECUTION_SHORT[e]}
            </button>
          ))}
        </div>

        {/* local runner — the LocalCursor setup (pathway §2), stubbed */}
        <div className="sectionhead">Your machine</div>
        <div className="card local-stub">
          <div><div className="t"><Ic name="laptop" /> Run on your own GPU</div><div className="s">Connect a local runner and run the catalogue on your hardware — outside pay-to-play. Submit your GPU specs to gate which flows can run locally.</div></div>
          <button className="btn ghost" onClick={() => alert('connect local runner (todo)')}>Set up…</button>
        </div>
      </div></div>
    </AppShell>
  );
}
