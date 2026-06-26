import { type ReactNode } from 'react';
import { Rail } from './Rail';
import { Webring } from './Webring';
import { Account } from './Account';
import { Concierge } from './Concierge';

// The persistent frame. Screens compose their main content (+ optional right context).
export function AppShell({
  crumb, context, concierge = true, children,
}: {
  crumb?: ReactNode;
  context?: ReactNode;
  concierge?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={`app${context ? '' : ' two'}`}>
      <Rail />
      <section className="main">
        <div className="topbar">
          <Webring />
          {crumb && <div className="crumb"><span className="sep">/</span> {crumb}</div>}
          <div className="vis" />
          <Account />
        </div>
        {children}
      </section>
      {context && <aside className="context">{context}</aside>}
      {concierge && <Concierge hasContext={!!context} />}
    </div>
  );
}
