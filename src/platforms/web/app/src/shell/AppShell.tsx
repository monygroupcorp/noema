import { type ReactNode } from 'react';
import { Rail } from './Rail';
import { Account } from './Account';
import { Concierge } from './Concierge';
import { ReportModal } from './ReportModal';

// The persistent frame (dashboard-spec.md §A): left rail (global nav) + a top bar carrying
// the current surface TITLE (left) and the always-on POSTURE CLUSTER (right). Screens compose
// their main content (+ optional right context). `crumb` is the surface title.
//
// `gated` marks a screen whose body is a gate (sign in, not yours, not found) rather than the
// screen itself. The gate's own control is then the one action on the screen, and the topbar's
// "Start" stands down: a topbar must not offer what the screen in front of it refuses (P-1a),
// and a gate card beside a second button reads as two actions (D-42).
export function AppShell({
  crumb, title, context, concierge = true, gated = false, children,
}: {
  crumb?: ReactNode;
  title?: ReactNode;
  context?: ReactNode;
  concierge?: boolean;
  gated?: boolean;
  children: ReactNode;
}) {
  const heading = title ?? crumb;
  return (
    <div className={`app${context ? '' : ' two'}`}>
      <Rail />
      <section className="main">
        <div className="topbar">
          {heading && <div className="surface-title">{heading}</div>}
          <Account start={!gated} />
        </div>
        {children}
      </section>
      {context && <aside className="context">{context}</aside>}
      {/* One floating control per corner (D-53): the concierge hosts the report trigger in its
          panel; only a screen without the concierge floats the trigger on its own. */}
      {concierge ? <Concierge hasContext={!!context} /> : <ReportModal />}
    </div>
  );
}
