import { AppShell } from '../shell/AppShell';

// Placeholder for screens not yet ported from the spike (they exist in docs/spikes as the visual spec).
export function Stub({ crumb, title, sub }: { crumb: string; title: string; sub?: string }) {
  return (
    <AppShell crumb={crumb}>
      <div className="page"><div className="pw">
        <div className="pagehead"><div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div></div>
        <div className="empty"><div className="t">Scaffolded — porting next from the spike (docs/spikes/frontend-shell/{crumb}.html).</div></div>
      </div></div>
    </AppShell>
  );
}
