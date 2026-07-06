import { Link } from 'react-router-dom';
import { AppShell } from '../shell/AppShell';
import { Ic } from '../lib/icons';

// Honest 404 — a URL that doesn't resolve to a real surface. Always offers a way back.
export function Stub({ crumb = '404', title = 'This page doesn’t exist', sub }: { crumb?: string; title?: string; sub?: string }) {
  return (
    <AppShell crumb={crumb}>
      <div className="page"><div className="pw">
        <div className="pagehead"><div><h1>{title}</h1>{sub && <div className="sub">{sub}</div>}</div></div>
        <div className="empty">
          <div className="t">We couldn’t find that page.</div>
          <div className="s">The link may be broken, or the page may have moved.</div>
          <Link className="btn" to="/app"><Ic name="home" /> Back to home</Link>
        </div>
      </div></div>
    </AppShell>
  );
}
