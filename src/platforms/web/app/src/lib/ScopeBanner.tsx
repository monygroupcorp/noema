import { Link, useLocation } from 'react-router-dom';
import type { Project } from './projects';

// The scoped-surface banner (Decision 4): when a canonical asset list is filtered to a
// project via `?project=<id>`, this states the scope and offers two exits — back to the
// project hub, or clear the filter to see everything. Rendered by Datasets/Shelf/Collections.
export function ScopeBanner({ project, noun }: { project: Project; noun: string }) {
  const { pathname } = useLocation();
  return (
    <div className="scope-banner mono">
      <span className="scope-dot" style={{ background: project.color }} />
      <span>Showing <b>{noun}</b> filed into <b>{project.name}</b>.</span>
      <span className="scope-actions">
        <Link to={`/projects/${project.id}`}>← project</Link>
        <Link to={pathname}>clear filter</Link>
      </span>
    </div>
  );
}
