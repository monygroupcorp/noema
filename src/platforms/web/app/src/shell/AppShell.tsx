import { type ReactNode } from 'react';
import { Rail } from './Rail';
import { Account } from './Account';
import { Concierge } from './Concierge';
import { ReportModal } from './ReportModal';

// The persistent frame (dashboard-spec.md §A): left rail (global nav) + a top bar carrying
// the current surface TITLE (left) and the always-on POSTURE CLUSTER (right). Screens compose
// their main content (+ optional right context). `crumb` is the surface title.
export function AppShell({
  crumb, title, context, concierge = true, children,
}: {
  crumb?: ReactNode;
  title?: ReactNode;
  context?: ReactNode;
  concierge?: boolean;
  children: ReactNode;
}) {
  const heading = title ?? crumb;
  return (
    <div className={`app${context ? '' : ' two'}`}>
      <Rail />
      <section className="main">
        <div className="topbar">
          {heading && <div className="surface-title">{heading}</div>}
          <Account />
        </div>
        {children}
      </section>
      {context && <aside className="context">{context}</aside>}
      {concierge && <Concierge hasContext={!!context} />}
      <ReportModal />
    </div>
  );
}
